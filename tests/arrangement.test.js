const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  applyArrangement,
  generateArrangement,
  buildCluePool,
  countSolutions,
  allPermutations,
} = require("../lib/arrangement");

const NAMES_4 = ["brass key", "iron key", "silver key", "bone key"];
const NAMES_5 = ["copper gyroscope", "sealed phial", "black lodestone", "tuning fork", "hollow prism"];
const ITERATIONS = 150;

/* ---- The guarantee this type ships on: exactly one valid answer ---------- */

test("every generated arrangement has exactly one solution (exhaustive check)", () => {
  for (const names of [NAMES_4, NAMES_5]) {
    const perms = allPermutations(names.length);
    for (let i = 0; i < ITERATIONS; i++) {
      const generated = generateArrangement(names);
      assert.ok(generated, "generation returned null");
      const { secret, clues } = generated;
      assert.equal(
        countSolutions(clues, names.length, perms),
        1,
        `ambiguous clue set for n=${names.length}`
      );
      assert.ok(
        clues.every((c) => c.test(secret)),
        "the secret does not satisfy its own clues"
      );
    }
  }
});

test("clue sets are minimal (no clue can be dropped)", () => {
  for (let i = 0; i < 60; i++) {
    const { clues } = generateArrangement(NAMES_5);
    const perms = allPermutations(5);
    for (let j = 0; j < clues.length; j++) {
      const without = clues.slice(0, j).concat(clues.slice(j + 1));
      assert.ok(
        countSolutions(without, 5, perms) > 1,
        `clue ${j} ("${clues[j].text}") is redundant`
      );
    }
  }
});

test("at most one end-anchor clue per puzzle", () => {
  for (let i = 0; i < 60; i++) {
    const { clues } = generateArrangement(NAMES_5);
    const ends = clues.filter((c) => c.kind === "end");
    assert.ok(ends.length <= 1, `${ends.length} end clues`);
  }
});

/* ---- applyArrangement wires it into the puzzle ----------------------------- */

test("applyArrangement: digit-string answer is a permutation matching the size", () => {
  for (const [names, size] of [[NAMES_4, 4], [NAMES_5, 5]]) {
    for (let i = 0; i < 60; i++) {
      const p = { id: "p1", type: "arrangement", prompt: "The rack waits.", items: names, requires: [] };
      applyArrangement(p, { size });
      assert.match(p.answer, new RegExp(`^[1-${size}]{${size}}$`));
      assert.equal(new Set(p.answer.split("")).size, size, "answer digits must be distinct");
      assert.equal(p.arrangementSize, size);
    }
  }
});

test("applyArrangement: prompt numbers every item and shows a non-answer example", () => {
  const p = { id: "p1", type: "arrangement", prompt: "The rack waits.", items: NAMES_5, requires: [] };
  applyArrangement(p, { size: 5 });
  for (let i = 0; i < NAMES_5.length; i++) {
    assert.ok(p.prompt.includes(`${i + 1} — ${NAMES_5[i].toLowerCase()}`), `item ${i + 1} not numbered`);
  }
  const example = p.prompt.match(/\(e\.g\. "(\d+)"\)/);
  assert.ok(example, "no example in prompt");
  assert.notEqual(example[1], p.answer, "example leaked the answer");
});

test("applyArrangement: hints run 3 deep and the final hint states the answer", () => {
  for (let i = 0; i < 60; i++) {
    const p = { id: "p1", type: "arrangement", prompt: "x", items: NAMES_4, requires: [] };
    applyArrangement(p, { size: 4 });
    assert.equal(p.hints.length, 3);
    assert.ok(p.hints[2].includes(`"${p.answer}"`), "final hint missing answer");
    // middle hint's positional reveal must be true of the answer
    const m = p.hints[1].match(/^(.+) stands in position (\d) from the left\.$/);
    assert.ok(m, `unexpected middle hint: ${p.hints[1]}`);
    const idx = NAMES_4.findIndex((n) => n.toLowerCase() === m[1].toLowerCase());
    assert.equal(String(idx + 1), p.answer[Number(m[2]) - 1], "middle hint contradicts answer");
  }
});

test("applyArrangement: respects cfg.size when the model over-supplies items", () => {
  const p = { id: "p1", type: "arrangement", prompt: "x", items: NAMES_5, requires: [] };
  applyArrangement(p, { size: 4 });
  assert.equal(p.arrangementSize, 4);
  assert.match(p.answer, /^[1-4]{4}$/);
});

/* ---- Building blocks -------------------------------------------------------- */

test("buildCluePool: every clue is true of the secret it was built from", () => {
  for (let i = 0; i < 100; i++) {
    const { secret } = generateArrangement(NAMES_5);
    const pool = buildCluePool(secret, NAMES_5);
    assert.ok(pool.every((c) => c.test(secret)));
  }
});

test("allPermutations: correct counts and all distinct", () => {
  const perms = allPermutations(5);
  assert.equal(perms.length, 120);
  assert.equal(new Set(perms.map((p) => p.join(""))).size, 120);
});
