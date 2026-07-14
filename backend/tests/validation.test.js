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
