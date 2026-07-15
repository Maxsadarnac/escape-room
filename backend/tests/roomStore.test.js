const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

// Isolate the store under a temp dir BEFORE the module reads its env.
const TMP_DIR = path.join(os.tmpdir(), `roomstore-test-${process.pid}-${Date.now()}`);
process.env.ROOM_STORE_DIR = TMP_DIR;

const { saveRoom, loadRoom, normalizeCode, generateCode, CODE_PATTERN } = require("../lib/roomStore");

after(async () => {
  await fs.rm(TMP_DIR, { recursive: true, force: true });
});

const sampleRoom = () => ({
  theme: "sunken archive",
  difficulty: "hard",
  puzzles: [{ id: "p1", type: "riddle", prompt: "x", answer: "echo", hints: ["a", "b", "c"], requires: [] }],
  scene: { palette: ["#111111", "#222222", "#333333"], objects: [] },
});

test("save -> load roundtrip returns the exact room plus its code", async () => {
  const room = sampleRoom();
  const code = await saveRoom(room, { theme: room.theme, difficulty: room.difficulty });
  assert.match(code, CODE_PATTERN);

  const record = await loadRoom(code);
  assert.ok(record);
  assert.equal(record.code, code);
  assert.equal(record.theme, "sunken archive");
  assert.equal(record.difficulty, "hard");
  assert.equal(record.room.shareCode, code, "stored room must carry its own code");
  const { shareCode: _ignored, ...storedRoom } = record.room;
  assert.deepEqual(storedRoom, room);
  assert.ok(!Number.isNaN(Date.parse(record.createdAt)));
});

test("codes avoid ambiguous characters and are 6 long", () => {
  for (let i = 0; i < 500; i++) {
    const code = generateCode();
    assert.match(code, CODE_PATTERN);
    assert.ok(![..."0O1IL"].some((ch) => code.includes(ch)), `ambiguous char in ${code}`);
  }
});

test("many saves allocate unique codes", async () => {
  const codes = await Promise.all(
    Array.from({ length: 40 }, () => saveRoom(sampleRoom(), {}))
  );
  assert.equal(new Set(codes).size, codes.length);
});

test("normalizeCode: case-insensitive, trims pasted whitespace, tolerates the legacy RC- prefix", () => {
  assert.equal(normalizeCode("ab2cd3"), "AB2CD3");
  assert.equal(normalizeCode(" rc-AB2CD3 "), "AB2CD3");
  assert.equal(normalizeCode("AB2CD3"), "AB2CD3");
  assert.equal(normalizeCode("AB2CD3\n"), "AB2CD3"); // clipboard paste with newline
});

test("normalizeCode: rejects malformed and hostile input", () => {
  for (const bad of ["", "SHORT", "TOOLONG7", "AB2CD0", "AB2CDO", "../etc", "AB/CD3", null, 42, "AB2\nD3"]) {
    assert.equal(normalizeCode(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});

test("loadRoom: unknown and malformed codes return null (never throw)", async () => {
  assert.equal(await loadRoom("ZZZZZZ"), null);
  assert.equal(await loadRoom("../../../etc/passwd"), null);
  assert.equal(await loadRoom(undefined), null);
});
