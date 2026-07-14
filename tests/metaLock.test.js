const { test } = require("node:test");
const assert = require("node:assert/strict");
const { applyMetaLock, META_ID } = require("../lib/metaLock");

function hardRoom() {
  return {
    theme: "test vault",
    scene: {
      objects: [
        { type: "terminal", puzzleId: "p1", label: "humming terminal", position: [1, 1, 1] },
        { type: "ledger", puzzleId: "p2", label: "dusty ledger", position: [2, 1, 1] },
        { type: "dial", puzzleId: "p3", label: "brass dial", position: [3, 1, 1] },
        { type: "orb", puzzleId: "p4", label: "cracked orb", position: [4, 1, 1] },
        { type: "door", puzzleId: null, label: "vault door", position: [0, 0, -6] },
      ],
    },
    puzzles: [
      { id: "p1", type: "cipher", prompt: "x", answer: "a", hints: ["1", "2", "3"], requires: [] },
      { id: "p2", type: "riddle", prompt: "x", answer: "b", hints: ["1", "2", "3"], requires: ["p1"] },
      { id: "p3", type: "pattern", prompt: "x", answer: "9", hints: ["1", "2", "3"], requires: ["p1"] },
      { id: "p4", type: "logic", prompt: "x", answer: "7", hints: ["1", "2", "3"], requires: ["p2", "p3"] },
    ],
  };
}

test("no-op unless cfg.metaLock is set", () => {
  const room = hardRoom();
  assert.equal(applyMetaLock(room, { metaLock: false }), null);
  assert.equal(room.puzzles.length, 4);
  assert.ok(room.puzzles.every((p) => !p.reveal));
});

test("appends a finale whose answer is the revealed digits in prompt order", () => {
  for (let i = 0; i < 100; i++) {
    const room = hardRoom();
    const finale = applyMetaLock(room, { metaLock: true });
    assert.ok(finale);
    assert.equal(finale.id, META_ID);
    assert.equal(finale.type, "meta");
    assert.match(finale.answer, /^[1-9]{3}$/);

    // Contributors are first / middle / last of the original four.
    const contributors = ["p1", "p2", "p4"].map((id) => room.puzzles.find((p) => p.id === id));
    const digits = contributors.map((p) => {
      const m = (p.reveal || "").match(/digit: (\d)\./);
      assert.ok(m, `no reveal on ${p.id}`);
      return m[1];
    });
    assert.equal(finale.answer, digits.join(""), "answer must be the reveals concatenated");
    // Non-contributors carry no reveal.
    assert.ok(!room.puzzles.find((p) => p.id === "p3").reveal);
    // The final hint states the code.
    assert.ok(finale.hints[2].includes(finale.answer));
  }
});

test("the finale requires every other puzzle", () => {
  const room = hardRoom();
  const finale = applyMetaLock(room, { metaLock: true });
  assert.deepEqual([...finale.requires].sort(), ["p1", "p2", "p3", "p4"]);
});

test("prompt references the contributors' scene labels in order", () => {
  const room = hardRoom();
  const finale = applyMetaLock(room, { metaLock: true });
  const labels = ["humming terminal", "dusty ledger", "cracked orb"];
  let cursor = -1;
  for (const label of labels) {
    const at = finale.prompt.indexOf(label);
    assert.ok(at > cursor, `label "${label}" missing or out of order`);
    cursor = at;
  }
});

test("binds to an unclaimed door object when the scene has one", () => {
  const room = hardRoom();
  applyMetaLock(room, { metaLock: true });
  const door = room.scene.objects.find((o) => o.type === "door");
  assert.equal(door.puzzleId, META_ID);
  // no extra object appended
  assert.equal(room.scene.objects.length, 5);
});

test("appends a set-piece object when every door is claimed", () => {
  const room = hardRoom();
  room.scene.objects.find((o) => o.type === "door").puzzleId = "p4";
  applyMetaLock(room, { metaLock: true });
  const added = room.scene.objects.find((o) => o.puzzleId === META_ID);
  assert.ok(added, "no object bound to the finale");
  assert.equal(room.scene.objects.length, 6);
});

test("two-puzzle rooms get a two-digit finale; one-puzzle rooms are left alone", () => {
  const room = hardRoom();
  room.puzzles = room.puzzles.slice(0, 2);
  const finale = applyMetaLock(room, { metaLock: true });
  assert.match(finale.answer, /^[1-9]{2}$/);

  const tiny = hardRoom();
  tiny.puzzles = tiny.puzzles.slice(0, 1);
  assert.equal(applyMetaLock(tiny, { metaLock: true }), null);
});
