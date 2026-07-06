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

/* ---- Prop state palettes ------------------------------------------------ */

/**
 * Material color targets for an interactive prop in a given state.
 * Roles map to material userData.role tags inside the archetypes:
 *   body  — structural mass       panel — secondary surfaces
 *   glow  — bright emissive parts glowSoft — dim emissive details
 */
export function propStatePalette(tokens, state) {
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
        body: col(tokens.border),
        panel: lighten(tokens.surface, 0.08),
        glow: col(tokens.primary),
        glowIntensity: 1.7,
        softIntensity: 0.7,
      };
  }
}

/* ---- Mood configs (lighting arcs, fog, shell colors) -------------------- */

/**
 * Build the full 3D mood for a family from its (CSS-derived) tokens.
 * All `start` values apply at progress 0, `end` at progress 1 (all solved);
 * light components lerp between them as puzzles are solved.
 */
export function buildMood(family, tokens) {
  const fam = normalizeFamily(family);
  const shell = {
    floor: darken(tokens.surface, 0.2),
    wall: lighten(tokens.surface, 0.16),
    ceiling: darken(tokens.surface, 0.42),
    trim: col(tokens.border),
  };

  switch (fam) {
    case "sci-fi":
      // Harsh amber emergency lighting calms toward cool cyan/white.
      return {
        shell,
        fog: { color: darken(tokens.surface, 0.55), near: 10, far: 30 },
        ambient: { color: lighten(tokens.surface, 0.3), start: 0.22, end: 0.5 },
        key: {
          position: [4, 4.4, 2],
          colorStart: col(tokens.accent),
          colorEnd: lighten(tokens.primary, 0.4),
          start: 1.6,
          end: 2.4,
          shadows: true,
        },
        accents: [
          { position: [-6, 3.4, -4], color: col(tokens.accent), start: 1.7, end: 0.12, distance: 14, pulse: 0.5 },
          { position: [6, 2.8, 4], color: col(tokens.primary), start: 0.9, end: 2.6, distance: 14 },
        ],
        flicker: 0,
        dust: { color: tokens.primary, count: 50, size: 1.6, speed: 0.3, opacity: 0.3 },
      };
    case "fantasy":
      // Warm hearth-glow deepens into radiant gold as magic awakens.
      return {
        shell,
        fog: { color: darken(tokens.surface, 0.45), near: 11, far: 32 },
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
      };
    case "horror-gothic":
      // Oppressive candle-lit dark; each solve lifts the gloom a little.
      return {
        shell,
        fog: { color: col("#050304"), near: 6, far: 22 },
        ambient: { color: lighten(tokens.surface, 0.2), start: 0.14, end: 0.34 },
        key: {
          position: [0, 3.8, 1.5],
          colorStart: col("#b05a28"), // candle warmth from the CSS glow layer
          colorEnd: col("#d08a4a"),
          start: 1.8,
          end: 2.5,
          shadows: true,
        },
        accents: [
          { position: [-6.5, 1.4, -4.5], color: col(tokens.primary), start: 1.2, end: 0.6, distance: 10, pulse: 0.3 },
          { position: [6.5, 1.4, 4.5], color: col(tokens.accent), start: 0.35, end: 1.6, distance: 11 },
        ],
        flicker: 0.55,
        dust: { color: tokens.inkDim, count: 40, size: 1.8, speed: 0.12, opacity: 0.25 },
      };
    case "noir-mystery":
      // One hard white key through the blinds; fill rises as the case cracks.
      return {
        shell,
        fog: { color: darken(tokens.surface, 0.5), near: 10, far: 30 },
        ambient: { color: col(tokens.accent), start: 0.1, end: 0.32 },
        key: {
          position: [-6.5, 3.6, -2],
          colorStart: col("#f2ead6"),
          colorEnd: col("#f6f0dd"),
          start: 2.6,
          end: 3.0,
          shadows: true,
        },
        accents: [
          { position: [6, 2.6, 4], color: col(tokens.accent), start: 0.2, end: 1.5, distance: 13 },
          { position: [0, 4.2, 0], color: col(tokens.primary), start: 0.35, end: 0.9, distance: 8 },
        ],
        flicker: 0.06,
        dust: { color: tokens.accent, count: 60, size: 1.5, speed: 0.1, opacity: 0.4 },
      };
    case "nature":
      // Forest dusk warming toward dappled golden morning.
      return {
        shell,
        fog: { color: darken(tokens.surface, 0.4), near: 11, far: 32 },
        ambient: { color: col(tokens.primary), start: 0.28, end: 0.5 },
        key: {
          position: [5, 4.4, -2],
          colorStart: col(tokens.accent),
          colorEnd: lighten(tokens.accent, 0.3),
          start: 1.2,
          end: 2.6,
          shadows: true,
        },
        accents: [
          { position: [-5.5, 2.4, 4], color: col(tokens.primary), start: 1.0, end: 1.8, distance: 13 },
          { position: [3, 1.2, 4.5], color: col(tokens.accent), start: 0.5, end: 1.4, distance: 10 },
        ],
        flicker: 0.05,
        dust: { color: tokens.accent, count: 90, size: 2.4, speed: 0.35, opacity: 0.55 },
      };
    case "cyberpunk":
    default:
      // Dueling magenta/cyan neon that surges brighter with progress.
      return {
        shell,
        fog: { color: col("#04050a"), near: 9, far: 28 },
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
      };
  }
}
