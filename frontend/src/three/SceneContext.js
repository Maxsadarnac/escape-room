import { createContext } from "react";

/**
 * Scene-wide settings the prop archetypes need without prop-drilling:
 * - reducedMotion: prefers-reduced-motion — disables idle animations
 * - paletteHints: validated hex colors from room JSON scene.palette, used
 *   only for incidental variety (book spines etc.), never for lighting
 */
export const SceneContext = createContext({
  reducedMotion: false,
  paletteHints: [],
});
