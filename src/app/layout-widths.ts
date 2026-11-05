/** #319/#344, ADR 0085. Controls and lists stay comfortably narrow; smaller
 * windows use their available width. The reading viewport itself is uncapped. */
export const LAYOUT_WIDTH = {
  library: 800,
  settings: 680,
  player: 600,
} as const;
