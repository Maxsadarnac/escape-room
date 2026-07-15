const { test } = require("node:test");
const assert = require("node:assert/strict");
const { applyObservation } = require("../lib/observation");
const { buildDecor, FAMILY_CATALOG, MIN_COUNT, MAX_COUNT, TOTAL_CAP } = require("../lib/decor");

const FAMILIES = Object.keys(FAMILY_CATALOG);
const ITERATIONS = 200;

function freshRoom(family = "sci-fi") {
  const room = { visualFamily: family, scene: {} };
  buildDecor(room);
  return room;
}

function freshPuzzle() {
  return { id: "p1", type: "observation", prompt: "The lock keeps count.", requires: [] };
}

/* ---- Decor manifest: the ground truth observation answers rest on --------- */

test("buildDecor: every catalog kind appears with a bounded count", () => {
  for (const family of FAMILIES) {
    for (let i = 0; i < 40; i++) {
      const room = { visualFamily: family, scene: {} };
      const decor = buildDecor(room);
      assert.equal(decor.items.length, FAMILY_CATALOG[family].length);
      assert.ok(Number.isInteger(decor.seed) && decor.seed > 0);
      const total = decor.items.reduce((s, item) => s + item.count, 0);
      assert.ok(total <= TOTAL_CAP, `total ${total} over cap`);
      for (const item of decor.items) {
        assert.ok(item.count >= 1 && item.count <= MAX_COUNT, `count ${item.count}`);
        assert.ok(FAMILY_CATALOG[family].some((c) => c.kind === item.kind));
        assert.equal(typeof item.label, "string");
      }
    }
  }
});

test("buildDecor: counts are pairwise distinct (no ambiguous piles)", () => {
  for (const family of FAMILIES) {
    for (let i = 0; i < 40; i++) {
      const { items } = buildDecor({ visualFamily: family, scene: {} });
      // The over-cap trim can only merge counts downward from the max side;
      // verify distinctness holds after trimming too.
      const counts = items.map((it) => it.count);
      assert.equal(new Set(counts).size, counts.length, `duplicate counts: ${counts}`);
    }
  }
});

/* ---- The core property: the stored answer is recomputable from the room ---- */

function recompute(puzzle, room) {
  const byKind = new Map(room.scene.decor.items.map((it) => [it.kind, it.count]));
  const counts = puzzle.observationKinds.map((k) => byKind.get(k));
  if (counts.length === 1) return counts[0];
  if (counts.length === 2) {
    switch (puzzle.observationOp) {
      case "sum": return counts[0] + counts[1];
      case "product": return counts[0] * counts[1];
      case "difference": return Math.abs(counts[0] - counts[1]);
    }
  }
  switch (puzzle.observationOp) {
    case "product-plus": return counts[0] * counts[1] + counts[2];
    case "sum-times": return (counts[0] + counts[1]) * counts[2];
  }
  throw new Error(`unknown op ${puzzle.observationOp}`);
}

test("applyObservation: answer always matches the decor manifest arithmetic", () => {
  for (const terms of [1, 2, 3]) {
    for (let i = 0; i < ITERATIONS; i++) {
      const room = freshRoom(FAMILIES[i % FAMILIES.length]);
      const puzzle = freshPuzzle();
      applyObservation(puzzle, { terms }, room);
      assert.equal(puzzle.answer, String(recompute(puzzle, room)), `terms=${terms}`);
      assert.ok(Number(puzzle.answer) >= 0);
    }
  }
});

test("applyObservation: question names every chosen kind's label in the prompt", () => {
  for (const terms of [1, 2, 3]) {
    const room = freshRoom();
    const puzzle = freshPuzzle();
    applyObservation(puzzle, { terms }, room);
    const byKind = new Map(room.scene.decor.items.map((it) => [it.kind, it.label]));
    for (const kind of puzzle.observationKinds) {
      assert.ok(puzzle.prompt.includes(byKind.get(kind)), `label for ${kind} missing from prompt`);
    }
    assert.equal(puzzle.observationKinds.length, terms);
  }
});

test("applyObservation: hints run 3 deep, reveal counts mid, answer last", () => {
  for (let i = 0; i < 60; i++) {
    const room = freshRoom();
    const puzzle = freshPuzzle();
    applyObservation(puzzle, { terms: 2 }, room);
    assert.equal(puzzle.hints.length, 3);
    const byKind = new Map(room.scene.decor.items.map((it) => [it.kind, it]));
    for (const kind of puzzle.observationKinds) {
      const item = byKind.get(kind);
      assert.ok(
        puzzle.hints[1].includes(`${item.count} ${item.label}`),
        `middle hint missing "${item.count} ${item.label}"`
      );
    }
    assert.ok(puzzle.hints[2].includes(puzzle.answer), "final hint missing answer");
  }
});

test("applyObservation: clamps terms to what the manifest can support", () => {
  const room = { visualFamily: "sci-fi", scene: { decor: { seed: 1, items: [
    { kind: "crate", label: "supply crates", count: 3 },
    { kind: "beacon", label: "warning beacons", count: 2 },
  ] } } };
  const puzzle = freshPuzzle();
  applyObservation(puzzle, { terms: 3 }, room);
  assert.equal(puzzle.observationKinds.length, 2);
  assert.equal(puzzle.answer, String(recompute(puzzle, room)));
});
