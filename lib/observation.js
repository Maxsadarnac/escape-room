/* =========================================================================
   Observation puzzles — the room itself is the clue.

   The model writes a flavor-only prompt (a lock that "has been watching
   the room", a tally the space keeps — no numbers, no object names); the
   server appends the real question, built from the decor manifest it just
   generated (lib/decor.js). Because the same manifest drives the 3D scene,
   the answer is correct by construction: the player counts what is
   actually standing around them.

   Difficulty is the `terms` knob:
     1 — count one kind                                   (easy)
     2 — combine two kinds with one operation             (medium)
     3 — two-step arithmetic across three kinds           (hard)
   ========================================================================= */

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* Each op provides the wording fragment and the arithmetic; answers are
   kept positive by construction (difference is larger-minus-smaller,
   counts are pairwise distinct). */
const TWO_TERM_OPS = [
  {
    id: "sum",
    phrase: (a, b) => `add the number of ${a} to the number of ${b}`,
    compute: (a, b) => a + b,
    explain: (a, b, la, lb) => `${a} ${la} + ${b} ${lb} = ${a + b}`,
  },
  {
    id: "product",
    phrase: (a, b) => `multiply the number of ${a} by the number of ${b}`,
    compute: (a, b) => a * b,
    explain: (a, b, la, lb) => `${a} ${la} × ${b} ${lb} = ${a * b}`,
  },
  {
    id: "difference",
    phrase: (a, b) => `take the number of ${a} and the number of ${b}, and find how far apart they are`,
    compute: (a, b) => Math.abs(a - b),
    explain: (a, b, la, lb) =>
      `${Math.max(a, b)} ${a >= b ? la : lb} − ${Math.min(a, b)} ${a >= b ? lb : la} = ${Math.abs(a - b)}`,
  },
];

const THREE_TERM_OPS = [
  {
    id: "product-plus",
    phrase: (a, b, c) =>
      `multiply the number of ${a} by the number of ${b}, then add the number of ${c}`,
    compute: (a, b, c) => a * b + c,
    explain: (a, b, c) => `${a} × ${b} + ${c} = ${a * b + c}`,
  },
  {
    id: "sum-times",
    phrase: (a, b, c) =>
      `add the number of ${a} to the number of ${b}, then multiply by the number of ${c}`,
    compute: (a, b, c) => (a + b) * c,
    explain: (a, b, c) => `(${a} + ${b}) × ${c} = ${(a + b) * c}`,
  },
];

/** Fisher-Yates on a copy — decor manifests are tiny. */
function shuffled(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Replaces an observation puzzle's prompt tail, answer, and hints with a
 * question computed from the room's decor manifest. The manifest must
 * already exist (buildDecor runs before puzzle builders in the pipeline).
 *
 * @param cfg { terms: 1 | 2 | 3 }
 */
function applyObservation(puzzle, cfg, room) {
  const items = room?.scene?.decor?.items || [];
  const terms = Math.min(Math.max(cfg.terms || 1, 1), Math.min(3, items.length));
  const chosen = shuffled(items).slice(0, terms);
  const labels = chosen.map((c) => c.label);
  const counts = chosen.map((c) => c.count);

  let question;
  let answer;
  let explainLine;

  if (terms === 1) {
    question = `Count the ${labels[0]} in this room — that number is the key.`;
    answer = counts[0];
    explainLine = `There are ${counts[0]} ${labels[0]} — the answer is ${counts[0]}.`;
  } else if (terms === 2) {
    const op = pick(TWO_TERM_OPS);
    question = `Look around the room itself: ${op.phrase(labels[0], labels[1])} — that number is the key.`;
    answer = op.compute(counts[0], counts[1]);
    explainLine = `${op.explain(counts[0], counts[1], labels[0], labels[1])} — the answer is ${answer}.`;
    puzzle.observationOp = op.id;
  } else {
    const op = pick(THREE_TERM_OPS);
    question = `Look around the room itself: ${op.phrase(labels[0], labels[1], labels[2])} — that number is the key.`;
    answer = op.compute(counts[0], counts[1], counts[2]);
    explainLine = `Counting ${labels.join(", ")}: ${op.explain(counts[0], counts[1], counts[2])} — the answer is ${answer}.`;
    puzzle.observationOp = op.id;
  }

  puzzle.answer = String(answer);
  puzzle.observationKinds = chosen.map((c) => c.kind);
  puzzle.prompt = `${puzzle.prompt.trim()} ${question}`;
  puzzle.hints = [
    "The lock isn't hiding its clue in words — the answer is standing around you, in the room itself.",
    `Take stock of what furnishes this place: ${labels
      .map((l, i) => `there are ${counts[i]} ${l}`)
      .join(", and ")}.`,
    explainLine,
  ];
}

module.exports = { applyObservation, TWO_TERM_OPS, THREE_TERM_OPS };
