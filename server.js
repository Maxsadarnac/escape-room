require("dotenv").config();

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const Anthropic = require("@anthropic-ai/sdk");
const { buildMockRoom } = require("./mockRoom");
const { getValidationFailureReason } = require("./lib/validation");
const { applyCipher } = require("./lib/ciphers");
const { applyPattern } = require("./lib/patterns");

const app = express();
app.use(cors());
app.use(express.json());

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const generateRoomLimiter = rateLimit({
  windowMs: 20 * 1000,
  limit: 1,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — limit is 1 request per 20 seconds per IP" },
});

const SYSTEM_PROMPT = `You generate escape room content as a single JSON object. Output ONLY valid JSON — no markdown code fences, no backticks, no leading or trailing prose, no explanations. Your entire response must be parseable by JSON.parse().

Produce a JSON object with exactly this shape:

{
  "theme": string,
  "difficulty": "easy" | "medium" | "hard",
  "visualFamily": "sci-fi" | "fantasy" | "horror-gothic" | "noir-mystery" | "nature" | "cyberpunk",
  "story": {
    "intro": string,
    "outro": string
  },
  "scene": {
    "palette": [string, string, string],
    "mood": string,
    "objects": [
      { "type": string, "position": [number, number, number], "puzzleId": string, "label": string }
    ]
  },
  "puzzles": [
    {
      "id": string,
      "type": "cipher" | "riddle" | "pattern" | "logic",
      "prompt": string,
      "plaintext": string,
      "answer": string,
      "hints": [string, string, string],
      "requires": [string]
    }
  ]
}

Rules:
- "visualFamily": classify the theme into exactly one of these six values based on its content: "sci-fi", "fantasy", "horror-gothic", "noir-mystery", "nature", "cyberpunk". Pick whichever single family best fits the theme's dominant aesthetic, even if it blends genres.
- "requires": puzzle solve order. First puzzle has "requires": []. Later puzzles may only require earlier puzzle ids. No circular dependencies.
- "answer": short and discrete (one word, a number, or a short code), never a sentence — matched by exact text.
- Any "next step" reference in a puzzle's "prompt" or the story text must literally match an object's "label" in "scene.objects".
- Vary puzzle "type" across the set.
- Cipher puzzles: set "plaintext" to a 3-5 word in-world phrase; set "answer" to that same phrase. "prompt" is flavor/context only — no cipher text, no plaintext — the server appends the real encoded text. Non-cipher puzzles: omit "plaintext".
- Pattern puzzles: "prompt" is flavor/context only — describe the in-world device or display that shows a numeric sequence, but include NO numbers and NO sequence; the server appends the real one. Omit "answer" and "hints" for pattern puzzles — the server generates both.
- Hints: exactly 3 per puzzle (except pattern — see above), in-world text only, ordered subtle to explicit. Never show your own reasoning ("let me", "wait,", "actually,", "hmm", "try again", etc.) — if a puzzle doesn't work while drafting, silently discard it and write a different one.
- Logic puzzles: answer must be numeric/computable, derived from math or counting clues — never an open "who's assigned to which station" grid-deduction puzzle. Never state the answer directly in "prompt". The final hint's number must match "answer".
- Riddle puzzles: original, written for this theme — never a reused classic (e.g. "cities but no houses"). The full riddle verse must appear in "prompt" itself.
- On-theme requirement: every puzzle's "prompt", riddle verse, cipher "plaintext", and flavor text must reference specific, concrete elements of this exact theme — named objects, characters, locations, or concepts unique to its world (e.g. a superlaser core, a specific house or spell, a named reactor or character). Do not write generic content that could be reskinned onto any theme by swapping a label — a riddle about "cities but no houses" or a logic puzzle about generic "levels" and "systems" with no in-world identity is not acceptable. Ground the puzzle's substance itself in this world, not just its surrounding sentence.
- Every object's "puzzleId" must reference a real puzzle.
- "palette": exactly 3 hex colors matching the mood. Keep prose concise — hackathon demo, not a novel.`;

/* Per-difficulty knobs. `cipher.mechanics` and `patternRules` name entries
   in the lib/ciphers and lib/patterns registries — the server builds those
   puzzle internals itself, so difficulty controls which mechanics players
   can meet, not what the model writes. */
const DIFFICULTY_CONFIG = {
  easy: {
    cipher: { mechanics: ["caesar", "reverse"], caesarShiftRange: [1, 3] },
    patternRules: ["arithmetic"],
    maxTokens: 2000,
    maxAttempts: 3,
    promptBlock: `This room is EASY difficulty:
- 3 puzzles total.
- Logic: single-step arithmetic only.
- First hint should be direct and revealing.`,
  },
  medium: {
    cipher: { mechanics: ["caesar", "atbash"], caesarShiftRange: [2, 8] },
    patternRules: ["arithmetic", "geometric", "quadratic"],
    maxTokens: 2200,
    maxAttempts: 3,
    promptBlock: `This room is MEDIUM difficulty:
- 4-5 puzzles total.
- Logic: multi-step arithmetic word problems are fine.
- First hint should be a gentle nudge, not a direct answer.`,
  },
  hard: {
    cipher: { mechanics: ["caesar", "atbash", "a1z26"], caesarShiftRange: [5, 15] },
    patternRules: ["geometric", "quadratic", "alternating", "fibonacci", "affine"],
    maxTokens: 4000,
    maxAttempts: 5,
    promptBlock: `This room is HARD difficulty:
- 6-7 puzzles total.
- Logic: at least 2 chained calculation steps.
- First hint should be vaguer/more abstract than medium. Keep every hint to 1-2 sentences — state the approach or result only, never intermediate arithmetic or out-loud thinking.`,
  },
};

function buildSystemPrompt(difficulty) {
  return `${SYSTEM_PROMPT}\n\n${DIFFICULTY_CONFIG[difficulty].promptBlock}`;
}

/* ---- Server-side puzzle builders -------------------------------------------
   After a draft passes validation, each puzzle type with server-authored
   internals gets them built here. A new mechanic-bearing puzzle type is
   one more entry: { type: (puzzle, config) => void }. */

const PUZZLE_BUILDERS = {
  cipher: (puzzle, config) => applyCipher(puzzle, config.cipher),
  pattern: (puzzle, config) => applyPattern(puzzle, config.patternRules),
};

function buildPuzzles(room, config) {
  const puzzles = Array.isArray(room.puzzles) ? room.puzzles : [];
  for (const puzzle of puzzles) {
    const builder = PUZZLE_BUILDERS[puzzle.type];
    if (builder) builder(puzzle, config);
  }
}

/* ---- Generation pipeline -------------------------------------------------
   One pipeline serves both endpoints. It reports progress through onEvent
   with events that mirror what is genuinely happening:

     { type: "stage", stage: "brief" }    request accepted, prompt assembled
     { type: "stage", stage: "story" }    model output reached "story"
     { type: "stage", stage: "scene" }    model output reached "scene"
     { type: "stage", stage: "puzzles" }  model output reached "puzzles"
     { type: "stage", stage: "check" }    consistency checks running
     { type: "retry", attempt, max, category, reason }
                                          a draft failed checks; regenerating
     { type: "stage", stage: "build" }    cipher/pattern building + family assignment

   The story/scene/puzzles stages come from watching the token stream for the
   top-level keys in schema order — real progress, not a timer. */

const MOCK_GENERATION = process.env.MOCK_GENERATION === "1";

class PipelineError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const STAGE_MARKERS = [
  { stage: "story", marker: /"story"\s*:/ },
  { stage: "scene", marker: /"scene"\s*:/ },
  { stage: "puzzles", marker: /"puzzles"\s*:/ },
];

async function streamModelResponse({ systemPrompt, theme, difficulty, maxTokens, onEvent, signal }) {
  const stream = anthropic.messages.stream(
    {
      model: "claude-haiku-4-5",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Generate an escape room for theme: "${theme}", difficulty: "${difficulty}".`,
        },
      ],
    },
    { signal }
  );

  let text = "";
  let nextMarker = 0;
  stream.on("text", (delta) => {
    text += delta;
    while (nextMarker < STAGE_MARKERS.length && STAGE_MARKERS[nextMarker].marker.test(text)) {
      onEvent({ type: "stage", stage: STAGE_MARKERS[nextMarker].stage });
      nextMarker++;
    }
  });
  await stream.finalMessage();
  return text;
}

/** Replays the mock fixture through the same stage beats the model path
    emits, with human-scale pacing. The result still runs the real
    validators, puzzle builders, and family normalization. */
async function mockModelResponse({ theme, difficulty, onEvent, signal }) {
  for (const [stage, delay] of [["story", 900], ["scene", 1000], ["puzzles", 1200]]) {
    await sleep(delay);
    if (signal?.aborted) throw new PipelineError(499, "client disconnected");
    onEvent({ type: "stage", stage });
  }
  await sleep(800);
  return JSON.stringify(buildMockRoom(theme, difficulty));
}

async function runGenerationPipeline({ theme, difficulty, onEvent, signal }) {
  const config = DIFFICULTY_CONFIG[difficulty];
  const systemPrompt = buildSystemPrompt(difficulty);
  onEvent({ type: "stage", stage: "brief" });

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    const rawText = MOCK_GENERATION
      ? await mockModelResponse({ theme, difficulty, onEvent, signal })
      : await streamModelResponse({
          systemPrompt,
          theme,
          difficulty,
          maxTokens: config.maxTokens,
          onEvent,
          signal,
        });

    onEvent({ type: "stage", stage: "check" });

    const room = parseRoomJson(rawText);
    const failureReason = room
      ? getValidationFailureReason(room)
      : "SCHEMA: model did not return valid JSON";
    if (failureReason) {
      const category = failureReason.startsWith("SCHEMA:") ? "SCHEMA" : "QUALITY";
      const reason = failureReason.replace(/^SCHEMA:\s*/, "");
      console.log(
        `[generate-room] attempt ${attempt}/${config.maxAttempts} discarded — ${category}: ${reason}`
      );
      if (attempt < config.maxAttempts) {
        onEvent({ type: "retry", attempt, max: config.maxAttempts, category, reason });
      }
      continue;
    }

    onEvent({ type: "stage", stage: "build" });
    buildPuzzles(room, config);
    normalizeVisualFamily(room);
    return room;
  }

  throw new PipelineError(
    500,
    "Failed to generate a valid room after retries — puzzles kept failing consistency checks"
  );
}

function validateGenerateParams(body) {
  const { theme, difficulty } = body || {};
  if (typeof theme !== "string" || theme.trim().length === 0) {
    return { error: "theme is required and must be a non-empty string" };
  }
  return {
    theme: theme.trim(),
    difficulty: ["easy", "medium", "hard"].includes(difficulty) ? difficulty : "medium",
  };
}

app.post("/generate-room", generateRoomLimiter, async (req, res) => {
  const params = validateGenerateParams(req.body);
  if (params.error) return res.status(400).json({ error: params.error });

  console.log(`[generate-room] theme="${params.theme}" at ${new Date().toISOString()}`);

  try {
    const room = await runGenerationPipeline({ ...params, onEvent: () => {} });
    return res.status(200).json(room);
  } catch (err) {
    if (err instanceof PipelineError) return res.status(err.status).json({ error: err.message });
    return handleAnthropicError(err, res);
  }
});

/**
 * Streaming variant: NDJSON progress events (one JSON object per line)
 * followed by { type: "room", room } on success or { type: "error", ... }.
 * The response is always HTTP 200 once streaming begins; outcomes travel
 * in-band. Client disconnect aborts the model stream.
 */
app.post("/generate-room/stream", generateRoomLimiter, async (req, res) => {
  const params = validateGenerateParams(req.body);
  if (params.error) return res.status(400).json({ error: params.error });

  console.log(`[generate-room/stream] theme="${params.theme}" at ${new Date().toISOString()}`);

  res.status(200).set({
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
  });
  res.flushHeaders();

  const send = (event) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };
  // res "close" (not req) is the reliable disconnect signal once the request
  // body has been fully read; it also fires after a normal end, so guard.
  const aborter = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) aborter.abort();
  });
  const heartbeat = setInterval(() => send({ type: "ping" }), 10000);

  try {
    const room = await runGenerationPipeline({
      ...params,
      onEvent: send,
      signal: aborter.signal,
    });
    send({ type: "room", room });
  } catch (err) {
    if (aborter.signal.aborted) {
      console.log("[generate-room/stream] client disconnected — generation aborted");
    } else if (err instanceof PipelineError) {
      send({ type: "error", error: err.message, status: err.status });
    } else {
      send({ type: "error", ...mapAnthropicError(err) });
    }
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

const VALID_VISUAL_FAMILIES = [
  "sci-fi",
  "fantasy",
  "horror-gothic",
  "noir-mystery",
  "nature",
  "cyberpunk",
];

// Checked in order, most specific/distinctive keywords first, so a theme
// that touches multiple genres (e.g. "haunted spaceship") lands on the
// family with the strongest signal rather than the first alphabetically.
const VISUAL_FAMILY_KEYWORD_RULES = [
  {
    family: "cyberpunk",
    keywords: ["cyberpunk", "neon", "megacorp", "mega corp", "hacker", "chrome", "cybernetic"],
  },
  {
    family: "horror-gothic",
    keywords: ["haunted", "ghost", "horror", "gothic", "curse", "vampire", "zombie", "crypt", "graveyard", "demon", "possessed"],
  },
  {
    family: "fantasy",
    keywords: ["wizard", "magic", "dragon", "castle", "kingdom", "elf", "sorcer", "spell", "academy", "knight", "potion", "enchant", "siege"],
  },
  {
    family: "noir-mystery",
    keywords: ["mystery", "detective", "noir", "murder", "crime", "library", "clue", "investigat", "heist"],
  },
  {
    family: "nature",
    keywords: ["forest", "jungle", "ocean", "underwater", "mountain", "wild", "garden", "reef", "cave", "volcano"],
  },
  {
    family: "sci-fi",
    keywords: ["spaceship", "space station", "starship", "galaxy", "alien", "robot", "android", "reactor", "laser", "cosmic", "orbit", "planet", "cyborg", "jedi", "sith", "droid", "lightsaber", "star wars"],
  },
];

/**
 * Best-effort genre classification from the theme string alone, used only
 * as a fallback when the model doesn't return one of the six valid values.
 */
function inferVisualFamilyFromTheme(theme) {
  const lowerTheme = (theme || "").toLowerCase();
  for (const rule of VISUAL_FAMILY_KEYWORD_RULES) {
    if (rule.keywords.some((keyword) => lowerTheme.includes(keyword))) {
      return rule.family;
    }
  }
  return "fantasy";
}

/**
 * Ensures "visualFamily" is one of the six valid values, replacing it with a
 * keyword-based best guess if the model returned something else or omitted it.
 */
function normalizeVisualFamily(room) {
  if (!VALID_VISUAL_FAMILIES.includes(room.visualFamily)) {
    room.visualFamily = inferVisualFamilyFromTheme(room.theme);
  }
}

/**
 * Strips accidental markdown code fences before parsing, since models
 * occasionally wrap JSON in ```json ... ``` despite instructions not to.
 */
function parseRoomJson(rawText) {
  let text = rawText.trim();
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function mapAnthropicError(err) {
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, error: "Rate limited by Anthropic API", retryable: true };
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return { status: 500, error: "Anthropic authentication failed — check ANTHROPIC_API_KEY" };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { status: 502, error: "Could not reach Anthropic API", retryable: true };
  }
  if (err instanceof Anthropic.APIStatusError) {
    return { status: err.status >= 500 ? 502 : 400, error: err.message };
  }

  console.error("Unexpected error generating room:", err);
  return { status: 500, error: "Unexpected server error" };
}

function handleAnthropicError(err, res) {
  const mapped = mapAnthropicError(err);
  const body = { error: mapped.error };
  if (mapped.retryable) body.retryable = true;
  return res.status(mapped.status).json(body);
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`escape-room-backend listening on port ${PORT}`);
  if (MOCK_GENERATION) {
    console.log("⚠ MOCK_GENERATION=1 — serving the offline fixture, no Anthropic calls");
  }
});
