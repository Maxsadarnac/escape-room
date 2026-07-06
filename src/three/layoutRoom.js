/* =========================================================================
   Scene layout engine.

   Takes room JSON (scene.objects + puzzles) and produces a guaranteed-valid
   arrangement of props inside the 3D room shell. The LLM-generated positions
   are treated as *hints* (they preserve the relative arrangement the model
   intended) but are normalized into the room's safe interior, de-overlapped,
   and wall-mounted archetypes are snapped flush to the nearest wall — raw
   LLM coordinates use no consistent scale and routinely fall outside any
   fixed room bounds.

   Pure functions, no three.js imports, so this file is trivially testable
   in node.
   ========================================================================= */

export const ROOM = {
  width: 16, // x extent
  depth: 12, // z extent
  height: 5,
  halfW: 8,
  halfD: 6,
};

// Interior band floor props may occupy (keeps clearance from walls).
const FLOOR_X = 5.6;
const FLOOR_Z = 4.2;
const MIN_SEPARATION = 2.2; // between floor prop centers
const CENTER_CLEARANCE = 1.7; // keep the orbit target area open
const WALL_SLIDE_GAP = 2.4; // between wall-mounted prop centers

/* ---- Archetype classification ----------------------------------------- */

// Checked in order; first keyword hit wins. Wall-mounted archetypes are
// snapped to the nearest wall by the layout pass.
const ARCHETYPE_RULES = [
  { archetype: "door", wall: true, keywords: ["door", "gate", "hatch", "airlock", "portal", "exit"] },
  {
    archetype: "wallPanel",
    wall: true,
    keywords: [
      "painting", "portrait", "picture", "inscription", "mural", "poster",
      "sign", "chart", "map", "wall", "display", "screen", "monitor", "mirror", "window",
    ],
  },
  {
    archetype: "shelf",
    keywords: ["shelf", "bookcase", "bookshelf", "archive", "library", "rack"],
  },
  {
    archetype: "lectern",
    keywords: [
      "book", "journal", "log", "diary", "tome", "manuscript", "letter",
      "note", "manifest", "slate", "scroll", "ledger", "record",
    ],
  },
  {
    archetype: "cabinet",
    keywords: ["cabinet", "vault", "locker", "safe", "chest", "crate", "cupboard", "wardrobe", "box"],
  },
  {
    archetype: "machine",
    keywords: [
      "reactor", "engine", "machine", "device", "generator", "chamber", "core",
      "gauge", "valve", "mechanism", "pump", "turbine", "boiler", "furnace", "relay",
    ],
  },
  {
    archetype: "console",
    keywords: ["console", "terminal", "panel", "computer", "keypad", "controls", "station", "desk"],
  },
  {
    archetype: "pedestal",
    keywords: [
      "artifact", "orb", "crystal", "relic", "statue", "idol", "skull",
      "vessel", "altar", "totem", "gem", "stone", "urn", "lantern",
    ],
  },
];

export function classifyArchetype(type, label) {
  const text = `${type || ""} ${label || ""}`.toLowerCase();
  for (const rule of ARCHETYPE_RULES) {
    if (rule.keywords.some((kw) => text.includes(kw))) {
      return { archetype: rule.archetype, wallMounted: Boolean(rule.wall) };
    }
  }
  // Unknown objects still need to read as interactive: glowing pedestal.
  return { archetype: "pedestal", wallMounted: false };
}

/* ---- Helpers ----------------------------------------------------------- */

// Deterministic string hash -> [0, 1). Used for per-prop rotation jitter so
// layouts are stable across re-renders of the same room.
export function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function sanitizePosition(pos) {
  if (Array.isArray(pos) && pos.length >= 3 && pos.every(isNum)) {
    return [pos[0], pos[1], pos[2]];
  }
  return null;
}

// Golden-angle ring for objects with no usable position hint.
function ringPosition(i) {
  const angle = i * 2.399963;
  const r = 3.1 + (i % 2) * 1.2;
  return [Math.cos(angle) * r, 1.5, Math.sin(angle) * r];
}

/* ---- Main entry -------------------------------------------------------- */

/**
 * @returns {Array<{
 *   id: string, puzzleId: string|null, label: string, type: string,
 *   archetype: string, wallMounted: boolean, interactive: boolean,
 *   position: [number, number, number], rotationY: number, seed: number,
 * }>}
 */
export function layoutScene(room) {
  const puzzles = Array.isArray(room?.puzzles) ? room.puzzles : [];
  const rawObjects = Array.isArray(room?.scene?.objects) ? room.scene.objects : [];
  const puzzleIds = new Set(puzzles.map((p) => p.id));

  // One interactive object per puzzle (first wins); extras become decor.
  const entries = [];
  const coveredPuzzles = new Set();
  rawObjects.forEach((obj, i) => {
    if (!obj || typeof obj !== "object") return;
    const puzzleId = typeof obj.puzzleId === "string" ? obj.puzzleId : null;
    const interactive = puzzleId !== null && puzzleIds.has(puzzleId) && !coveredPuzzles.has(puzzleId);
    if (interactive) coveredPuzzles.add(puzzleId);
    entries.push({
      id: `obj-${i}-${puzzleId || "decor"}`,
      puzzleId: interactive ? puzzleId : null,
      label: typeof obj.label === "string" && obj.label ? obj.label : puzzleId || "unknown object",
      type: typeof obj.type === "string" ? obj.type : "",
      interactive,
      rawPosition: sanitizePosition(obj.position),
    });
  });

  // Every puzzle must be reachable: synthesize an object for uncovered ones.
  puzzles.forEach((puzzle, i) => {
    if (coveredPuzzles.has(puzzle.id)) return;
    entries.push({
      id: `synth-${puzzle.id}`,
      puzzleId: puzzle.id,
      label: puzzle.id.replace(/[_-]+/g, " "),
      type: "mysterious device",
      interactive: true,
      rawPosition: ringPosition(rawObjects.length + i),
    });
  });

  // Classify + fill missing positions.
  entries.forEach((e, i) => {
    const { archetype, wallMounted } = classifyArchetype(e.type, e.label);
    e.archetype = archetype;
    e.wallMounted = wallMounted;
    e.seed = hash01(e.id + e.label);
    if (!e.rawPosition) e.rawPosition = ringPosition(i);
  });

  // Normalize hint coordinates into the interior band, preserving the
  // relative arrangement. Degenerate spans (all objects on a line/point)
  // fall back to ring placement on that axis.
  const remapAxis = (values, limit) => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min;
    if (span < 1e-6) return values.map((_, i) => ringPosition(i)[0] * (limit / FLOOR_X));
    return values.map((v) => ((v - min) / span) * 2 * limit - limit);
  };
  if (entries.length > 0) {
    const xs = remapAxis(entries.map((e) => e.rawPosition[0]), FLOOR_X);
    const zs = remapAxis(entries.map((e) => e.rawPosition[2]), FLOOR_Z);
    entries.forEach((e, i) => {
      e.position = [xs[i], e.rawPosition[1], zs[i]];
    });
  }

  placeWallProps(entries.filter((e) => e.wallMounted));
  placeFloorProps(entries.filter((e) => !e.wallMounted));

  return entries.map(({ rawPosition: _raw, ...rest }) => rest);
}

/* ---- Wall placement ---------------------------------------------------- */

// Walls keyed by which coordinate is pinned. rotationY turns the prop's +z
// face toward the room interior.
const WALLS = [
  { id: "+x", pin: "x", pinValue: ROOM.halfW, slide: "z", slideLimit: ROOM.halfD - 1.8, rotationY: -Math.PI / 2 },
  { id: "-x", pin: "x", pinValue: -ROOM.halfW, slide: "z", slideLimit: ROOM.halfD - 1.8, rotationY: Math.PI / 2 },
  { id: "+z", pin: "z", pinValue: ROOM.halfD, slide: "x", slideLimit: ROOM.halfW - 1.8, rotationY: Math.PI },
  { id: "-z", pin: "z", pinValue: -ROOM.halfD, slide: "x", slideLimit: ROOM.halfW - 1.8, rotationY: 0 },
];

function placeWallProps(props) {
  const byWall = new Map(WALLS.map((w) => [w.id, []]));

  for (const prop of props) {
    const [x, , z] = prop.position;
    // Nearest wall = the axis proportionally closest to its bound.
    const wall =
      Math.abs(x) / ROOM.halfW >= Math.abs(z) / ROOM.halfD
        ? x >= 0 ? WALLS[0] : WALLS[1]
        : z >= 0 ? WALLS[2] : WALLS[3];
    byWall.get(wall.id).push(prop);
  }

  for (const wall of WALLS) {
    const group = byWall.get(wall.id);
    if (group.length === 0) continue;

    // Sort along the wall, then enforce a minimum gap between neighbors.
    const slideIdx = wall.slide === "x" ? 0 : 2;
    group.sort((a, b) => a.position[slideIdx] - b.position[slideIdx]);
    const slides = group.map((p) =>
      clamp(p.position[slideIdx], -wall.slideLimit, wall.slideLimit)
    );
    for (let i = 1; i < slides.length; i++) {
      if (slides[i] < slides[i - 1] + WALL_SLIDE_GAP) slides[i] = slides[i - 1] + WALL_SLIDE_GAP;
    }
    // If the row overflowed the wall, recenter it.
    const overflow = slides[slides.length - 1] - wall.slideLimit;
    if (overflow > 0) {
      const shift = Math.min(overflow, slides[0] + wall.slideLimit);
      for (let i = 0; i < slides.length; i++) slides[i] -= shift;
    }

    group.forEach((prop, i) => {
      const pos = [0, 0, 0];
      pos[wall.pin === "x" ? 0 : 2] = wall.pinValue;
      pos[slideIdx] = clamp(slides[i], -wall.slideLimit, wall.slideLimit);
      // Doors reach the floor; panels hang at eye height (raw y as a hint).
      pos[1] = prop.archetype === "door" ? 0 : clamp(prop.position[1], 1.5, 2.6);
      prop.position = pos;
      prop.rotationY = wall.rotationY;
    });
  }
}

/* ---- Floor placement --------------------------------------------------- */

function placeFloorProps(props) {
  // Relaxation: push apart overlapping pairs, keep out of the camera-target
  // zone at center, clamp to the interior band.
  for (let iter = 0; iter < 24; iter++) {
    for (let i = 0; i < props.length; i++) {
      for (let j = i + 1; j < props.length; j++) {
        const a = props[i].position;
        const b = props[j].position;
        let dx = b[0] - a[0];
        let dz = b[2] - a[2];
        let d = Math.hypot(dx, dz);
        if (d >= MIN_SEPARATION) continue;
        if (d < 1e-4) {
          // Coincident: split along a deterministic direction.
          const ang = (props[i].seed + props[j].seed) * Math.PI * 2;
          dx = Math.cos(ang);
          dz = Math.sin(ang);
          d = 1;
        }
        const push = (MIN_SEPARATION - d) / 2 / d;
        a[0] -= dx * push;
        a[2] -= dz * push;
        b[0] += dx * push;
        b[2] += dz * push;
      }
    }
    for (const prop of props) {
      const p = prop.position;
      // Keep the orbit center clear.
      const r = Math.hypot(p[0], p[2]);
      if (r < CENTER_CLEARANCE) {
        const ang = r < 1e-4 ? prop.seed * Math.PI * 2 : Math.atan2(p[2], p[0]);
        p[0] = Math.cos(ang) * CENTER_CLEARANCE;
        p[2] = Math.sin(ang) * CENTER_CLEARANCE;
      }
      p[0] = clamp(p[0], -FLOOR_X, FLOOR_X);
      p[2] = clamp(p[2], -FLOOR_Z, FLOOR_Z);
    }
  }

  for (const prop of props) {
    prop.position[1] = 0; // floor props sit on the floor
    // Face the room center, with a little deterministic jitter for life.
    const [x, , z] = prop.position;
    // +z of the prop (its "front") points at (sin ry, cos ry); aim it at the
    // room center.
    prop.rotationY = Math.atan2(-x, -z) + (prop.seed - 0.5) * 0.5;
  }
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
