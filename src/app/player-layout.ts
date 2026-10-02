/** The two ends of the compact transport stay equal so Play stays centred.
 * Once they no longer fit, Contents and speed get a row of their own. */
export function playerLayout(width: number, fontScale: number) {
  const scale = Math.max(1, fontScale);
  const endWidth = Math.ceil(58 * scale);
  const rateHeight = Math.max(44, Math.ceil(24 * scale + 12));
  const headEnd = Math.max(44, Math.ceil(27 * scale + 8));
  // Five transport buttons: 4 × 44 plus 52, and six minimum 4-point gaps.
  const split = width - 24 < 2 * endWidth + 4 * 44 + 52 + 6 * 4;
  return { endWidth, rateHeight, headEnd, split };
}
