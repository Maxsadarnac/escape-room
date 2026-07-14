/* Offline generation fixture for MOCK_GENERATION=1: a pre-validation room in
   the exact shape the model returns (cipher puzzles carry "plaintext", no
   server encoding yet). It flows through the real pipeline — validators,
   cipher encoding, family normalization — so everything but the Anthropic
   call itself is exercised. Used for transport testing and as an offline
   demo fallback; never active unless the env var is set. */

function buildMockRoom(theme, difficulty) {
  return {
    theme,
    difficulty,
    // Left blank on purpose: normalizeVisualFamily infers a family from the
    // theme text, so mock rooms still land on a sensible visual identity.
    visualFamily: "",
    story: {
      intro:
        `The door seals behind you. This is ${theme} — or what is left of it. ` +
        "Four mechanisms stand between you and the way out, and the air " +
        "hums like something in here is still awake.",
      outro:
        "The final mechanism yields. Light floods the chamber as the way " +
        "out swings wide — you walk free, and the hum falls silent behind you.",
    },
    scene: {
      palette: ["#141827", "#3ba9e8", "#7a5cff"],
      mood: "quiet, humming anticipation",
      objects: [
        { type: "terminal", position: [2, 1, -3], puzzleId: "p1_cipher", label: "flickering terminal" },
        { type: "book", position: [-2, 1, -2], puzzleId: "p2_riddle", label: "curator's ledger" },
        { type: "panel", position: [3, 1.5, 2], puzzleId: "p3_pattern", label: "signal dial array" },
        { type: "artifact", position: [-3, 1, 3], puzzleId: "p4_logic", label: "resonance pedestal" },
      ],
    },
    puzzles: [
      {
        id: "p1_cipher",
        type: "cipher",
        prompt:
          "The terminal's screen loops one scrambled line, as if someone " +
          "encoded a warning in a hurry before the lights went out.",
        plaintext: "the vault remembers everything",
        answer: "the vault remembers everything",
        hints: [
          "Whoever wrote this was rushed — the scheme is old and simple.",
          "Each letter has slid the same distance down the alphabet.",
          "Walk every letter backward step by step until words appear.",
        ],
        requires: [],
      },
      {
        id: "p2_riddle",
        type: "riddle",
        prompt:
          "A margin note in the curator's ledger reads: \"Born in these " +
          "walls, I answer only when called, and I give back exactly what " +
          "you gave. Name me to the ledger's lock.\"",
        answer: "echo",
        hints: [
          "It lives in empty halls and only exists once you make a sound.",
          "Call out in a canyon and it calls back in your own voice.",
          "You hear it when your own words return to you.",
        ],
        requires: ["p1_cipher"],
      },
      {
        // Pattern contract: flavor-only prompt, no numbers — the server
        // generates the sequence, answer, and hints (lib/patterns.js).
        id: "p3_pattern",
        type: "pattern",
        prompt:
          "The dial array cycles through a run of readings in a strict " +
          "rhythm, then blinks where the next one should be — someone tuned " +
          "these dials to a code.",
        requires: ["p1_cipher"],
      },
      {
        id: "p4_logic",
        type: "logic",
        prompt:
          "The pedestal wants a resonance total. Its plaque lists three " +
          "chords: the first rings at 12, the second 3 lower than the " +
          "first at 9, and the third at 7. The pedestal accepts only the " +
          "sum of all three.",
        answer: "28",
        hints: [
          "Read the plaque again — every chord's value is stated or derivable.",
          "The three values are 12, 9, and 7.",
          "Twelve, nine, and seven together make 28.",
        ],
        requires: ["p2_riddle", "p3_pattern"],
      },
    ],
  };
}

module.exports = { buildMockRoom };
