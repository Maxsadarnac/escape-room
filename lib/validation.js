/* =========================================================================
   Draft-room validation.

   Two layers, run against a freshly parsed model draft (before the server
   builds cipher/pattern content into it):

   1. findMissingFieldReason — structural schema problems (missing/mistyped
      fields). Reported with a SCHEMA: prefix so the server can log failure
      categories.
   2. QUALITY_CHECKS — content-quality problems, each a { reason, test }
      entry. Adding a check = adding one entry; the first failing check's
      reason is reported.

   What each puzzle type relies on for its solvability guarantee:
     cipher      — answer/encoding/hints are server-built (lib/ciphers.js);
                   only the plaintext's 3-5 word shape is checked here.
     pattern     — sequence/answer/hints are server-built (lib/patterns.js);
                   drafts may omit answer/hints, and prompts embedding their
                   own number run are rejected.
     observation — question/answer/hints are server-built from the decor
                   manifest (lib/observation.js); drafts may omit
                   answer/hints, and prompts containing digits are rejected
                   (the server appends the only numbers that matter).
     arrangement — order/clues/answer/hints are server-built and
                   uniqueness-verified by exhaustive search
                   (lib/arrangement.js); the draft contributes 4-5 distinct
                   item names, checked here.
     riddle      — model-authored; checked for reused public riddles, leaked
                   answers, leaked reasoning.
     logic       — model-authored; checked for hint/answer contradictions,
                   constraint-satisfaction grids, leaked answers/reasoning.
   (type "meta" — the hard-difficulty finale — is appended by the server
   AFTER validation, entirely server-built, so it is not a draft type.)
   ========================================================================= */

const { extractNumberSequence, computeExpectedNext } = require("./patterns");

const VALID_PUZZLE_TYPES = ["cipher", "riddle", "pattern", "logic", "observation", "arrangement"];

// Types whose answer/hints the server generates — drafts may omit both.
const SERVER_AUTHORED_TYPES = new Set(["pattern", "observation", "arrangement"]);

/* ---- Schema ---------------------------------------------------------------- */

/**
 * Checks the room against the required JSON schema shape (fields present
 * and correctly typed) — structural problems, not content quality.
 * Pattern puzzles may omit "answer" and "hints": the server generates both.
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
    const serverAuthored = SERVER_AUTHORED_TYPES.has(puzzle.type);
    if (!serverAuthored && (typeof puzzle.answer !== "string" || puzzle.answer.trim().length === 0)) {
      return `missing required field: answer (puzzle ${label})`;
    }
    if (
      !serverAuthored &&
      (!Array.isArray(puzzle.hints) ||
        puzzle.hints.length !== 3 ||
        puzzle.hints.some((h) => typeof h !== "string" || h.trim().length === 0))
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
    if (puzzle.type === "arrangement") {
      const items = puzzle.items;
      if (
        !Array.isArray(items) ||
        items.length < 4 ||
        items.length > 5 ||
        items.some((it) => typeof it !== "string" || it.trim().length === 0)
      ) {
        return `missing or invalid required field: items (arrangement puzzle ${label} needs 4-5 non-empty names)`;
      }
      const normalized = items.map((it) => it.trim().toLowerCase());
      if (new Set(normalized).size !== normalized.length) {
        return `invalid field: items (arrangement puzzle ${label} has duplicate names)`;
      }
      if (normalized.some((it) => it.split(/\s+/).length > 4)) {
        return `invalid field: items (arrangement puzzle ${label} item names must be at most 4 words)`;
      }
    }
  }
  return null;
}

/* ---- Quality checks ---------------------------------------------------------- */

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
 * Extracts distinct capitalized "name-like" words from text, filtering out
 * common English words that happen to be capitalized (sentence starts,
 * generic puzzle nouns). Single letters and acronyms (no lowercase) are
 * excluded since they're usually labels like "System A", not names.
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
 * Returns true if an 'observation' puzzle's prompt contains any digit. The
 * server appends the real counting question from the decor manifest —
 * model-written numbers beside it would either contradict the real counts
 * or read as the answer.
 */
function hasObservationPromptNumbers(room) {
  const puzzles = Array.isArray(room.puzzles) ? room.puzzles : [];
  return puzzles.some((puzzle) => {
    if (puzzle.type !== "observation") return false;
    if (typeof puzzle.prompt !== "string") return false;
    return /\d/.test(puzzle.prompt);
  });
}

/**
 * Returns true if a 'pattern' puzzle's prompt embeds its own number run.
 * The server generates the authoritative sequence and appends it to the
 * prompt — a model-written sequence alongside it would be confusing at
 * best and contradictory at worst, so such drafts are discarded.
 */
function hasPatternPromptSequence(room) {
  const puzzles = Array.isArray(room.puzzles) ? room.puzzles : [];
  return puzzles.some((puzzle) => {
    if (puzzle.type !== "pattern") return false;
    if (typeof puzzle.prompt !== "string") return false;
    return extractNumberSequence(puzzle.prompt) !== null;
  });
}

/* ---- Entry point ---------------------------------------------------------- */

// Checked in order; the first failing check's reason is reported. Adding a
// quality check = adding one entry here.
const QUALITY_CHECKS = [
  { reason: "puzzle answer leaked in its own prompt", test: hasLeakedAnswer },
  { reason: "cipher puzzle's plaintext isn't a 3-5 word phrase", test: hasInvalidCipherPlaintext },
  { reason: "hint contained leaked reasoning/self-correction text", test: hasLeakedReasoning },
  { reason: "logic puzzle hint contradicts its own answer field", test: hasLogicHintContradiction },
  {
    reason: "pattern puzzle embedded its own number sequence (the server generates the real one)",
    test: hasPatternPromptSequence,
  },
  {
    reason: "observation puzzle prompt contains numbers (the server appends the real counting question)",
    test: hasObservationPromptNumbers,
  },
  { reason: "riddle puzzle reused a well-known public riddle fragment", test: hasReusedPublicRiddle },
  {
    reason: "logic puzzle looks like an open constraint-satisfaction grid puzzle",
    test: hasConstraintSatisfactionLogic,
  },
];

/**
 * Runs all consistency checks against a freshly parsed room. Returns a
 * human-readable failure reason (SCHEMA-prefixed for structural problems),
 * or null if the room passes every check.
 */
function getValidationFailureReason(room) {
  const missingFieldReason = findMissingFieldReason(room);
  if (missingFieldReason) {
    return `SCHEMA: ${missingFieldReason}`;
  }
  for (const check of QUALITY_CHECKS) {
    if (check.test(room)) return check.reason;
  }
  return null;
}

module.exports = {
  VALID_PUZZLE_TYPES,
  getValidationFailureReason,
  findMissingFieldReason,
  // exposed for unit tests
  hasLeakedAnswer,
  hasInvalidCipherPlaintext,
  hasLeakedReasoning,
  hasLogicHintContradiction,
  hasPatternPromptSequence,
  hasObservationPromptNumbers,
  hasReusedPublicRiddle,
  hasConstraintSatisfactionLogic,
  computeExpectedNext,
};
