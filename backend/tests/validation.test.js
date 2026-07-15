const { test } = require("node:test");
const assert = require("node:assert/strict");
const { getValidationFailureReason } = require("../lib/validation");
const { buildMockRoom } = require("../mockRoom");

/* The mock fixture is the canonical "good draft" — it must always pass. */
test("mock room draft passes validation", () => {
  assert.equal(getValidationFailureReason(buildMockRoom("test lab", "medium")), null);
});

function goodRoom() {
  return buildMockRoom("test lab", "medium");
}

test("pattern puzzles may omit answer and hints (server-authored)", () => {
  const room = goodRoom();
  const pattern = room.puzzles.find((p) => p.type === "pattern");
  assert.equal(pattern.answer, undefined);
  assert.equal(pattern.hints, undefined);
  assert.equal(getValidationFailureReason(room), null);
});

test("non-pattern puzzles still require answer and 3 hints", () => {
  const room = goodRoom();
  const riddle = room.puzzles.find((p) => p.type === "riddle");
  delete riddle.answer;
  assert.match(getValidationFailureReason(room), /^SCHEMA: missing required field: answer/);

  const room2 = goodRoom();
  const riddle2 = room2.puzzles.find((p) => p.type === "riddle");
  riddle2.hints = ["only one"];
  assert.match(getValidationFailureReason(room2), /^SCHEMA: missing required field: hints/);
});

test("pattern prompt embedding its own number run is rejected", () => {
  const room = goodRoom();
  const pattern = room.puzzles.find((p) => p.type === "pattern");
  pattern.prompt = "The dials read 3, 6, 12, 24 and then blink.";
  assert.match(getValidationFailureReason(room), /pattern puzzle embedded its own number sequence/);
});

test("cipher plaintext outside 3-5 words is rejected", () => {
  const room = goodRoom();
  const cipher = room.puzzles.find((p) => p.type === "cipher");
  cipher.plaintext = "two words";
  assert.match(getValidationFailureReason(room), /plaintext isn't a 3-5 word phrase/);
});

test("missing cipher plaintext is a schema failure", () => {
  const room = goodRoom();
  const cipher = room.puzzles.find((p) => p.type === "cipher");
  delete cipher.plaintext;
  assert.match(getValidationFailureReason(room), /^SCHEMA: missing required field: plaintext/);
});

test("logic hint contradicting the answer is rejected", () => {
  const room = goodRoom();
  const logic = room.puzzles.find((p) => p.type === "logic");
  logic.hints[2] = "Twelve, nine, and seven together make 29.";
  assert.match(getValidationFailureReason(room), /logic puzzle hint contradicts/);
});

test("reused public riddle is rejected", () => {
  const room = goodRoom();
  const riddle = room.puzzles.find((p) => p.type === "riddle");
  riddle.prompt = "I speak without a mouth and hear without ears. What am I?";
  assert.match(getValidationFailureReason(room), /reused a well-known public riddle/);
});

test("leaked reasoning in hints is rejected", () => {
  const room = goodRoom();
  const logic = room.puzzles.find((p) => p.type === "logic");
  logic.hints[1] = "Wait, let me recalculate that value.";
  assert.match(getValidationFailureReason(room), /leaked reasoning/);
});

test("constraint-satisfaction grid logic is rejected", () => {
  const room = goodRoom();
  const logic = room.puzzles.find((p) => p.type === "logic");
  logic.prompt =
    "Vex, Mira, and Kor are each assigned to one station. Vex avoids the reactor, " +
    "Mira matches the console, and Kor corresponds to whichever remains.";
  assert.match(getValidationFailureReason(room), /constraint-satisfaction/);
});

test("declared answer in a riddle prompt is rejected", () => {
  const room = goodRoom();
  const riddle = room.puzzles.find((p) => p.type === "riddle");
  riddle.prompt = `A note says: the answer is ${riddle.answer}. Enter it.`;
  assert.match(getValidationFailureReason(room), /answer leaked/);
});

/* ---- Observation drafts ----------------------------------------------------- */

test("observation puzzles may omit answer and hints (server-authored)", () => {
  const room = goodRoom();
  const observation = room.puzzles.find((p) => p.type === "observation");
  assert.equal(observation.answer, undefined);
  assert.equal(observation.hints, undefined);
  assert.equal(getValidationFailureReason(room), null);
});

test("observation prompt containing any digit is rejected", () => {
  const room = goodRoom();
  const observation = room.puzzles.find((p) => p.type === "observation");
  observation.prompt = "The counter wheel shows 3 notches already turned.";
  assert.match(getValidationFailureReason(room), /observation puzzle prompt contains numbers/);
});

/* ---- Arrangement drafts ------------------------------------------------------ */

test("arrangement puzzles may omit answer and hints but need 4-5 items", () => {
  const room = goodRoom();
  const arrangement = room.puzzles.find((p) => p.type === "arrangement");
  assert.equal(arrangement.answer, undefined);
  assert.equal(getValidationFailureReason(room), null);

  arrangement.items = arrangement.items.slice(0, 3);
  assert.match(getValidationFailureReason(room), /^SCHEMA: .*items.*4-5/);
});

test("arrangement with missing items array is a schema failure", () => {
  const room = goodRoom();
  const arrangement = room.puzzles.find((p) => p.type === "arrangement");
  delete arrangement.items;
  assert.match(getValidationFailureReason(room), /^SCHEMA: missing or invalid required field: items/);
});

test("arrangement with duplicate item names is rejected", () => {
  const room = goodRoom();
  const arrangement = room.puzzles.find((p) => p.type === "arrangement");
  arrangement.items = ["brass key", "iron key", "Brass Key", "bone key"];
  assert.match(getValidationFailureReason(room), /^SCHEMA: .*duplicate names/);
});

test("arrangement item names longer than 4 words are rejected", () => {
  const room = goodRoom();
  const arrangement = room.puzzles.find((p) => p.type === "arrangement");
  arrangement.items = ["brass key", "iron key", "silver key", "the very long ornate ceremonial key"];
  assert.match(getValidationFailureReason(room), /^SCHEMA: .*at most 4 words/);
});
