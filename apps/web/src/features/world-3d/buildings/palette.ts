/**
 * E6-02 — restrained District 01 palette (docs/3D_RENDERING.md §3.1).
 * Accent colours are never the only signal; they only reinforce shapes and
 * HTML labels. No emission here represents a chain-confirmed milestone.
 */
export const PALETTE = {
  ground: '#1a1b18',
  graphite: '#4a4b44',
  steel: '#8a8b80',
  dark: '#2a2b26',
  shadow: '#0b0c0a',
  teal: '#51b8a7',
  gold: '#f1c96d',
  brass: '#a88c54',
} as const;

/** Procedural building finishes while a landmark GLB is loading or unavailable. */
export const LANDMARK = {
  plinth: '#202329',
  graphite: '#42454a',
  charcoal: '#2d3035',
  steel: '#747474',
  brass: '#c09a54',
  gold: '#fcd535',
  ice: '#96e1f3',
} as const;
