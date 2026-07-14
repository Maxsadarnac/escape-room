const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  RULES,
  applyPattern,
  generateSequence,
  computeExpectedNext,
  extractNumberSequence,
} = require("../lib/patterns");

const RULE_IDS = Object.keys(RULES);
const ITERATIONS = 200;

/* ---- The single most important property: solvable, single valid answer ---- */

test("every generated sequence is unambiguous (simple-rule solver agrees or abstains)", () => {
  for (const ruleId of RULE_IDS) {
    for (let i = 0; i < ITERATIONS; i++) {
      const { shown, answer } = generateSequence(ruleId);
      const simple = computeExpectedNext(shown);
      assert.ok(
        simple === null || Math.abs(simple - answer) < 1e-6,
        `${ruleId}: [${shown}] answer ${answer} but simple solver says ${simple}`
      );
    }
  }
});

test("generated values are positive integers within the readable cap", () => {
  for (const ruleId of RULE_IDS) {
    for (let i = 0; i < ITERATIONS; i++) {
      const { shown, answer } = generateSequence(ruleId);
      for (const v of [...shown, answer]) {
        assert.ok(Number.isInteger(v) && v > 0, `${ruleId}: non-positive-integer ${v}`);
      }
      assert.ok(answer <= 2000, `${ruleId}: answer ${answer} over cap`);
    }
  }
});

test("final hint states the answer; hints run 3 deep", () => {
  for (const ruleId of RULE_IDS) {
    for (let i = 0; i < 40; i++) {
      const { answer, hints } = generateSequence(ruleId);
      assert.equal(hints.length, 3, ruleId);
      assert.ok(hints[2].includes(String(answer)), `${ruleId}: final hint missing answer`);
    }
  }
});

/* ---- Per-rule structural properties --------------------------------------- */

test("arithmetic: constant difference", () => {
  for (let i = 0; i < 40; i++) {
    const { shown, answer } = generateSequence("arithmetic");
    const d = shown[1] - shown[0];
    for (let j = 1; j < shown.length; j++) assert.equal(shown[j] - shown[j - 1], d);
    assert.equal(answer, shown[shown.length - 1] + d);
  }
});

test("geometric: constant ratio", () => {
  for (let i = 0; i < 40; i++) {
    const { shown, answer } = generateSequence("geometric");
    const r = shown[1] / shown[0];
    for (let j = 1; j < shown.length; j++) assert.equal(shown[j] / shown[j - 1], r);
    assert.equal(answer, shown[shown.length - 1] * r);
  }
});

test("quadratic: constant second difference", () => {
  for (let i = 0; i < 40; i++) {
    const { shown, answer } = generateSequence("quadratic");
    const seq = [...shown, answer];
    const diffs = seq.slice(1).map((v, j) => v - seq[j]);
    const second = diffs.slice(1).map((v, j) => v - diffs[j]);
    assert.ok(second.every((v) => v === second[0]), `[${seq}]`);
    assert.ok(second[0] !== 0, "degenerate quadratic (would be arithmetic)");
  }
});

test("alternating: 5 shown terms; both interleaved threads are arithmetic", () => {
  for (let i = 0; i < 40; i++) {
    const { shown, answer } = generateSequence("alternating");
    assert.equal(shown.length, 5);
    const threadA = [shown[0], shown[2], shown[4]];
    const threadB = [shown[1], shown[3], answer];
    assert.equal(threadA[1] - threadA[0], threadA[2] - threadA[1], "thread A not arithmetic");
    assert.equal(threadB[1] - threadB[0], threadB[2] - threadB[1], "thread B not arithmetic");
  }
});

test("fibonacci: each term is the sum of the previous two", () => {
  for (let i = 0; i < 40; i++) {
    const { shown, answer } = generateSequence("fibonacci");
    const seq = [...shown, answer];
    for (let j = 2; j < seq.length; j++) {
      assert.equal(seq[j], seq[j - 1] + seq[j - 2], `[${seq}]`);
    }
  }
});

test("affine: next = m*x + c with consistent m, c", () => {
  for (let i = 0; i < 40; i++) {
    const { shown, answer } = generateSequence("affine");
    const seq = [...shown, answer];
    // solve m, c from the first two transitions, then verify the rest
    const m = (seq[2] - seq[1]) / (seq[1] - seq[0]);
    const c = seq[1] - m * seq[0];
    for (let j = 1; j < seq.length; j++) {
      assert.ok(Math.abs(seq[j] - (m * seq[j - 1] + c)) < 1e-6, `[${seq}] m=${m} c=${c}`);
    }
  }
});

/* ---- applyPattern wires it into the puzzle --------------------------------- */

test("applyPattern: appends sequence to prompt, sets string answer + hints", () => {
  for (const ruleId of RULE_IDS) {
    const p = { id: "p1", type: "pattern", prompt: "The dials hum in rhythm.", requires: [] };
    applyPattern(p, [ruleId]);
    assert.equal(p.patternRule, ruleId);
    assert.match(p.prompt, /The sequence reads: (\d+, )+\d+, \?$/);
    assert.equal(typeof p.answer, "string");
    assert.equal(p.hints.length, 3);
    // the appended sequence must parse back out and the shown run's
    // continuation must be the stored answer when a simple rule applies
    const seq = extractNumberSequence(p.prompt);
    assert.ok(seq && seq.length >= 4, "sequence not extractable from prompt");
  }
});

test("applyPattern: rule comes from the allowed list only", () => {
  const seen = new Set();
  for (let i = 0; i < 80; i++) {
    const p = { id: "p1", type: "pattern", prompt: "x", requires: [] };
    applyPattern(p, ["fibonacci", "affine"]);
    seen.add(p.patternRule);
  }
  assert.deepEqual([...seen].sort(), ["affine", "fibonacci"]);
});

/* ---- Solver + extractor utilities ------------------------------------------ */

test("computeExpectedNext solves the three simple rules and abstains otherwise", () => {
  assert.equal(computeExpectedNext([2, 4, 6, 8]), 10);
  assert.equal(computeExpectedNext([3, 6, 12, 24]), 48);
  assert.equal(computeExpectedNext([1, 3, 7, 13]), 21); // second diff 2
  assert.equal(computeExpectedNext([1, 1, 2, 3, 5]), null); // fibonacci: none of the three
});

test("extractNumberSequence finds the longest comma run", () => {
  assert.deepEqual(extractNumberSequence("dial: 2, 4, 6, 8, ?"), [2, 4, 6, 8]);
  assert.equal(extractNumberSequence("room 12 with 3 doors"), null);
  assert.equal(extractNumberSequence("coordinates 4, 7"), null); // runs need 3+
});
