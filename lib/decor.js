/* =========================================================================
   Decor manifest — server-generated set dressing.

   The server decides what non-puzzle objects inhabit the room: which kinds,
   how many of each, and a placement seed. The frontend renders *exactly*
   this manifest (same kind ids, same counts), which is what lets
   observation puzzles (lib/observation.js) treat the room's contents as
   ground truth: the answer to "count the lanterns" is correct by
   construction because the same manifest drives both the question and the
   scene.

   Kind ids are a contract with the frontend renderer
   (src/three/setDressing.jsx); labels are the player-facing plural names
   used in puzzle text and the 2D fallback inventory.
   ========================================================================= */

const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

/* Per-family catalogs. `wall: true` kinds hang on walls; the rest sit on
   the floor. Counts stay small (2-6) so observation puzzles ask for counts
   a player can actually take in. */
const FAMILY_CATALOG = {
  "sci-fi": [
    { kind: "crate", label: "supply crates" },
    { kind: "canister", label: "pressure canisters" },
    { kind: "monitor", label: "wall monitors", wall: true },
    { kind: "beacon", label: "warning beacons" },
  ],
  fantasy: [
    { kind: "barrel", label: "oak barrels" },
    { kind: "tome", label: "stacked tomes" },
    { kind: "candle", label: "burning candles" },
    { kind: "banner", label: "hanging banners", wall: true },
  ],
  "horror-gothic": [
    { kind: "candle", label: "guttering candles" },
    { kind: "skull", label: "pale skulls" },
    { kind: "crate", label: "rotting crates" },
    { kind: "lantern", label: "iron lanterns" },
  ],
  "noir-mystery": [
    { kind: "filebox", label: "case-file boxes" },
    { kind: "bottle", label: "empty bottles" },
    { kind: "newspaper", label: "newspaper bundles" },
    { kind: "lamp", label: "standing lamps" },
  ],
  nature: [
    { kind: "fern", label: "young ferns" },
    { kind: "rock", label: "mossy stones" },
    { kind: "mushroom", label: "glowing mushrooms" },
    { kind: "log", label: "fallen logs" },
  ],
  cyberpunk: [
    { kind: "crate", label: "road cases" },
    { kind: "cable", label: "cable bundles" },
    { kind: "neon", label: "neon signs", wall: true },
    { kind: "canister", label: "coolant canisters" },
  ],
};

const MIN_COUNT = 2;
const MAX_COUNT = 6;
const TOTAL_CAP = 18; // keeps the render + draw-call budget honest

/**
 * Builds scene.decor for a room whose visualFamily is already normalized:
 *   { seed, items: [{ kind, label, count, wall? }, ...] }
 * Every kind in the family catalog appears (rooms feel consistently
 * furnished), counts are randomized per room, and the total is capped.
 * Counts are pairwise-distinct so observation questions like "the lanterns
 * and the crates" never hinge on which of two identical piles you meant.
 */
function buildDecor(room) {
  const catalog = FAMILY_CATALOG[room.visualFamily] || FAMILY_CATALOG["sci-fi"];
  const usedCounts = new Set();
  const items = catalog.map((entry) => {
    let count = randInt(MIN_COUNT, MAX_COUNT);
    while (usedCounts.has(count)) count = count >= MAX_COUNT ? MIN_COUNT : count + 1;
    usedCounts.add(count);
    const item = { kind: entry.kind, label: entry.label, count };
    if (entry.wall) item.wall = true;
    return item;
  });

  // Trim the largest piles first if the room came out overfull, stepping
  // past counts already in use so distinctness survives the trim.
  let total = items.reduce((sum, item) => sum + item.count, 0);
  while (total > TOTAL_CAP) {
    const largest = items.reduce((a, b) => (b.count > a.count ? b : a));
    const inUse = new Set(items.filter((i) => i !== largest).map((i) => i.count));
    let next = largest.count - 1;
    while (inUse.has(next) && next > 1) next--;
    total -= largest.count - next;
    largest.count = next;
  }

  room.scene = room.scene || {};
  room.scene.decor = {
    seed: randInt(1, 2 ** 31 - 1),
    items,
  };
  return room.scene.decor;
}

module.exports = { FAMILY_CATALOG, buildDecor, MIN_COUNT, MAX_COUNT, TOTAL_CAP };
