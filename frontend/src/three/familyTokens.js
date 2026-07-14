/* =========================================================================
   Family token access — deliberately free of three.js imports so the main
   bundle (intake screen, 2D fallback) doesn't pull the 3D stack in. The
   three-dependent mood/palette builders live in familyPresets.js, which is
   only reachable from the lazy-loaded RoomScene chunk.

   Colors come from the *same* CSS custom properties families.css defines
   (--fam-primary, --fam-accent, ...) — read off the mounted .room-screen
   element at runtime so the 3D scene and the 2D chrome can never drift
   apart. The FALLBACK table only mirrors families.css for non-DOM contexts
   (tests) and for the instant before mount.
   ========================================================================= */

export const VALID_FAMILIES = new Set([
  "sci-fi",
  "fantasy",
  "horror-gothic",
  "noir-mystery",
  "nature",
  "cyberpunk",
]);

const TOKEN_VARS = {
  surface: "--fam-surface",
  border: "--fam-border",
  ink: "--fam-ink",
  inkDim: "--fam-ink-dim",
  primary: "--fam-primary",
  accent: "--fam-accent",
};

// Mirrors families.css — keep in sync if those tokens change.
const FALLBACK_TOKENS = {
  "sci-fi": { surface: "#0b1521", border: "#1c3a4d", ink: "#dfeaf2", inkDim: "#6f95a8", primary: "#58c8f0", accent: "#ff9d3c" },
  fantasy: { surface: "#201811", border: "#6b4e1e", ink: "#ece0c8", inkDim: "#9a8763", primary: "#d9a94a", accent: "#3aa17e" },
  "horror-gothic": { surface: "#140d0f", border: "#3a1f22", ink: "#cfc4b8", inkDim: "#7d6f66", primary: "#b02525", accent: "#8b9a52" },
  "noir-mystery": { surface: "#1c1b16", border: "#3a382f", ink: "#e8e3d3", inkDim: "#8a8577", primary: "#a83232", accent: "#c9b98f" },
  nature: { surface: "#16211a", border: "#2f4a37", ink: "#e6efe0", inkDim: "#8fa892", primary: "#6fbf73", accent: "#e3c65a" },
  cyberpunk: { surface: "#0c0e17", border: "#2a2350", ink: "#eae6ff", inkDim: "#8a83c0", primary: "#ff2e97", accent: "#23e0e0" },
};

export function normalizeFamily(family) {
  return VALID_FAMILIES.has(family) ? family : "sci-fi";
}

/** Read the families.css tokens off a mounted element (with fallbacks). */
export function readFamilyTokens(el, family) {
  const fam = normalizeFamily(family);
  const tokens = { ...FALLBACK_TOKENS[fam] };
  if (el) {
    const cs = getComputedStyle(el);
    for (const [key, cssVar] of Object.entries(TOKEN_VARS)) {
      const raw = cs.getPropertyValue(cssVar).trim();
      if (raw) tokens[key] = raw;
    }
  }
  return tokens;
}
