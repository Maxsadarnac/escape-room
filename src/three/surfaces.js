/* =========================================================================
   Procedural surface textures — the step from "six colored planes" to walls
   and floors that read as built material.

   Everything is painted into offscreen canvases at runtime (no assets, no
   network): one albedo, one bump (height), one roughness canvas per surface,
   sharing a single deterministic layout so seams/stones/planks line up
   across all three channels. Albedo is painted in near-neutral grays and
   tinted by the material's `color` (the family shell tone), so the palette
   pipeline — families.css tokens + scene.palette casts — keeps full control
   of the room's color.

   getSurfaces(family) is cached; textures are shared across every mesh of a
   room and cloned only to vary the repeat per surface size.
   ========================================================================= */

import * as THREE from "three";

const TEX_SIZE = 512;

/* ---- Deterministic PRNG -------------------------------------------------- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- Tri-canvas ----------------------------------------------------------
   One layout pass draws into three canvases at once: albedo (a), bump (b),
   roughness (r). Colors are given as gray levels 0..255 (null = skip that
   channel for this shape).                                                  */

function makeTri() {
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = c.height = TEX_SIZE;
    return c;
  };
  const canvases = { a: mk(), b: mk(), r: mk() };
  return {
    ...canvases,
    ctx: {
      a: canvases.a.getContext("2d"),
      b: canvases.b.getContext("2d"),
      r: canvases.r.getContext("2d"),
    },
  };
}

const g = (v) => `rgb(${v | 0},${v | 0},${v | 0})`;

function fillAll(t, { a, b, r }) {
  for (const [ch, v] of [["a", a], ["b", b], ["r", r]]) {
    if (v == null) continue;
    t.ctx[ch].fillStyle = g(v);
    t.ctx[ch].fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  }
}

function rectAll(t, x, y, w, h, { a, b, r, alpha = 1 }) {
  for (const [ch, v] of [["a", a], ["b", b], ["r", r]]) {
    if (v == null) continue;
    const ctx = t.ctx[ch];
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g(v);
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
  }
}

function lineAll(t, x1, y1, x2, y2, width, { a, b, r, alpha = 1 }) {
  for (const [ch, v] of [["a", a], ["b", b], ["r", r]]) {
    if (v == null) continue;
    const ctx = t.ctx[ch];
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = g(v);
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function dotAll(t, x, y, radius, { a, b, r, alpha = 1 }) {
  for (const [ch, v] of [["a", a], ["b", b], ["r", r]]) {
    if (v == null) continue;
    const ctx = t.ctx[ch];
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g(v);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/** Fine speckle grain over the whole tile — breaks up flat fills. */
function grain(t, rnd, { n = 2600, spread = 26, size = 2, channels = ["a"], alpha = 0.16 }) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * TEX_SIZE;
    const y = rnd() * TEX_SIZE;
    const v = 128 + (rnd() - 0.5) * 2 * spread;
    const s = 0.6 + rnd() * size;
    const spec = { alpha };
    for (const ch of channels) spec[ch] = v;
    rectAll(t, x, y, s, s, spec);
  }
}

/** Large soft blotches (stains, wear, damp) via radial gradients. */
function blotches(t, rnd, { n = 8, minR = 40, maxR = 130, dark = true, channels = ["a"], alpha = 0.1 }) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * TEX_SIZE;
    const y = rnd() * TEX_SIZE;
    const radius = minR + rnd() * (maxR - minR);
    const v = dark ? 60 + rnd() * 40 : 190 + rnd() * 40;
    for (const ch of channels) {
      const ctx = t.ctx[ch];
      const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
      grad.addColorStop(0, `rgba(${v | 0},${v | 0},${v | 0},${alpha})`);
      grad.addColorStop(1, `rgba(${v | 0},${v | 0},${v | 0},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  }
}

/* ---- Painters ------------------------------------------------------------
   Each fills the tri-canvas for one tileable surface. Gray-level intent:
   albedo ~150 base (tint multiplies), bump 128 = flat, roughness per
   material.                                                                 */

function paintDeckPlates(t, rnd) {
  // sci-fi floor: large metal plates, dark seams, corner bolts, wear.
  fillAll(t, { a: 150, b: 128, r: 110 });
  grain(t, rnd, { n: 3200, spread: 12, channels: ["a", "r"], alpha: 0.2 });
  const cells = 3;
  const cs = TEX_SIZE / cells;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const x = i * cs;
      const y = j * cs;
      // per-plate tone shift
      rectAll(t, x, y, cs, cs, { a: 140 + rnd() * 26, alpha: 0.5 });
      // seams (dips, darker, rougher)
      lineAll(t, x, y, x + cs, y, 5, { a: 78, b: 60, r: 200 });
      lineAll(t, x, y, x, y + cs, 5, { a: 78, b: 60, r: 200 });
      // highlight bevel just inside the seam
      lineAll(t, x + 4, y + 4, x + cs - 4, y + 4, 2, { a: 185, b: 175, alpha: 0.7 });
      // corner bolts
      for (const [bx, by] of [[14, 14], [cs - 14, 14], [14, cs - 14], [cs - 14, cs - 14]]) {
        dotAll(t, x + bx, y + by, 4.5, { a: 100, b: 175, r: 90 });
        dotAll(t, x + bx - 1, y + by - 1, 1.8, { a: 200, alpha: 0.8 });
      }
      // occasional vent slots
      if (rnd() < 0.3) {
        for (let k = 0; k < 4; k++) {
          rectAll(t, x + cs * 0.3, y + cs * 0.36 + k * 9, cs * 0.4, 4, { a: 70, b: 80, r: 190 });
        }
      }
    }
  }
  blotches(t, rnd, { n: 7, channels: ["a", "r"], dark: true, alpha: 0.12 });
  return { metersPerTile: 4, bumpScale: 3, roughness: 0.62, metalness: 0.35 };
}

function paintPanelWall(t, rnd) {
  // sci-fi wall: broad horizontal plating with recessed joints.
  fillAll(t, { a: 152, b: 128, r: 130 });
  grain(t, rnd, { n: 2400, spread: 10, channels: ["a", "r"], alpha: 0.18 });
  const rows = [0, 90, 235, 330, 470];
  for (let i = 0; i < rows.length - 1; i++) {
    const y = rows[i];
    const h = rows[i + 1] - y;
    rectAll(t, 0, y, TEX_SIZE, h, { a: 142 + rnd() * 24, alpha: 0.5 });
    lineAll(t, 0, y, TEX_SIZE, y, 4, { a: 82, b: 62, r: 190 });
    lineAll(t, 0, y + 3, TEX_SIZE, y + 3, 1.5, { a: 190, b: 178, alpha: 0.7 });
    // sparse vertical joints, offset per course
    const off = rnd() * TEX_SIZE;
    for (let x = off; x < off + TEX_SIZE; x += 170 + rnd() * 120) {
      lineAll(t, x % TEX_SIZE, y, x % TEX_SIZE, y + h, 3, { a: 92, b: 78, r: 180, alpha: 0.9 });
    }
  }
  blotches(t, rnd, { n: 5, channels: ["a"], dark: true, alpha: 0.08 });
  return { metersPerTile: 4, bumpScale: 2.5, roughness: 0.7, metalness: 0.25 };
}

function roundedStone(t, x, y, w, h, tone, rnd) {
  const inset = 3 + rnd() * 3;
  for (const [ch, v, alpha] of [["a", tone, 1], ["b", 120 + rnd() * 40, 1], ["r", 190 + rnd() * 40, 1]]) {
    const ctx = t.ctx[ch];
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g(v);
    ctx.beginPath();
    const rr = 8 + rnd() * 6;
    ctx.roundRect(x + inset, y + inset, w - inset * 2, h - inset * 2, rr);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function paintFlagstones(t, rnd) {
  // fantasy floor: irregular flagstone grid over dark mortar.
  fillAll(t, { a: 62, b: 40, r: 235 }); // mortar: dark, recessed, rough
  const rows = 4;
  const rh = TEX_SIZE / rows;
  for (let j = 0; j < rows; j++) {
    let x = -rnd() * 40;
    while (x < TEX_SIZE) {
      const w = 90 + rnd() * 90;
      roundedStone(t, x, j * rh, Math.min(w, TEX_SIZE - x + 20), rh, 130 + rnd() * 45, rnd);
      x += w;
    }
  }
  grain(t, rnd, { n: 3600, spread: 20, channels: ["a", "b"], alpha: 0.18 });
  blotches(t, rnd, { n: 9, channels: ["a"], dark: true, alpha: 0.12 });
  return { metersPerTile: 3.4, bumpScale: 5, roughness: 0.94 };
}

function paintStoneBlocks(t, rnd) {
  // fantasy wall: coursed ashlar blocks.
  fillAll(t, { a: 66, b: 45, r: 230 });
  const rows = 5;
  const rh = TEX_SIZE / rows;
  for (let j = 0; j < rows; j++) {
    const off = (j % 2) * 60 + rnd() * 30;
    let x = -off;
    while (x < TEX_SIZE) {
      const w = 120 + rnd() * 70;
      roundedStone(t, x, j * rh, Math.min(w, TEX_SIZE - x + 30), rh, 128 + rnd() * 38, rnd);
      x += w;
    }
  }
  grain(t, rnd, { n: 3000, spread: 18, channels: ["a", "b"], alpha: 0.16 });
  blotches(t, rnd, { n: 7, channels: ["a"], dark: true, alpha: 0.1 });
  return { metersPerTile: 3.2, bumpScale: 5, roughness: 0.92 };
}

function paintPlanks(t, rnd, { plankW = 64, worn = true } = {}) {
  // wood floor: long boards with grain streaks, knots, gap shadows.
  fillAll(t, { a: 160, b: 128, r: 205 });
  const cols = Math.round(TEX_SIZE / plankW);
  for (let i = 0; i < cols; i++) {
    const x = i * plankW;
    const tone = 140 + rnd() * 44;
    rectAll(t, x, 0, plankW, TEX_SIZE, { a: tone, b: 120 + rnd() * 16 });
    // board ends at a random break per column
    const yEnd = rnd() * TEX_SIZE;
    lineAll(t, x, yEnd, x + plankW, yEnd, 3, { a: 60, b: 70, r: 240 });
    // gaps between boards
    lineAll(t, x, 0, x, TEX_SIZE, 3, { a: 52, b: 58, r: 245 });
    // grain streaks
    for (let k = 0; k < 7; k++) {
      const gx = x + 6 + rnd() * (plankW - 12);
      lineAll(t, gx, 0, gx + (rnd() - 0.5) * 10, TEX_SIZE, 1, {
        a: tone - 26 - rnd() * 18,
        alpha: 0.5,
      });
    }
    // knots
    if (rnd() < 0.45) {
      dotAll(t, x + plankW / 2 + (rnd() - 0.5) * 20, rnd() * TEX_SIZE, 4 + rnd() * 4, {
        a: 62, b: 100, alpha: 0.85,
      });
    }
  }
  grain(t, rnd, { n: 2200, spread: 14, channels: ["a", "r"], alpha: 0.15 });
  if (worn) blotches(t, rnd, { n: 10, channels: ["a", "r"], dark: true, alpha: 0.14 });
  return { metersPerTile: 3, bumpScale: 2.5, roughness: worn ? 0.9 : 0.55 };
}

function paintPlaster(t, rnd, { stains = 0.12, cracks = 3 } = {}) {
  // aged plaster wall: mottled, streaked, cracked.
  fillAll(t, { a: 168, b: 128, r: 215 });
  grain(t, rnd, { n: 4200, spread: 16, channels: ["a", "b"], alpha: 0.16 });
  blotches(t, rnd, { n: 10, channels: ["a"], dark: true, alpha: stains });
  blotches(t, rnd, { n: 5, channels: ["a"], dark: false, alpha: stains * 0.6 });
  // vertical damp streaks from the top
  for (let i = 0; i < 6; i++) {
    const x = rnd() * TEX_SIZE;
    const len = 90 + rnd() * 200;
    const ctx = t.ctx.a;
    const grad = ctx.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, "rgba(70,70,70,0.18)");
    grad.addColorStop(1, "rgba(70,70,70,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, 5 + rnd() * 9, len);
  }
  // hairline cracks: jagged polylines
  for (let i = 0; i < cracks; i++) {
    let x = rnd() * TEX_SIZE;
    let y = rnd() * TEX_SIZE * 0.4;
    for (let s = 0; s < 9; s++) {
      const nx = x + (rnd() - 0.5) * 46;
      const ny = y + 22 + rnd() * 34;
      lineAll(t, x, y, nx, ny, 1.4, { a: 74, b: 96, alpha: 0.85 });
      x = nx;
      y = ny;
    }
  }
  return { metersPerTile: 3.4, bumpScale: 2, roughness: 0.9 };
}

function paintParquet(t, rnd) {
  // noir floor: herringbone-ish strip parquet with a dull sheen.
  fillAll(t, { a: 128, b: 128, r: 172 });
  const rows = 8;
  const rh = TEX_SIZE / rows;
  for (let j = 0; j < rows; j++) {
    const off = (j % 2) * (rh * 1.4);
    let x = -off;
    while (x < TEX_SIZE) {
      const w = rh * 2.8;
      const tone = 114 + rnd() * 34;
      rectAll(t, x + 1.5, j * rh + 1.5, w - 3, rh - 3, { a: tone, b: 122 + rnd() * 12 });
      // subtle grain along the strip
      for (let k = 0; k < 3; k++) {
        const gy = j * rh + 4 + rnd() * (rh - 8);
        lineAll(t, x + 3, gy, x + w - 3, gy + (rnd() - 0.5) * 3, 1, { a: tone - 20, alpha: 0.5 });
      }
      lineAll(t, x, j * rh, x, (j + 1) * rh, 2.5, { a: 58, b: 66, r: 220 });
      x += w;
    }
    lineAll(t, 0, j * rh, TEX_SIZE, j * rh, 2.5, { a: 58, b: 66, r: 220 });
  }
  grain(t, rnd, { n: 1600, spread: 10, channels: ["a", "r"], alpha: 0.12 });
  blotches(t, rnd, { n: 6, channels: ["r"], dark: false, alpha: 0.2 }); // scuffed dull patches
  return { metersPerTile: 2.8, bumpScale: 1.8, roughness: 0.66 };
}

function paintEarth(t, rnd) {
  // nature floor: packed soil, pebbles, mossy patches.
  fillAll(t, { a: 120, b: 128, r: 240 });
  grain(t, rnd, { n: 5200, spread: 26, channels: ["a", "b"], alpha: 0.22 });
  blotches(t, rnd, { n: 12, channels: ["a", "b"], dark: true, alpha: 0.16 });
  blotches(t, rnd, { n: 6, channels: ["a"], dark: false, alpha: 0.08 });
  // pebbles
  for (let i = 0; i < 130; i++) {
    const x = rnd() * TEX_SIZE;
    const y = rnd() * TEX_SIZE;
    const radius = 1.5 + rnd() * 3.5;
    dotAll(t, x, y, radius, { a: 100 + rnd() * 80, b: 150 + rnd() * 40, r: 200 });
  }
  // moss clumps — slightly green albedo (the only non-gray paint anywhere;
  // it stays subordinate to the family floor tint).
  for (let i = 0; i < 9; i++) {
    const x = rnd() * TEX_SIZE;
    const y = rnd() * TEX_SIZE;
    const radius = 26 + rnd() * 50;
    const ctx = t.ctx.a;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, "rgba(110,150,80,0.4)");
    grad.addColorStop(1, "rgba(110,150,80,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  return { metersPerTile: 3.4, bumpScale: 4, roughness: 1 };
}

function paintRock(t, rnd) {
  // nature wall: striated rock face.
  fillAll(t, { a: 118, b: 128, r: 235 });
  for (let i = 0; i < 26; i++) {
    const y = rnd() * TEX_SIZE;
    const h = 8 + rnd() * 26;
    rectAll(t, 0, y, TEX_SIZE, h, { a: 100 + rnd() * 50, b: 110 + rnd() * 36, alpha: 0.55 });
  }
  grain(t, rnd, { n: 4200, spread: 24, channels: ["a", "b"], alpha: 0.2 });
  blotches(t, rnd, { n: 8, channels: ["a"], dark: true, alpha: 0.14 });
  // diagonal fracture lines
  for (let i = 0; i < 5; i++) {
    const x = rnd() * TEX_SIZE;
    const y = rnd() * TEX_SIZE;
    lineAll(t, x, y, x + (rnd() - 0.5) * 220, y + 120 + rnd() * 160, 1.6, { a: 66, b: 84, alpha: 0.8 });
  }
  return { metersPerTile: 3.6, bumpScale: 5, roughness: 0.96 };
}

function paintConcrete(t, rnd, { floor = false } = {}) {
  // cyberpunk: stained concrete; the floor gets slab joints + a worn
  // painted guide line.
  fillAll(t, { a: 132, b: 128, r: floor ? 150 : 190 });
  grain(t, rnd, { n: 4600, spread: 15, channels: ["a", "b", "r"], alpha: 0.17 });
  blotches(t, rnd, { n: 13, channels: ["a", "r"], dark: true, alpha: 0.15 });
  blotches(t, rnd, { n: 4, channels: ["a"], dark: false, alpha: 0.07 });
  if (floor) {
    // slab joints
    for (const p of [0.33, 0.71]) {
      lineAll(t, p * TEX_SIZE, 0, p * TEX_SIZE, TEX_SIZE, 3.5, { a: 70, b: 66, r: 220 });
      lineAll(t, 0, p * TEX_SIZE, TEX_SIZE, p * TEX_SIZE, 3.5, { a: 70, b: 66, r: 220 });
    }
    // worn painted line (kept gray — the family tint colors it)
    rectAll(t, 0, TEX_SIZE * 0.5 - 9, TEX_SIZE, 18, { a: 205, r: 120, alpha: 0.55 });
    grain(t, rnd, { n: 500, spread: 40, channels: ["a"], alpha: 0.3 });
  } else {
    // formwork joints + tie holes
    for (const p of [0.25, 0.5, 0.75]) {
      lineAll(t, 0, p * TEX_SIZE, TEX_SIZE, p * TEX_SIZE, 2.5, { a: 88, b: 84, alpha: 0.9 });
    }
    for (let i = 0; i < 12; i++) {
      dotAll(t, (0.12 + 0.76 * rnd()) * TEX_SIZE, (0.1 + 0.8 * rnd()) * TEX_SIZE, 4, {
        a: 92, b: 90, alpha: 0.9,
      });
    }
  }
  return { metersPerTile: 3.8, bumpScale: 2.2, roughness: floor ? 0.72 : 0.88 };
}

/* ---- Assembly ------------------------------------------------------------ */

function toTexture(canvas, { srgb = false } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildSurface(painter, seed, opts) {
  const t = makeTri();
  const meta = painter(t, mulberry32(seed), opts);
  return {
    map: toTexture(t.a, { srgb: true }),
    bumpMap: toTexture(t.b),
    roughnessMap: toTexture(t.r),
    metersPerTile: meta.metersPerTile,
    bumpScale: meta.bumpScale,
    roughness: meta.roughness ?? 1,
    metalness: meta.metalness ?? 0,
  };
}

const FAMILY_SURFACES = {
  "sci-fi": () => ({
    floor: buildSurface(paintDeckPlates, 101),
    wall: buildSurface(paintPanelWall, 102),
  }),
  fantasy: () => ({
    floor: buildSurface(paintFlagstones, 201),
    wall: buildSurface(paintStoneBlocks, 202),
  }),
  "horror-gothic": () => ({
    floor: buildSurface(paintPlanks, 301, { plankW: 72, worn: true }),
    wall: buildSurface(paintPlaster, 302, { stains: 0.17, cracks: 5 }),
  }),
  "noir-mystery": () => ({
    floor: buildSurface(paintParquet, 401),
    wall: buildSurface(paintPlaster, 402, { stains: 0.08, cracks: 1 }),
  }),
  nature: () => ({
    floor: buildSurface(paintEarth, 501),
    wall: buildSurface(paintRock, 502),
  }),
  cyberpunk: () => ({
    floor: buildSurface(paintConcrete, 601, { floor: true }),
    wall: buildSurface(paintConcrete, 602, { floor: false }),
  }),
};

const cache = new Map();

/** Cached per-family surface set: { floor, wall }, each with maps + params. */
export function getSurfaces(family) {
  const key = FAMILY_SURFACES[family] ? family : "sci-fi";
  if (!cache.has(key)) cache.set(key, FAMILY_SURFACES[key]());
  return cache.get(key);
}

/**
 * Props for a meshStandardMaterial using a surface, with the texture repeat
 * matched to the mesh's world size (w×h meters). Clones share the underlying
 * canvas image, so per-mesh repeats cost no extra GPU memory uploads.
 */
export function surfaceMaterialProps(surf, w, h) {
  const rx = w / surf.metersPerTile;
  const ry = h / surf.metersPerTile;
  const mk = (tex) => {
    const c = tex.clone();
    c.repeat.set(rx, ry);
    return c;
  };
  return {
    map: mk(surf.map),
    bumpMap: mk(surf.bumpMap),
    roughnessMap: mk(surf.roughnessMap),
    bumpScale: surf.bumpScale,
    roughness: surf.roughness,
    metalness: surf.metalness,
  };
}
