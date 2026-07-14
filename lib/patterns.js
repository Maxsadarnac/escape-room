/* =========================================================================
   Pattern rules — server-generated numeric sequences.

   Pattern puzzles use the same construction as ciphers: the model writes a
   flavor-only prompt (an in-world device showing a sequence — no numbers),
   and the server generates the sequence, the answer, and the hints from a
   rule picked here. Solvable-by-construction replaces the old post-hoc
   "does the model's sequence fit a rule?" check, and is what makes richer
   rules (interleaved threads, additive/Fibonacci, affine) safe to ship —
   the answer is known because we built it.

   Single-valid-answer guarantee: a generated sequence might coincidentally
   also fit one of the three *simple* rules (arithmetic / geometric /
   quadratic) with a different continuation, which would make the puzzle
   ambiguous. generateSequence re-rolls until the simple-rule solver
   (computeExpectedNext) either finds nothing or agrees with the intended
   answer.

   Each rule in RULES provides generate(): { shown, answer, hints } where
   `shown` is the visible terms and `hints` runs subtle -> explicit (the
   final hint states the answer, mirroring the cipher mechanics).
   ========================================================================= */

const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

/* ---- Simple-rule solver (also used by validation + ambiguity guard) ----- */

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
 * Extracts the longest comma-separated run of numbers found in text (e.g.
 * "2, 4, 6, 8, ?" -> [2, 4, 6, 8]). Returns null if no run of 3+ numbers
 * is found. Used by validation to reject pattern prompts that embed their
 * own sequence (the server appends the authoritative one).
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

/* ---- Rule generators ------------------------------------------------------ */

const RULES = {
  arithmetic: {
    generate() {
      const start = randInt(2, 15);
      const d = randInt(2, 9);
      const shown = [0, 1, 2, 3].map((i) => start + d * i);
      const answer = start + d * 4;
      return {
        shown,
        answer,
        hints: [
          "Compare each number to the one before it.",
          `The gap between neighbors never changes — it is ${d}.`,
          `Add ${d} to ${shown[shown.length - 1]} to get ${answer}.`,
        ],
      };
    },
  },
  geometric: {
    generate() {
      const start = randInt(2, 5);
      const r = randInt(2, 3);
      const shown = [0, 1, 2, 3].map((i) => start * r ** i);
      const answer = start * r ** 4;
      return {
        shown,
        answer,
        hints: [
          "The jumps grow — this is not simple addition.",
          `Each value is ${r} times the one before it.`,
          `Multiply ${shown[shown.length - 1]} by ${r} to get ${answer}.`,
        ],
      };
    },
  },
  quadratic: {
    generate() {
      const start = randInt(1, 12);
      const d0 = randInt(2, 8);
      const c = randInt(2, 6);
      // diffs: d0, d0+c, d0+2c, ...
      const shown = [start];
      for (let i = 0; i < 3; i++) shown.push(shown[i] + d0 + c * i);
      const nextDiff = d0 + c * 3;
      const answer = shown[shown.length - 1] + nextDiff;
      return {
        shown,
        answer,
        hints: [
          "The gaps themselves are changing — look at the differences of the differences.",
          `Each gap grows by ${c} over the one before it.`,
          `The next gap is ${nextDiff}, so ${shown[shown.length - 1]} + ${nextDiff} = ${answer}.`,
        ],
      };
    },
  },
  alternating: {
    generate() {
      // Two interleaved arithmetic threads: A0 B0 A1 B1 A2 -> answer B2.
      const a0 = randInt(2, 12);
      const d1 = randInt(2, 9);
      const b0 = randInt(15, 40);
      let d2 = randInt(2, 9);
      if (d2 === d1) d2 += 1; // distinct rhythms keep the threads visible
      const shown = [a0, b0, a0 + d1, b0 + d2, a0 + 2 * d1];
      const answer = b0 + 2 * d2;
      return {
        shown,
        answer,
        hints: [
          "Two rhythms are woven together — read every other number.",
          "Positions 1, 3, 5 follow one thread; positions 2, 4 follow another. The missing value belongs to the second thread.",
          `The second thread goes ${b0}, ${b0 + d2}, … add ${d2} again to get ${answer}.`,
        ],
      };
    },
  },
  fibonacci: {
    generate() {
      // Additive: each term is the sum of the previous two.
      const a = randInt(1, 9);
      const b = randInt(a + 1, 12); // strictly growing reads clearer
      const shown = [a, b];
      while (shown.length < 5) {
        shown.push(shown[shown.length - 1] + shown[shown.length - 2]);
      }
      const answer = shown[shown.length - 1] + shown[shown.length - 2];
      return {
        shown,
        answer,
        hints: [
          "No single gap or ratio explains it — look at neighboring pairs.",
          "Each number is the sum of the two before it.",
          `${shown[shown.length - 2]} + ${shown[shown.length - 1]} = ${answer}.`,
        ],
      };
    },
  },
  affine: {
    generate() {
      // next = m * x + c
      const m = randInt(2, 3);
      const c = randInt(1, 6);
      const start = randInt(1, 6);
      const shown = [start];
      for (let i = 0; i < 3; i++) shown.push(shown[i] * m + c);
      const answer = shown[shown.length - 1] * m + c;
      return {
        shown,
        answer,
        hints: [
          "Neither a fixed step nor a plain ratio fits — the rule has two parts.",
          `Each value is multiplied by ${m}, then ${c} is added.`,
          `${shown[shown.length - 1]} × ${m} + ${c} = ${answer}.`,
        ],
      };
    },
  },
};

const MAX_GENERATION_TRIES = 40;
const ANSWER_CAP = 2000;

/**
 * Generates a sequence for the given rule, re-rolling until it is
 * unambiguous: the simple-rule solver must either find no continuation or
 * agree with the intended answer, and values stay in a readable range.
 */
function generateSequence(ruleId) {
  const rule = RULES[ruleId];
  for (let attempt = 0; attempt < MAX_GENERATION_TRIES; attempt++) {
    const candidate = rule.generate();
    if (candidate.answer > ANSWER_CAP) continue;
    const simpleNext = computeExpectedNext(candidate.shown);
    if (simpleNext !== null && Math.abs(simpleNext - candidate.answer) > 1e-6) continue;
    return candidate;
  }
  // Every rule's own construction is consistent, so the guard can only
  // reject rare collisions — after many tries fall back to arithmetic,
  // which is always self-consistent.
  return RULES.arithmetic.generate();
}

/**
 * Replaces a pattern puzzle's prompt tail, answer, and hints with a
 * server-generated sequence from a randomly chosen allowed rule.
 *
 * @param allowedRules string[] of RULES keys for this difficulty
 */
function applyPattern(puzzle, allowedRules) {
  const ruleId = allowedRules[Math.floor(Math.random() * allowedRules.length)];
  const { shown, answer, hints } = generateSequence(ruleId);

  puzzle.answer = String(answer);
  puzzle.patternRule = ruleId;
  puzzle.prompt = `${puzzle.prompt.trim()} The sequence reads: ${shown.join(", ")}, ?`;
  puzzle.hints = hints;
}

module.exports = {
  RULES,
  applyPattern,
  generateSequence,
  computeExpectedNext,
  extractNumberSequence,
};
