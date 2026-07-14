/* =========================================================================
   Meta final lock — the multi-step finale for hard rooms.

   Runs AFTER every other puzzle is built. The server picks up to three of
   the room's puzzles, stamps each with a revealed digit (surfaced to the
   player the moment that puzzle is solved), and appends one final puzzle
   whose answer is those digits concatenated in a stated order. Correct by
   construction: the server invented the digits, wrote them into the
   reveals, and assembled the code itself — there is exactly one valid
   answer and the room's own progression teaches it.

   The finale requires every other puzzle, so it is always the last thing
   standing between the player and the exit — and it binds to the exit door
   itself when the scene has an unclaimed one.
   ========================================================================= */

const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

const META_ID = "final_lock";
const DOOR_KEYWORDS = ["door", "gate", "hatch", "airlock", "portal", "exit"];

function looksLikeDoor(obj) {
  const text = `${obj?.type || ""} ${obj?.label || ""}`.toLowerCase();
  return DOOR_KEYWORDS.some((kw) => text.includes(kw));
}

/**
 * Appends the meta finale to a fully built room. No-op unless cfg.metaLock
 * is set and the room has at least two puzzles to draw digits from.
 */
function applyMetaLock(room, cfg) {
  if (!cfg.metaLock) return null;
  const puzzles = Array.isArray(room.puzzles) ? room.puzzles : [];
  if (puzzles.length < 2) return null;

  const objects = Array.isArray(room?.scene?.objects) ? room.scene.objects : [];
  const labelFor = (puzzleId) => {
    const obj = objects.find((o) => o && o.puzzleId === puzzleId);
    return obj && typeof obj.label === "string" && obj.label ? obj.label : puzzleId.replace(/[_-]+/g, " ");
  };

  // Contributors: first, middle, last in the model's dependency order —
  // the code spans the whole room instead of clustering at the start.
  const count = Math.min(3, puzzles.length);
  const indices =
    count === 3
      ? [0, Math.floor((puzzles.length - 1) / 2), puzzles.length - 1]
      : [0, puzzles.length - 1];
  const contributors = [...new Set(indices)].map((i) => puzzles[i]);

  const digits = contributors.map(() => randInt(1, 9));
  contributors.forEach((puzzle, i) => {
    puzzle.reveal = `A hidden face slides open on ${labelFor(puzzle.id)}, exposing a single engraved digit: ${digits[i]}.`;
  });

  const orderedLabels = contributors.map((p) => labelFor(p.id));
  const code = digits.join("");
  const finale = {
    id: META_ID,
    type: "meta",
    prompt:
      `The way out holds one last seal: a ${digits.length}-digit code. ` +
      `Each solved mechanism in this room surrendered a digit — read them in this order: ` +
      `${orderedLabels.join(", then ")}. Enter the full code.`,
    answer: code,
    hints: [
      "Every digit is already in the room — go back to what the solved mechanisms revealed when they opened.",
      `Order matters: the digit from ${orderedLabels[0]} comes first${
        orderedLabels.length > 2 ? `, then ${orderedLabels[1]}'s, then ${orderedLabels[2]}'s` : `, then ${orderedLabels[1]}'s`
      }.`,
      `The digits in order are ${digits.join(", ")} — the code is ${code}.`,
    ],
    requires: puzzles.map((p) => p.id),
    meta: true,
  };
  room.puzzles.push(finale);

  // Bind the finale to the exit: an unclaimed door object if the scene has
  // one, otherwise a new set-piece object (the layout engine will classify
  // and place it).
  const puzzleIds = new Set(puzzles.map((p) => p.id));
  const freeDoor = objects.find((o) => looksLikeDoor(o) && !puzzleIds.has(o?.puzzleId));
  if (freeDoor) {
    freeDoor.puzzleId = META_ID;
    if (!freeDoor.label) freeDoor.label = "the sealed exit";
  } else if (room.scene) {
    room.scene.objects = objects;
    objects.push({
      type: "sealed exit door",
      position: [0, 0, -6],
      puzzleId: META_ID,
      label: "the sealed exit",
    });
  }
  return finale;
}

module.exports = { applyMetaLock, META_ID };
