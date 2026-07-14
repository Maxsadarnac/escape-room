/* =========================================================================
   Per-visualFamily 3D presets — what CSS cannot express: light-rig
   geometry, intensity arcs across solve progress, flicker behavior, fog,
   and prop material palettes per puzzle state.

   Token *reading* lives in familyTokens.js (kept three-free so the main
   bundle stays lean); this module is only imported from the lazy 3D chunk.
   ========================================================================= */

import * as THREE from "three";
import { normalizeFamily } from "./familyTokens";

export { normalizeFamily };

/* ---- Color helpers ------------------------------------------------------ */

const col = (hex) => new THREE.Color(hex);

function lighten(hex, amount) {
  return col(hex).lerp(new THREE.Color("#ffffff"), amount);
}
function darken(hex, amount) {
  return col(hex).lerp(new THREE.Color("#000000"), amount);
}
function desaturate(hex, satScale, lightScale) {
  const c = col(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s * satScale, hsl.l * lightScale);
  return c;
}

/* ---- Per-family material finish -----------------------------------------
   Applied once to every prop material: technical families read metallic
   and machined, organic/period families read matte.                        */

export const FAMILY_FINISH = {
  "sci-fi": { metalBoost: 0.3, roughShift: -0.18 },
  cyberpunk: { metalBoost: 0.35, roughShift: -0.22 },
  "noir-mystery": { metalBoost: 0.12, roughShift: -0.05 },
  fantasy: { metalBoost: 0.05, roughShift: 0.02 },
  "horror-gothic": { metalBoost: 0, roughShift: 0.04 },
  nature: { metalBoost: 0, roughShift: 0.05 },
};

/* ---- scene.mood adjustments ----------------------------------------------
   The generator's free-text mood ("eerie, cold, abandoned...") nudges the
   light rig so two rooms of the same family still feel different.          */

const MOOD_KEYWORDS = [
  { re: /cold|icy|frozen|chill|sterile/, warmth: -1 },
  { re: /warm|cozy|hearth|golden|sunlit/, warmth: +1 },
  { re: /eerie|dread|haunt|ominous|sinister|decay/, gloom: +1 },
  { re: /bright|hopeful|serene|tranquil|airy/, gloom: -1 },
  { re: /urgent|tense|alarm|frantic|danger/, urgency: +1 },
];

export function moodAdjust(moodText) {
  const out = { warmth: 0, gloom: 0, urgency: 0 };
  const text = typeof moodText === "string" ? moodText.toLowerCase() : "";
  for (const kw of MOOD_KEYWORDS) {
    if (kw.re.test(text)) {
      if (kw.warmth) out.warmth += kw.warmth;
      if (kw.gloom) out.gloom += kw.gloom;
      if (kw.urgency) out.urgency += kw.urgency;
    }
  }
  return out;
}

const WARM_TINT = new THREE.Color("#ffb066");
const COOL_TINT = new THREE.Color("#7ab8ff");

/* ---- Prop state palettes ------------------------------------------------ */

/**
 * Material color targets for an interactive prop in a given state.
 * Roles map to material userData.role tags inside the archetypes:
 *   body  — structural mass       panel — secondary surfaces
 *   glow  — bright emissive parts glowSoft — dim emissive details
 * `tint` (a scene.palette color) gives each room's props their own cast.
 */
export function propStatePalette(tokens, state, tint) {
  const palette = baseStatePalette(tokens, state);
  if (tint && (state === "active" || state === "solved")) {
    const tintCol = col(tint);
    palette.body.lerp(tintCol, 0.13);
    palette.panel.lerp(tintCol, 0.08);
  }
  return palette;
}

function baseStatePalette(tokens, state) {
  switch (state) {
    case "locked":
      return {
        body: desaturate(tokens.border, 0.12, 0.75),
        panel: desaturate(tokens.surface, 0.12, 0.7),
        glow: desaturate(tokens.inkDim, 0.15, 0.7),
        glowIntensity: 0.06,
        softIntensity: 0.03,
      };
    case "solved":
      return {
        body: col(tokens.border).lerp(col(tokens.accent), 0.18),
        panel: lighten(tokens.surface, 0.06),
        glow: col(tokens.accent),
        glowIntensity: 2.8,
        softIntensity: 1.2,
      };
    case "decor":
      return {
        body: desaturate(tokens.border, 0.45, 0.9),
        panel: desaturate(tokens.surface, 0.45, 0.9),
        glow: desaturate(tokens.inkDim, 0.4, 0.9),
        glowIntensity: 0.15,
        softIntensity: 0.08,
      };
    case "active":
    default:
      return {
        body: col(tokens.border).lerp(col(tokens.primary), 0.1),
        panel: lighten(tokens.surface, 0.12),
        glow: col(tokens.primary),
        glowIntensity: 2.1,
        softIntensity: 0.85,
      };
  }
}

/* ---- Mood configs (lighting arcs, fog, shell colors) -------------------- */

/**
 * Build the full 3D mood for a family from its (CSS-derived) tokens.
 * All `start` values apply at progress 0, `end` at progress 1 (all solved);
 * light components lerp between them as puzzles are solved.
 * `options.moodText` (scene.mood) and `options.paletteHints` (scene.palette)
 * post-adjust the rig so every generated room has its own cast.
 */
export function buildMood(family, tokens, options = {}) {
  const mood = baseMood(family, tokens);
  mood.post = POST[normalizeFamily(family)];
  const adj = moodAdjust(options.moodText);

  if (adj.warmth !== 0) {
    const tint = adj.warmth > 0 ? WARM_TINT : COOL_TINT;
    const amt = Math.min(Math.abs(adj.warmth), 2) * 0.16;
    mood.ambient.color.lerp(tint, amt);
    mood.key.colorStart.lerp(tint, amt * 0.7);
  }
  if (adj.gloom !== 0) {
    const mult = 1 - Math.min(Math.max(adj.gloom, -2), 2) * 0.14;
    mood.ambient.start *= mult;
    mood.key.start *= Math.max(mult, 0.7);
  }
  if (adj.urgency > 0) {
    for (const a of mood.accents) a.pulse = Math.min((a.pulse || 0) + 0.18, 0.7);
  }

  const cast = options.paletteHints?.[0];
  if (cast) {
    const castCol = col(cast);
    mood.shell.wall.lerp(castCol, 0.16);
    mood.shell.floor.lerp(castCol, 0.12);
    mood.fog.color.lerp(castCol, 0.1);
  }
  return mood;
}

/* Per-family post-processing + environment-light dials (see postfx.jsx):
   bloom — emissive glare; ao — corner/contact occlusion strength;
   vignette — edge darkening; grain — film-grain opacity (0 disables);
   env — image-based-light intensity (specular life on metals).            */
const POST = {
  "sci-fi": { bloom: 0.75, ao: 2.2, vignette: 0.26, grain: 0, env: 0.32 },
  fantasy: { bloom: 0.95, ao: 2.6, vignette: 0.3, grain: 0.18, env: 0.14 },
  "horror-gothic": { bloom: 0.8, ao: 3.2, vignette: 0.46, grain: 0.42, env: 0.07 },
  "noir-mystery": { bloom: 0.55, ao: 2.8, vignette: 0.44, grain: 0.45, env: 0.14 },
  nature: { bloom: 0.85, ao: 2.6, vignette: 0.28, grain: 0, env: 0.16 },
  cyberpunk: { bloom: 1.2, ao: 2.4, vignette: 0.34, grain: 0.22, env: 0.38 },
};

function baseMood(family, tokens) {
  const fam = normalizeFamily(family);
  const shell = {
    floor: darken(tokens.surface, 0.2),
    wall: lighten(tokens.surface, 0.11),
    ceiling: darken(tokens.surface, 0.42),
    trim: col(tokens.border),
  };

  switch (fam) {
    case "sci-fi":
      // Cold, hard instrumentation light; the amber emergency accent pulses
      // in a corner and dies away as systems come back online. Walls stay
      // near the raw surface tone — the near-white key was washing the whole
      // shell to beige.
      shell.wall = lighten(tokens.surface, 0.04);
      return {
        shell,
        fog: { color: darken(tokens.surface, 0.42), near: 9, far: 26 },
        ambient: { color: lighten(tokens.surface, 0.35), start: 0.22, end: 0.46 },
        key: {
          position: [4, 4.4, 2],
          colorStart: lighten(tokens.primary, 0.3),
          colorEnd: lighten(tokens.primary, 0.2),
          start: 1.35,
          end: 2.4,
          shadows: true,
        },
        accents: [
          { position: [-6, 3.4, -4], color: col(tokens.accent), start: 1.05, end: 0.12, distance: 10, pulse: 0.5 },
          { position: [6, 2.8, 4], color: col(tokens.primary), start: 1.2, end: 2.6, distance: 14 },
        ],
        flicker: 0,
        dust: { color: tokens.primary, count: 50, size: 1.6, speed: 0.3, opacity: 0.3 },
      };
    case "fantasy":
      // Warm hearth-glow deepens into radiant gold as magic awakens.
      return {
        shell,
        fog: { color: darken(tokens.surface, 0.34), near: 10, far: 28 },
        ambient: { color: lighten(tokens.primary, 0.55), start: 0.3, end: 0.55 },
        key: {
          position: [-3, 4.2, 3],
          colorStart: col(tokens.primary),
          colorEnd: lighten(tokens.primary, 0.25),
          start: 1.4,
          end: 2.3,
          shadows: true,
        },
        accents: [
          { position: [5.5, 2.2, -4], color: col(tokens.accent), start: 1.1, end: 2.2, distance: 12 },
          { position: [-5.5, 2.2, -4], color: col(tokens.primary), start: 1.4, end: 2.4, distance: 12, pulse: 0.18 },
        ],
        flicker: 0.12,
        dust: { color: tokens.primary, count: 70, size: 2.2, speed: 0.22, opacity: 0.5 },
        // embers rising from the two braziers
        extra: [
          { position: [-5.5, 1.9, -4.3], scale: [1.1, 1.7, 1.1], count: 14, size: 2.4, speed: 0.55, opacity: 0.7, color: tokens.primary },
          { position: [5.5, 1.9, -4.3], scale: [1.1, 1.7, 1.1], count: 14, size: 2.4, speed: 0.55, opacity: 0.7, color: tokens.primary },
        ],
      };
    case "horror-gothic":
      // Oppressive candle-lit dark; each solve lifts the gloom a little.
      // Fog/ambient floors keep object silhouettes readable inside the dread.
      return {
        shell,
        fog: { color: col("#0d0705"), near: 5.5, far: 23 },
        // The textured plaster/plank albedo eats more light than the old
        // flat fills — the rig runs hotter here to stay readable.
        ambient: { color: lighten(tokens.surface, 0.2), start: 0.38, end: 0.58 },
        key: {
          position: [0, 3.8, 1.5],
          colorStart: col("#b05a28"), // candle warmth from the CSS glow layer
          colorEnd: col("#d08a4a"),
          start: 2.2,
          end: 3.0,
          shadows: true,
        },
        accents: [
          { position: [-6.5, 1.4, -4.5], color: col(tokens.primary), start: 1.6, end: 0.8, distance: 12, pulse: 0.3 },
          { position: [6.5, 1.4, 4.5], color: col(tokens.accent), start: 0.5, end: 1.6, distance: 12 },
        ],
        flicker: 0.55,
        dust: { color: tokens.inkDim, count: 24, size: 1.8, speed: 0.1, opacity: 0.18 },
        // motes caught only in the candle glow
        extra: [
          { position: [-6.6, 0.9, -4.8], scale: [1.1, 1.4, 1.1], count: 10, size: 1.7, speed: 0.09, opacity: 0.35, color: "#e8a04c" },
          { position: [6.6, 0.9, 4.6], scale: [1.1, 1.4, 1.1], count: 10, size: 1.7, speed: 0.09, opacity: 0.35, color: "#e8a04c" },
          { position: [-6.4, 0.9, 4.7], scale: [1.1, 1.4, 1.1], count: 10, size: 1.7, speed: 0.09, opacity: 0.35, color: "#e8a04c" },
        ],
      };
    case "noir-mystery":
      // One hard white key through the blinds; fill rises as the case cracks.
      return {
        shell,
        fog: { color: darken(tokens.surface, 0.38), near: 9, far: 27 },
        ambient: { color: col(tokens.accent), start: 0.5, end: 0.66 },
        key: {
          position: [-6.5, 3.6, -2],
          colorStart: col("#f2ead6"),
          colorEnd: col("#f6f0dd"),
          // Down from 2.6/3.0 — the parquet's sheen + bloom blew out the
          // window light pool at the old energy.
          start: 1.9,
          end: 2.3,
          shadows: true,
        },
        accents: [
          // warm bounce on the far side + the bare bulb over the desk area
          { position: [6, 2.6, 4], color: col(tokens.accent), start: 0.9, end: 1.7, distance: 13 },
          { position: [0.8, 3.6, 0.6], color: col("#f2e6c8"), start: 0.8, end: 1.2, distance: 9 },
        ],
        flicker: 0.06,
        dust: { color: tokens.accent, count: 30, size: 1.4, speed: 0.08, opacity: 0.25 },
        // dust hanging in the venetian window shaft
        extra: [
          { position: [-6.1, 3.0, -2], scale: [2.6, 2.2, 1.7], count: 46, size: 1.7, speed: 0.05, opacity: 0.55, color: "#f2ead6" },
        ],
      };
    case "nature":
      // Forest dusk warming toward dappled golden morning. Ambient is a
      // desaturated undergrowth green so the gold key carries the contrast —
      // full-strength primary flattened the whole room into one green.
      shell.wall = lighten(tokens.surface, 0.03);
      return {
        shell,
        fog: { color: darken(tokens.surface, 0.3), near: 10, far: 28 },
        ambient: { color: desaturate(tokens.primary, 0.5, 0.8), start: 0.26, end: 0.48 },
        key: {
          position: [5, 4.4, -2],
          colorStart: col(tokens.accent),
          colorEnd: lighten(tokens.accent, 0.3),
          start: 1.5,
          end: 2.7,
          shadows: true,
        },
        accents: [
          { position: [-5.5, 2.4, 4], color: col(tokens.primary), start: 1.2, end: 1.9, distance: 13 },
          { position: [3, 1.2, 4.5], color: col(tokens.accent), start: 0.9, end: 1.6, distance: 12 },
        ],
        flicker: 0.05,
        dust: { color: tokens.accent, count: 60, size: 2.4, speed: 0.35, opacity: 0.5 },
        // fireflies gathering under the canopy corners
        extra: [
          { position: [-6.3, 3.9, -4.4], scale: [1.8, 1.4, 1.8], count: 16, size: 2.8, speed: 0.5, opacity: 0.8, color: tokens.accent },
          { position: [6.3, 3.9, 4.4], scale: [1.8, 1.4, 1.8], count: 16, size: 2.8, speed: 0.5, opacity: 0.8, color: tokens.accent },
        ],
      };
    case "cyberpunk":
    default:
      // Dueling magenta/cyan neon that surges brighter with progress.
      return {
        shell,
        fog: { color: col("#0a0716"), near: 8, far: 24 },
        ambient: { color: col(tokens.inkDim), start: 0.14, end: 0.3 },
        key: {
          position: [0, 4.5, 3],
          colorStart: col(tokens.ink),
          colorEnd: col(tokens.ink),
          start: 0.5,
          end: 1.1,
          shadows: true,
        },
        accents: [
          { position: [-6.5, 3, -4.5], color: col(tokens.primary), start: 2.4, end: 3.4, distance: 16, pulse: 0.25 },
          { position: [6.5, 3, 4.5], color: col(tokens.accent), start: 2.0, end: 3.2, distance: 16, pulse: 0.18 },
        ],
        flicker: 0.14,
        dust: { color: tokens.accent, count: 55, size: 1.5, speed: 0.4, opacity: 0.35 },
        // neon haze pooling at floor level
        extra: [
          { position: [0, 0.55, 0], scale: [13, 0.9, 9], count: 34, size: 1.5, speed: 0.12, opacity: 0.22, color: tokens.primary },
        ],
      };
  }
}
