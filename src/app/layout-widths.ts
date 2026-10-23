/** #319, ADR 0085. Initial large-window widths, in points, for the owner's trial.
 * These cap the existing surfaces, not the window or the font size. Smaller
 * windows use their available width. The reader's Margins are inside its cap. */
export const LAYOUT_WIDTH = {
  reader: 800,
  library: 800,
  settings: 680,
  player: 600,
} as const;
