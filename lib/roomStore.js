/* =========================================================================
   Room store — persistence behind shareable room codes.

   Every successfully generated room is saved as one JSON file under
   data/rooms/<CODE>.json and the code travels back to the client in the
   room payload (room.shareCode). GET /rooms/:code serves the exact stored
   room to anyone, on any device — that is what makes a code shareable.

   Design choices:
   - Flat files, no database: rooms are small (<10 KB), immutable once
     written, and looked up only by exact code. A directory of JSON files
     is transparent, dependency-free, and trivially backed up.
   - Codes: 6 chars from an alphabet with no 0/O/1/I/L ambiguity, ~700M
     combinations — collision-checked on write anyway.
   - Atomic writes (tmp file + rename) so a crash can never leave a
     half-written room behind a live code.
   - Codes are validated against a strict pattern before ever touching the
     filesystem, so a request for "../../etc" is rejected as malformed
     rather than resolved as a path.
   ========================================================================= */

const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

const DATA_DIR = process.env.ROOM_STORE_DIR || path.join(__dirname, "..", "data", "rooms");

function generateCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Uppercases, strips an optional legacy "RC-" prefix, and validates.
 * Returns the canonical code, or null if the input can't be a room code.
 */
function normalizeCode(input) {
  if (typeof input !== "string") return null;
  const code = input.trim().toUpperCase().replace(/^RC-/, "");
  return CODE_PATTERN.test(code) ? code : null;
}

function fileFor(code) {
  return path.join(DATA_DIR, `${code}.json`);
}

/**
 * Persists a room and returns its fresh share code. Retries on the
 * (astronomically unlikely) code collision; atomic tmp+rename write.
 */
async function saveRoom(room, meta = {}) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const file = fileFor(code);
    try {
      await fs.access(file);
      continue; // exists — roll a new code
    } catch {
      /* free — claim it */
    }
    const record = {
      code,
      createdAt: new Date().toISOString(),
      theme: typeof meta.theme === "string" ? meta.theme : room?.theme || "",
      difficulty: typeof meta.difficulty === "string" ? meta.difficulty : room?.difficulty || "",
      // The stored room carries its own code, so a retrieved room can be
      // re-shared verbatim.
      room: { ...room, shareCode: code },
    };
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(record, null, 2), "utf8");
    await fs.rename(tmp, file);
    return code;
  }
  throw new Error("could not allocate a unique room code");
}

/**
 * Loads a stored room record by code. Returns { code, createdAt, theme,
 * difficulty, room } or null (unknown or malformed code).
 */
async function loadRoom(input) {
  const code = normalizeCode(input);
  if (!code) return null;
  try {
    const raw = await fs.readFile(fileFor(code), "utf8");
    const record = JSON.parse(raw);
    return record && typeof record === "object" && record.room ? record : null;
  } catch {
    return null;
  }
}

module.exports = { saveRoom, loadRoom, normalizeCode, generateCode, CODE_PATTERN, DATA_DIR };
