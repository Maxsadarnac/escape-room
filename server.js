require("dotenv").config();

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const Anthropic = require("@anthropic-ai/sdk");
const { buildMockRoom } = require("./mockRoom");

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
- Hints: exactly 3 per puzzle, in-world text only, ordered subtle to explicit. Never show your own reasoning ("let me", "wait,", "actually,", "hmm", "try again", etc.) — if a puzzle doesn't work while drafting, silently discard it and write a different one.
- Logic puzzles: answer must be numeric/computable, derived from math or counting clues — never an open "who's assigned to which station" grid-deduction puzzle. Never state the answer directly in "prompt". The final hint's number must match "answer".
- Riddle puzzles: original, written for this theme — never a reused classic (e.g. "cities but no houses"). The full riddle verse must appear in "prompt" itself.
- Pattern puzzles: a numeric sequence only (arithmetic, geometric, or quadratic) — never a symbol-tally/counting puzzle.
- On-theme requirement: every puzzle's "prompt", riddle verse, cipher "plaintext", and flavor text must reference specific, concrete elements of this exact theme — named objects, characters, locations, or concepts unique to its world (e.g. a superlaser core, a specific house or spell, a named reactor or character). Do not write generic content that could be reskinned onto any theme by swapping a label — a riddle about "cities but no houses" or a logic puzzle about generic "levels" and "systems" with no in-world identity is not acceptable. Ground the puzzle's substance itself in this world, not just its surrounding sentence.
- Every object's "puzzleId" must reference a real puzzle.
- "palette": exactly 3 hex colors matching the mood. Keep prose concise — hackathon demo, not a novel.`;

const DIFFICULTY_CONFIG = {
  easy: {
    cipherShiftRange: [1, 3],
    maxTokens: 2000,
    maxAttempts: 3,
    promptBlock: `This room is EASY difficulty:
- 3 puzzles total.
- Patterns: simple arithmetic (constant difference) only.
- Logic: single-step arithmetic only.
- First hint should be direct and revealing.`,
  },
  medium: {
    cipherShiftRange: [2, 8],
    maxTokens: 2000,
    maxAttempts: 3,
    promptBlock: `This room is MEDIUM difficulty:
- 4-5 puzzles total.
- Patterns: arithmetic, geometric, or quadratic.
- Logic: multi-step arithmetic word problems are fine.
- First hint should be a gentle nudge, not a direct answer.`,
  },
  hard: {
    cipherShiftRange: [5, 15],
    maxTokens: 3200,
    maxAttempts: 5,
    promptBlock: `This room is HARD difficulty:
- 5-6 puzzles total.
- Patterns: geometric or quadratic only (no constant-difference).
- Logic: at least 2 chained calculation steps.
- First hint should be vaguer/more abstract than medium. Keep every hint to 1-2 sentences — state the approach or result only, never intermediate arithmetic or out-loud thinking.`,
  },
};

function buildSystemPrompt(difficulty) {
  return `${SYSTEM_PROMPT}\n\n${DIFFICULTY_CONFIG[difficulty].promptBlock}`;
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
     { type: "stage", stage: "build" }    cipher encoding + family assignment

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
    validators, cipher encoding, and family normalization. */
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
    applyCipherEncoding(room, config.cipherShiftRange);
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

const VALID_PUZZLE_TYPES = ["cipher", "riddle", "pattern", "logic"];

/**
 * Checks the room against the required JSON schema shape (fields present
 * and correctly typed) — structural problems, not content quality. Kept
 * separate from the content-quality checks below so failures can be
 * tracked by category (SCHEMA vs QUALITY) in the server logs.
 */
function findMissingFieldReason(room) {
  if (!Array.isArray(room.puzzles) || room.puzzles.length === 0) {
    return "missing required field: puzzles array";
  }
  for (const puzzle of room.puzzles) {
    const label = typeof puzzle.id === "string" && puzzle.id ? puzzle.id : "(unknown id)";
    if (typeof puzzle.id !== "string" || puzzle.id.trim().length === 0) {
      return "missing required field: puzzle.id";
    }
    if (!VALID_PUZZLE_TYPES.includes(puzzle.type)) {
      return `missing or invalid required field: type (puzzle ${label})`;
    }
    if (typeof puzzle.prompt !== "string" || puzzle.prompt.trim().length === 0) {
      return `missing required field: prompt (puzzle ${label})`;
    }
    if (typeof puzzle.answer !== "string" || puzzle.answer.trim().length === 0) {
      return `missing required field: answer (puzzle ${label})`;
    }
    if (
      !Array.isArray(puzzle.hints) ||
      puzzle.hints.length !== 3 ||
      puzzle.hints.some((h) => typeof h !== "string" || h.trim().length === 0)
    ) {
      return `missing required field: hints (puzzle ${label})`;
    }
    if (!Array.isArray(puzzle.requires)) {
      return `missing required field: requires (puzzle ${label})`;
    }
    if (
      puzzle.type === "cipher" &&
      (typeof puzzle.plaintext !== "string" || puzzle.plaintext.trim().length === 0)
    ) {
      return `missing required field: plaintext (cipher puzzle ${label})`;
    }
  }
  return null;
}

/**
 * Runs all consistency checks against a freshly parsed room. Returns a
 * human-readable failure reason, or null if the room passes every check.
 */
function getValidationFailureReason(room) {
  const missingFieldReason = findMissingFieldReason(room);
  if (missingFieldReason) {
    return `SCHEMA: ${missingFieldReason}`;
  }
  if (hasLeakedAnswer(room)) {
    return "puzzle answer leaked in its own prompt";
  }
  if (hasInvalidCipherPlaintext(room)) {
    return "cipher puzzle's plaintext isn't a 3-5 word phrase";
  }
  if (hasLeakedReasoning(room)) {
    return "hint contained leaked reasoning/self-correction text";
  }
  if (hasLogicHintContradiction(room)) {
    return "logic puzzle hint contradicts its own answer field";
  }
  if (hasPatternMismatch(room)) {
    return "pattern puzzle's answer doesn't match the sequence's arithmetic/geometric/quadratic rule";
  }
  if (hasReusedPublicRiddle(room)) {
    return "riddle puzzle reused a well-known public riddle fragment";
  }
  if (hasConstraintSatisfactionLogic(room)) {
    return "logic puzzle looks like an open constraint-satisfaction grid puzzle";
  }
  return null;
}

const CAPITALIZED_WORD_STOPWORDS = new Set([
  "The", "A", "An", "If", "What", "From", "Each", "This", "That", "You", "Your",
  "How", "Which", "Where", "When", "Who", "After", "Before", "During", "While",
  "Since", "For", "In", "On", "At", "Is", "Are", "Was", "Were", "Has", "Have",
  "Had", "Will", "Would", "Could", "Should", "Total", "Add", "Calculate", "Find",
  "Determine", "System", "Systems", "Clue", "Clues", "Level", "Levels", "Cycle",
  "Cycles", "All", "One", "Two", "Three", "Four", "Five", "Six", "Seven",
  "Eight", "Nine", "Ten", "Zero", "First", "Second", "Third", "Only", "Every",
  "Number", "Numbers", "Code", "Codes", "Answer", "Start", "Begin", "Consider",
  "Remember", "Note", "There", "Here", "Now", "Then", "So", "But", "And", "Or",
  "Not", "No", "Yes", "It", "They", "We", "He", "She", "Its", "To", "Of", "By",
  "With", "As", "Can", "Do", "Does", "Use", "Using",
]);

/**
 * Extracts distinct capitalized "name-like" words from text (mid-word
 * capitals, e.g. "Vex", "Kor", "Mira"), filtering out common English words
 * that happen to be capitalized (sentence starts, generic puzzle nouns).
 * Single letters and acronyms (no lowercase) are excluded since they're
 * usually labels like "System A", not character names.
 */
function extractCapitalizedNames(text) {
  const matches = text.match(/\b[A-Z][a-z]+\b/g) || [];
  return new Set(matches.filter((w) => !CAPITALIZED_WORD_STOPWORDS.has(w)));
}

const CONSTRAINT_SATISFACTION_SIGNAL_WORDS = [
  "assigned", "assign", "stationed", "station", "which", "matches", "match",
  "corresponds", "correspond",
];

/**
 * Returns true if a 'logic' puzzle's prompt looks like an open
 * constraint-satisfaction grid puzzle (e.g. "which person is assigned to
 * which station") rather than a numeric/computable puzzle: 3+ distinct
 * name-like capitalized words combined with assignment/matching language.
 */
function hasConstraintSatisfactionLogic(room) {
  const puzzles = Array.isArray(room.puzzles) ? room.puzzles : [];
  return puzzles.some((puzzle) => {
    if (puzzle.type !== "logic") return false;
    if (typeof puzzle.prompt !== "string") return false;

    const names = extractCapitalizedNames(puzzle.prompt);
    if (names.size < 3) return false;

    const lowerPrompt = puzzle.prompt.toLowerCase();
    return CONSTRAINT_SATISFACTION_SIGNAL_WORDS.some((word) => lowerPrompt.includes(word));
  });
}

// Each entry is a known public riddle broken into its most distinctive core
// fragments. A fragment can be a single required substring, or an array of
// OR-alternatives (any one of which counts as that fragment being present).
// Matching is fragment-based rather than one exact phrase so that reworded
// variants (filler words, different punctuation, swapped verbs) still get
// caught, as long as enough of the riddle's distinctive substance is there.
const KNOWN_PUBLIC_RIDDLES = [
  {
    name: "cities-forests-water-classic",
    fragments: ["cities", "no houses", "forests", "no trees", "water", ["no fish", "no waves"]],
  },
  { name: "speaks-without-a-mouth", fragments: ["speak", ["without a mouth", "no mouth"]] },
  { name: "keys-no-locks", fragments: ["keys", "no locks"] },
  { name: "not-alive-yet-grows", fragments: ["not alive", "yet i grow"] },
  { name: "no-lungs-needs-air", fragments: ["no lungs", "yet i need air"] },
  {
    name: "more-you-take-more-you-leave",
    fragments: ["the more you take", "the more you leave behind"],
  },
  { name: "broken-before-you-use-it", fragments: ["has to be broken", "before you can use it"] },
  { name: "face-two-hands-no-arms", fragments: ["a face and two hands", "no arms or legs"] },
  { name: "comes-down-never-goes-up", fragments: ["comes down", "never goes up"] },
  { name: "taken-from-a-mine", fragments: ["taken from a mine"] },
  { name: "wetter-the-more-it-dries", fragments: ["gets wetter", "the more it dries"] },
  { name: "has-an-eye-cannot-see", fragments: ["has an eye", "cannot see"] },
];

/**
 * Lowercases, strips punctuation, and collapses whitespace so paraphrased
 * riddles (different punctuation, added filler words) normalize to
 * comparable text.
 */
function normalizeRiddleText(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fragmentIsPresent(normalizedText, fragmentSpec) {
  const alternatives = Array.isArray(fragmentSpec) ? fragmentSpec : [fragmentSpec];
  return alternatives.some((alt) => normalizedText.includes(normalizeRiddleText(alt)));
}

/**
 * A known riddle counts as reused if enough of its distinctive fragments
 * appear in the normalized text — all of them for short riddles (2-3
 * fragments, where any single one is already a strong signal), or a
 * majority for longer/composite riddles (so a couple of dropped/reworded
 * clues don't let it slip through, but one stray shared word doesn't
 * false-positive either).
 */
function matchesKnownRiddle(normalizedText, riddle) {
  const matchedCount = riddle.fragments.filter((f) => fragmentIsPresent(normalizedText, f)).length;
  const threshold =
    riddle.fragments.length <= 3 ? riddle.fragments.length : Math.ceil(riddle.fragments.length * 0.6);
  return matchedCount >= threshold;
}

/**
 * Returns true if any 'riddle' puzzle's prompt matches a known public riddle
 * closely enough (fragment-based, after normalization) that it's a reuse or
 * paraphrase rather than an original riddle written for the theme.
 */
function hasReusedPublicRiddle(room) {
  const puzzles = Array.isArray(room.puzzles) ? room.puzzles : [];
  return puzzles.some((puzzle) => {
    if (puzzle.type !== "riddle") return false;
    if (typeof puzzle.prompt !== "string") return false;
    const normalized = normalizeRiddleText(puzzle.prompt);
    return KNOWN_PUBLIC_RIDDLES.some((riddle) => matchesKnownRiddle(normalized, riddle));
  });
}

/**
 * Returns true if any 'logic' or 'riddle' puzzle's prompt declares its own
 * answer outright (e.g. "the green lever is correct", "the code is 1975").
 * Logic/riddle clues legitimately mention candidate values (colors, dates,
 * names) as part of the setup, so a plain substring match on the answer
 * would false-positive constantly — this only flags declarative phrasing.
 */
function hasLeakedAnswer(room) {
  const puzzles = Array.isArray(room.puzzles) ? room.puzzles : [];
  return puzzles.some((puzzle) => {
    if (puzzle.type !== "logic" && puzzle.type !== "riddle") {
      return false;
    }
    if (typeof puzzle.answer !== "string" || typeof puzzle.prompt !== "string") {
      return false;
    }
    const answer = puzzle.answer.trim();
    // Short numeric answers (e.g. "1", "12") are too generic to reliably
    // flag as leaks — they routinely reappear in prompts as unrelated list
    // indices, counts, or positions (e.g. "position 1 through 4").
    if (/^\d{1,2}$/.test(answer)) {
      return false;
    }
    const escaped = answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const declarationPattern = new RegExp(
      `\\b${escaped}\\b\\s+(is|was)\\s+(the\\s+)?(correct|answer|code|solution)\\b` +
        `|\\b(answer|code|solution)\\s+(is|was)\\s*:?\\s*["']?${escaped}\\b`,
      "i"
    );
    return declarationPattern.test(puzzle.prompt);
  });
}

/**
 * Returns true if any 'cipher' puzzle's "plaintext" isn't a 3-5 word phrase.
 * Bare presence of "plaintext" is already guaranteed by
 * findMissingFieldReason, which runs first — this only checks word count.
 */
function hasInvalidCipherPlaintext(room) {
  const puzzles = Array.isArray(room.puzzles) ? room.puzzles : [];
  return puzzles.some((puzzle) => {
    if (puzzle.type !== "cipher") {
      return false;
    }
    if (typeof puzzle.plaintext !== "string" || puzzle.plaintext.trim().length === 0) {
      return false;
    }
    const wordCount = puzzle.plaintext.trim().split(/\s+/).length;
    return wordCount < 3 || wordCount > 5;
  });
}

const LEAKED_REASONING_TELLS = ["let me", "wait,", "actually,", "recalculate", "hmm", "try again"];

/**
 * Returns true if any puzzle's hints contain model scratch-work tells
 * (self-correction language, or the word "try " repeated in one hint).
 */
function hasLeakedReasoning(room) {
  const puzzles = Array.isArray(room.puzzles) ? room.puzzles : [];
  return puzzles.some((puzzle) => {
    const hints = Array.isArray(puzzle.hints) ? puzzle.hints : [];
    return hints.some((hint) => {
      if (typeof hint !== "string") return false;
      const lower = hint.toLowerCase();
      if (LEAKED_REASONING_TELLS.some((tell) => lower.includes(tell))) {
        return true;
      }
      const tryCount = (lower.match(/try /g) || []).length;
      return tryCount > 1;
    });
  });
}

/**
 * Returns true if a 'logic' puzzle's answer is numeric and its most explicit
 * hint concludes with a different number than the stored answer.
 */
function hasLogicHintContradiction(room) {
  const puzzles = Array.isArray(room.puzzles) ? room.puzzles : [];
  return puzzles.some((puzzle) => {
    if (puzzle.type !== "logic") return false;
    if (typeof puzzle.answer !== "string" || !/^-?\d+(\.\d+)?$/.test(puzzle.answer.trim())) {
      return false;
    }
    const answerNum = parseFloat(puzzle.answer.trim());
    const hints = Array.isArray(puzzle.hints) ? puzzle.hints : [];
    const explicitHint = hints[hints.length - 1];
    if (typeof explicitHint !== "string") return false;
    const numbers = explicitHint.match(/-?\d+(\.\d+)?/g) || [];
    if (numbers.length === 0) return false;
    return !numbers.some((n) => parseFloat(n) === answerNum);
  });
}

/**
 * Extracts the longest comma-separated run of numbers found in text (e.g.
 * "2, 4, 6, 8, ?" -> [2, 4, 6, 8]). Returns null if no run of 3+ numbers
 * is found, since that means there's no clear numeric sequence to verify.
 */
function extractNumberSequence(text) {
  const runPattern = /-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?)+/g;
  const matches = text.match(runPattern) || [];
  if (matches.length === 0) return null;

  const longest = matches.reduce((best, current) =>
    current.split(",").length > best.split(",").length ? current : best
  );
  const numbers = longest.split(",").map((n) => parseFloat(n.trim()));
  return numbers.length >= 3 ? numbers : null;
}

/**
 * Given a numeric sequence, returns the next value if it fits a constant
 * difference (arithmetic), constant ratio (geometric), or constant
 * difference-of-differences (quadratic) rule. Returns null if none fit.
 */
function computeExpectedNext(seq) {
  const EPSILON = 1e-6;
  const allEqual = (arr) => arr.every((v) => Math.abs(v - arr[0]) < EPSILON);

  const diffs = [];
  for (let i = 1; i < seq.length; i++) diffs.push(seq[i] - seq[i - 1]);

  if (allEqual(diffs)) {
    return seq[seq.length - 1] + diffs[0];
  }

  if (!seq.includes(0)) {
    const ratios = [];
    for (let i = 1; i < seq.length; i++) ratios.push(seq[i] / seq[i - 1]);
    if (allEqual(ratios)) {
      return seq[seq.length - 1] * ratios[0];
    }
  }

  if (diffs.length >= 2) {
    const secondDiffs = [];
    for (let i = 1; i < diffs.length; i++) secondDiffs.push(diffs[i] - diffs[i - 1]);
    if (allEqual(secondDiffs)) {
      const nextDiff = diffs[diffs.length - 1] + secondDiffs[0];
      return seq[seq.length - 1] + nextDiff;
    }
  }

  return null;
}

/**
 * Returns true if a 'pattern' puzzle gives a numeric sequence in its prompt
 * that fits an arithmetic/geometric/quadratic rule, but the stored "answer"
 * doesn't match what that rule predicts as the next value. Puzzles with a
 * non-numeric answer, or a sequence that doesn't fit any of these three
 * rules (e.g. Fibonacci, symbol-based patterns), can't be checked this way
 * and are skipped rather than false-flagged.
 */
function hasPatternMismatch(room) {
  const puzzles = Array.isArray(room.puzzles) ? room.puzzles : [];
  return puzzles.some((puzzle) => {
    if (puzzle.type !== "pattern") return false;
    if (typeof puzzle.prompt !== "string" || typeof puzzle.answer !== "string") return false;

    const answerText = puzzle.answer.trim();
    if (!/^-?\d+(\.\d+)?$/.test(answerText)) return false;
    const answerNum = parseFloat(answerText);

    const seq = extractNumberSequence(puzzle.prompt);
    if (!seq) return false;

    const expected = computeExpectedNext(seq);
    if (expected === null) return false;

    return Math.abs(expected - answerNum) > 1e-6;
  });
}

/**
 * Replaces each 'cipher' puzzle's prompt and hints with deterministic,
 * server-generated content: a random Caesar shift within the given
 * difficulty-specific range encodes the model's plaintext, guaranteeing
 * the puzzle is always solvable.
 */
function applyCipherEncoding(room, shiftRange) {
  const [minShift, maxShift] = shiftRange;
  const puzzles = Array.isArray(room.puzzles) ? room.puzzles : [];
  puzzles.forEach((puzzle) => {
    if (puzzle.type !== "cipher") return;

    const shift = minShift + Math.floor(Math.random() * (maxShift - minShift + 1));
    const plaintext = puzzle.plaintext.trim();
    const ciphertext = caesarEncode(plaintext, shift);

    puzzle.answer = plaintext;
    puzzle.shift = shift;
    puzzle.prompt = `${puzzle.prompt.trim()} The coded text reads: "${ciphertext}"`.trim();
    puzzle.hints = [
      "The message uses a simple letter-shift cipher — every letter has moved the same number of steps in the alphabet.",
      `Try shifting each letter backward by ${shift} positions.`,
      `Shifting each letter back by ${shift} reveals: "${plaintext.toUpperCase()}".`,
    ];
  });
}

/**
 * Encodes plaintext with a Caesar shift (A-Z only; other characters pass
 * through unchanged). Uppercases the input for a classic cipher look.
 */
function caesarEncode(plaintext, shift) {
  return plaintext
    .toUpperCase()
    .split("")
    .map((ch) => {
      if (ch >= "A" && ch <= "Z") {
        const code = ((ch.charCodeAt(0) - 65 + shift) % 26) + 65;
        return String.fromCharCode(code);
      }
      return ch;
    })
    .join("");
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
