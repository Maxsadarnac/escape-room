/* =========================================================================
   Arrangement puzzles — ordering deduction with a proven-unique solution.

   The model contributes creative material only: 4-5 short on-theme item
   names plus a flavor prompt (a row of pedestals, a rack of relics...).
   The server invents a secret left-to-right order, generates true clues
   about it from a template bank, prunes them to a minimal set, and — the
   part that makes this shippable — VERIFIES BY EXHAUSTIVE SEARCH over all
   N! permutations that exactly one order satisfies the clue set. No
   trust in the model, no heuristics: the uniqueness proof is a brute-force
   count.

   The player answers with a digit string: items are numbered in the prompt
   in a fixed display order, and the answer reads the secret arrangement
   left to right by those numbers (e.g. "2413").
   ========================================================================= */

const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

function shuffled(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** All permutations of [0..n-1]. n is at most 5 (120 permutations). */
function allPermutations(n) {
  const out = [];
  const perm = Array.from({ length: n }, (_, i) => i);
  const recurse = (k) => {
    if (k === n) {
      out.push(perm.slice());
      return;
    }
    for (let i = k; i < n; i++) {
      [perm[k], perm[i]] = [perm[i], perm[k]];
      recurse(k + 1);
      [perm[k], perm[i]] = [perm[i], perm[k]];
    }
  };
  recurse(0);
  return out;
}

/* ---- Clue templates -------------------------------------------------------
   Every clue derives from a machine-readable spec ({ kind, a, b, ... } over
   item indices), so the built puzzle can carry its clue specs verbatim
   (puzzle.arrangementClues) and any later verifier — tests, an e2e check,
   a suspicious reader of the room JSON — can independently re-prove
   uniqueness without parsing prose. specToTest is the single source of
   truth for what each spec means; the text is just its narration.         */

function specToTest(spec) {
  const n = (perm) => perm.length;
  switch (spec.kind) {
    case "adjacent":
      return (perm) => perm.indexOf(spec.a) + 1 === perm.indexOf(spec.b);
    case "end":
      return spec.side === "left"
        ? (perm) => perm[0] === spec.item
        : (perm) => perm[n(perm) - 1] === spec.item;
    case "notEnd":
      return (perm) => perm[0] !== spec.item && perm[n(perm) - 1] !== spec.item;
    case "before":
      return (perm) => perm.indexOf(spec.a) < perm.indexOf(spec.b);
    case "notAdjacent":
      return (perm) => Math.abs(perm.indexOf(spec.a) - perm.indexOf(spec.b)) !== 1;
    default:
      throw new Error(`unknown clue spec kind: ${spec.kind}`);
  }
}

function specToText(spec, names) {
  switch (spec.kind) {
    case "adjacent":
      return `${cap(names[spec.a])} stands immediately to the left of ${names[spec.b]}.`;
    case "end":
      return `${cap(names[spec.item])} stands at the far ${spec.side}.`;
    case "notEnd":
      return `${cap(names[spec.item])} stands at neither end.`;
    case "before":
      return `${cap(names[spec.a])} stands somewhere to the left of ${names[spec.b]}.`;
    case "notAdjacent":
      return `${cap(names[spec.a])} and ${names[spec.b]} do not stand beside each other.`;
    default:
      throw new Error(`unknown clue spec kind: ${spec.kind}`);
  }
}

function makeClue(spec, names) {
  return { kind: spec.kind, spec, text: specToText(spec, names), test: specToTest(spec) };
}

function buildCluePool(secret, names) {
  const n = secret.length;
  const posOf = [];
  secret.forEach((item, pos) => {
    posOf[item] = pos;
  });
  const specs = [];

  // Immediate adjacency (left-of), for every neighboring pair.
  for (let pos = 0; pos < n - 1; pos++) {
    specs.push({ kind: "adjacent", a: secret[pos], b: secret[pos + 1] });
  }

  // Ends — strong anchors, at most one offered (trimmed by the caller).
  specs.push({ kind: "end", side: "left", item: secret[0] });
  specs.push({ kind: "end", side: "right", item: secret[n - 1] });

  // Not-at-either-end, for every interior item.
  for (let pos = 1; pos < n - 1; pos++) {
    specs.push({ kind: "notEnd", item: secret[pos] });
  }

  // Somewhere-left-of, for non-adjacent pairs (adjacent pairs already have
  // the stronger clue above).
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (posOf[i] + 1 < posOf[j]) {
        specs.push({ kind: "before", a: i, b: j });
      }
    }
  }

  // Not-beside, for pairs at distance >= 2.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(posOf[i] - posOf[j]) >= 2) {
        specs.push({ kind: "notAdjacent", a: i, b: j });
      }
    }
  }

  return specs.map((spec) => makeClue(spec, names));
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Number of permutations satisfying every clue — the uniqueness check. */
function countSolutions(clues, n, permutations) {
  const perms = permutations || allPermutations(n);
  let count = 0;
  for (const perm of perms) {
    if (clues.every((c) => c.test(perm))) count++;
  }
  return count;
}

const MAX_GENERATION_TRIES = 30;

/**
 * Generates { secret, clues } for the given item names: a random secret
 * order and a minimal clue set with a brute-force-verified unique solution.
 * Greedy build (shuffled pool, add while ambiguous), then reverse prune
 * (drop any clue whose removal keeps the solution unique).
 */
function generateArrangement(names) {
  const n = names.length;
  const perms = allPermutations(n);

  for (let attempt = 0; attempt < MAX_GENERATION_TRIES; attempt++) {
    const secret = shuffled(Array.from({ length: n }, (_, i) => i));
    // Cap the anchors: at most one end clue per puzzle keeps it a deduction
    // rather than a read-off.
    const pool = shuffled(buildCluePool(secret, names));
    const endClues = pool.filter((c) => c.kind === "end");
    const trimmedPool = pool.filter((c) => c.kind !== "end").concat(endClues.slice(0, 1));

    const chosen = [];
    for (const clue of shuffled(trimmedPool)) {
      if (countSolutions(chosen, n, perms) === 1) break;
      chosen.push(clue);
    }
    if (countSolutions(chosen, n, perms) !== 1) continue; // pool exhausted without uniqueness (rare)

    // Reverse prune to a minimal set.
    for (let i = chosen.length - 1; i >= 0; i--) {
      const without = chosen.slice(0, i).concat(chosen.slice(i + 1));
      if (countSolutions(without, n, perms) === 1) chosen.splice(i, 1);
    }

    // The guarantee this module exists for: exactly one valid answer.
    if (countSolutions(chosen, n, perms) !== 1) continue;
    if (!chosen.every((c) => c.test(secret))) continue; // paranoia: secret must be that answer

    return { secret, clues: chosen };
  }
  return null;
}

/** A display example for the prompt that is never the real answer. */
function examplePermutation(n, answer) {
  const digits = Array.from({ length: n }, (_, i) => String(i + 1));
  for (let tries = 0; tries < 20; tries++) {
    const candidate = shuffled(digits).join("");
    if (candidate !== answer) return candidate;
  }
  return digits.slice().reverse().join(""); // n>=4: reverse can't equal answer after 20 misses
}

/**
 * Replaces an arrangement puzzle's prompt tail, answer, and hints with a
 * server-generated deduction. Expects puzzle.items (validated: 4-5 short
 * distinct strings); uses at most cfg.size of them.
 *
 * @param cfg { size: 4 | 5 }
 */
function applyArrangement(puzzle, cfg) {
  const names = puzzle.items.map((s) => s.trim().toLowerCase()).slice(0, cfg.size || 5);
  const n = names.length;
  const generated = generateArrangement(names);
  if (!generated) {
    // Statistically negligible (see MAX_GENERATION_TRIES), but never ship an
    // unverified puzzle: degrade to a single-anchor arrangement that is
    // trivially unique — full order given by chained adjacency.
    const secret = Array.from({ length: n }, (_, i) => i);
    const clues = buildCluePool(secret, names).filter((c) => c.kind === "adjacent");
    clues.push({
      kind: "end",
      text: `${cap(names[secret[0]])} stands at the far left.`,
      test: (perm) => perm[0] === secret[0],
    });
    return finalizeArrangement(puzzle, names, secret, clues);
  }
  return finalizeArrangement(puzzle, names, generated.secret, generated.clues);
}

function finalizeArrangement(puzzle, names, secret, clues) {
  const n = names.length;
  const answer = secret.map((itemIdx) => itemIdx + 1).join("");
  const numbered = names.map((name, i) => `${i + 1} — ${name}`).join(";  ");
  const clueLines = clues.map((c) => c.text).join(" ");
  const example = examplePermutation(n, answer);

  puzzle.answer = answer;
  puzzle.arrangementSize = n;
  // Machine-readable clue specs (item indices match the numbering in the
  // prompt) — lets any verifier re-prove uniqueness from the room JSON.
  puzzle.arrangementClues = clues.map((c) => c.spec);
  puzzle.prompt =
    `${puzzle.prompt.trim()} The ${n} pieces are marked: ${numbered}. ` +
    `The inscription reads: ${clueLines} ` +
    `Enter their true order from left to right as a run of numbers (e.g. "${example}").`;

  // Partial reveal for the middle hint: pin one item the clues don't
  // already state outright (fall back to the leftmost).
  const revealPos = 1 + (secret.length > 2 ? randInt(0, n - 3) : 0);
  puzzle.hints = [
    "Anchor the strongest clues first — anything pinned to an end or forced immediately beside a neighbor — and the rest has only one place left to go.",
    `${cap(names[secret[revealPos]])} stands in position ${revealPos + 1} from the left.`,
    `Left to right the true order is: ${secret.map((i) => names[i]).join(", ")} — enter "${answer}".`,
  ];
  return puzzle;
}

module.exports = {
  applyArrangement,
  generateArrangement,
  buildCluePool,
  countSolutions,
  allPermutations,
  specToTest,
};
