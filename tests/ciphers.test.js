const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  MECHANICS,
  applyCipher,
  caesarEncode,
  atbashEncode,
  a1z26Encode,
  reverseEncode,
} = require("../lib/ciphers");

/* ---- Encoders are correct and decodable ---------------------------------- */

test("caesar encodes and round-trips", () => {
  assert.equal(caesarEncode("abc", 1), "BCD");
  assert.equal(caesarEncode("xyz", 3), "ABC");
  // decode = shift back 26 - n
  const ct = caesarEncode("the vault remembers", 7);
  assert.equal(caesarEncode(ct.toLowerCase(), 26 - 7), "THE VAULT REMEMBERS");
});

test("atbash is its own inverse", () => {
  assert.equal(atbashEncode("abz"), "ZYA");
  const ct = atbashEncode("mirror of the deep");
  assert.equal(atbashEncode(ct.toLowerCase()), "MIRROR OF THE DEEP");
});

test("a1z26 maps letters to alphabet positions", () => {
  assert.equal(a1z26Encode("abc"), "1-2-3");
  assert.equal(a1z26Encode("az za"), "1-26 / 26-1");
  // decodable: every dash-number maps back
  const decoded = a1z26Encode("dark star")
    .split(" / ")
    .map((w) => w.split("-").map((n) => String.fromCharCode(64 + Number(n))).join(""))
    .join(" ");
  assert.equal(decoded, "DARK STAR");
});

test("reverse flips each word, keeps order", () => {
  assert.equal(reverseEncode("core shield"), "EROC DLEIHS");
});

/* ---- applyCipher builds a solvable puzzle --------------------------------- */

function draftCipher() {
  return {
    id: "c1",
    type: "cipher",
    prompt: "A scrambled warning loops on the screen.",
    plaintext: "the reactor never sleeps",
    answer: "the reactor never sleeps",
    hints: ["a", "b", "c"],
    requires: [],
  };
}

test("applyCipher: answer equals plaintext, prompt gains ciphertext, final hint reveals", () => {
  for (const mechanics of [["caesar"], ["atbash"], ["a1z26"], ["reverse"]]) {
    const p = draftCipher();
    applyCipher(p, { mechanics, caesarShiftRange: [2, 8] });
    assert.equal(p.answer, "the reactor never sleeps");
    assert.equal(p.cipherMechanic, mechanics[0]);
    assert.match(p.prompt, /The coded text reads: ".+"/);
    assert.equal(p.hints.length, 3);
    assert.ok(p.hints[2].includes("THE REACTOR NEVER SLEEPS"));
    // the ciphertext must differ from the plaintext (it's actually encoded)
    const ct = p.prompt.match(/The coded text reads: "(.+)"/)[1];
    assert.notEqual(ct, "THE REACTOR NEVER SLEEPS");
  }
});

test("applyCipher: caesar shift stays within the difficulty range", () => {
  for (let i = 0; i < 60; i++) {
    const p = draftCipher();
    applyCipher(p, { mechanics: ["caesar"], caesarShiftRange: [5, 15] });
    assert.ok(p.shift >= 5 && p.shift <= 15, `shift ${p.shift} out of range`);
  }
});

test("applyCipher: mechanic is picked from the allowed list only", () => {
  const seen = new Set();
  for (let i = 0; i < 80; i++) {
    const p = draftCipher();
    applyCipher(p, { mechanics: ["atbash", "reverse"], caesarShiftRange: [1, 3] });
    seen.add(p.cipherMechanic);
  }
  assert.deepEqual([...seen].sort(), ["atbash", "reverse"]);
});

test("every registered mechanic has the full interface", () => {
  for (const [id, mech] of Object.entries(MECHANICS)) {
    assert.equal(typeof mech.pickParams, "function", id);
    assert.equal(typeof mech.encode, "function", id);
    assert.equal(typeof mech.hints, "function", id);
    const params = mech.pickParams({ caesarShiftRange: [1, 3] });
    const ct = mech.encode("three word phrase", params);
    assert.ok(typeof ct === "string" && ct.length > 0, id);
    const hints = mech.hints("three word phrase", params);
    assert.equal(hints.length, 3, id);
  }
});
