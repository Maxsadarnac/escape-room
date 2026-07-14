/* =========================================================================
   Cipher mechanics — the server-authored half of every cipher puzzle.

   The model contributes only creative material (a 3-5 word in-world
   plaintext + a flavor prompt); everything mechanical comes from here:
   the encoding, the answer, and the hints. That construction is what
   guarantees a cipher puzzle is always solvable with a single valid
   answer — nothing needs post-hoc verification.

   Each mechanic in MECHANICS provides:
     pickParams(cfg)          -> params object (e.g. a random Caesar shift)
     encode(plaintext, params)-> ciphertext string
     hints(plaintext, params) -> [subtle, method, explicit-reveal]

   Adding a mechanic = adding one entry here and listing its id in a
   difficulty's cipher.mechanics array in server.js.
   ========================================================================= */

/** Caesar shift, A-Z only; other characters pass through unchanged. */
function caesarEncode(plaintext, shift) {
  return plaintext
    .toUpperCase()
    .split("")
    .map((ch) => {
      if (ch >= "A" && ch <= "Z") {
        const code = ((ch.charCodeAt(0) - 65 + shift) % 26) + 65;
        return String.fromCharCode(code);
      }
      return ch;
    })
    .join("");
}

/** Atbash mirror: A<->Z, B<->Y, ... Self-inverse. */
function atbashEncode(plaintext) {
  return plaintext
    .toUpperCase()
    .split("")
    .map((ch) => (ch >= "A" && ch <= "Z" ? String.fromCharCode(155 - ch.charCodeAt(0)) : ch))
    .join("");
}

/** A1Z26: letters -> alphabet positions, dashes between letters, " / "
    between words. Non-letters are dropped (the plaintext is plain words). */
function a1z26Encode(plaintext) {
  return plaintext
    .toUpperCase()
    .split(/\s+/)
    .map((word) =>
      word
        .split("")
        .filter((ch) => ch >= "A" && ch <= "Z")
        .map((ch) => ch.charCodeAt(0) - 64)
        .join("-")
    )
    .filter((w) => w.length > 0)
    .join(" / ");
}

/** Each word's letters reversed; word order kept. */
function reverseEncode(plaintext) {
  return plaintext
    .toUpperCase()
    .split(/\s+/)
    .map((word) => word.split("").reverse().join(""))
    .join(" ");
}

const MECHANICS = {
  caesar: {
    pickParams(cfg) {
      const [min, max] = cfg.caesarShiftRange;
      return { shift: min + Math.floor(Math.random() * (max - min + 1)) };
    },
    encode: (plaintext, { shift }) => caesarEncode(plaintext, shift),
    hints: (plaintext, { shift }) => [
      "The message uses a simple letter-shift cipher — every letter has moved the same number of steps in the alphabet.",
      `Try shifting each letter backward by ${shift} positions.`,
      `Shifting each letter back by ${shift} reveals: "${plaintext.toUpperCase()}".`,
    ],
  },
  atbash: {
    pickParams: () => ({}),
    encode: (plaintext) => atbashEncode(plaintext),
    hints: (plaintext) => [
      "The alphabet has been folded in half — the first letter trades places with the last.",
      "Swap each letter for its mirror: A becomes Z, B becomes Y, and so on through the whole alphabet.",
      `Mirroring every letter reveals: "${plaintext.toUpperCase()}".`,
    ],
  },
  a1z26: {
    pickParams: () => ({}),
    encode: (plaintext) => a1z26Encode(plaintext),
    hints: (plaintext) => [
      "Every number is a letter in disguise — count your way through the alphabet.",
      "1 is A, 2 is B, on to 26 for Z. Dashes separate letters; slashes separate words.",
      `Converting each number to its letter reveals: "${plaintext.toUpperCase()}".`,
    ],
  },
  reverse: {
    pickParams: () => ({}),
    encode: (plaintext) => reverseEncode(plaintext),
    hints: (plaintext) => [
      "Every word is all there — each has just been turned around.",
      "Read each word from its last letter back to its first.",
      `Reading every word backward reveals: "${plaintext.toUpperCase()}".`,
    ],
  },
};

/**
 * Replaces a cipher puzzle's answer, prompt tail, and hints with
 * server-generated content from a randomly chosen allowed mechanic.
 * The puzzle is solvable by construction: answer === plaintext and the
 * ciphertext is a deterministic encoding of it.
 *
 * @param cfg { mechanics: string[], caesarShiftRange: [number, number] }
 */
function applyCipher(puzzle, cfg) {
  const mechanicId = cfg.mechanics[Math.floor(Math.random() * cfg.mechanics.length)];
  const mechanic = MECHANICS[mechanicId];
  const plaintext = puzzle.plaintext.trim();
  const params = mechanic.pickParams(cfg);
  const ciphertext = mechanic.encode(plaintext, params);

  puzzle.answer = plaintext;
  puzzle.cipherMechanic = mechanicId;
  if (params.shift !== undefined) puzzle.shift = params.shift;
  puzzle.prompt = `${puzzle.prompt.trim()} The coded text reads: "${ciphertext}"`;
  puzzle.hints = mechanic.hints(plaintext, params);
}

module.exports = {
  MECHANICS,
  applyCipher,
  caesarEncode,
  atbashEncode,
  a1z26Encode,
  reverseEncode,
};
