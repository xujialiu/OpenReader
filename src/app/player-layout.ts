/** The two ends of the compact transport stay equal so Play stays centred.
 * Once they no longer fit, Contents and speed get a row of their own.
 *
 * `headEnd` and `rateHeight` are touch areas, at least the phone's 44 points.
 * `headHeight` and `footHeight` are what the head row and the bottom row are
 * drawn as (#325): shorter, so the rows sit 46 points apart rather than 54,
 * with each control's touch area reaching past its row by `hitSlop`. */
export function playerLayout(width: number, fontScale: number) {
  const scale = Math.max(1, fontScale);
  const endWidth = Math.ceil(58 * scale);
  const rateHeight = Math.max(44, Math.ceil(24 * scale + 12));
  const headEnd = Math.max(44, Math.ceil(27 * scale + 8));
  // A or M's 26-point block with 3 points above and below; the voice name's
  // line fits inside it at the default size and grows the row beyond it.
  const headHeight = Math.max(32, Math.ceil(26 * scale + 6));
  // A 24-point icon, or the countdown at the speed's size, with 4 points either side.
  const footHeight = Math.max(32, Math.ceil(24 * scale + 8));
  // Five transport buttons: 4 × 44 plus 52, and six gaps of at least 3 points.
  // Three, not four: a 390-point phone (iPhone 12 to 14, 16e) has gaps of 3.67
  // at the default size, and four put its ends on rows of their own (#218).
  const split = width - 24 < 2 * endWidth + 4 * 44 + 52 + 6 * 3;
  return { endWidth, rateHeight, headEnd, headHeight, footHeight, split };
}

/**
 * The open Player's padding under its bottom row (#325): enough that the row's
 * centre sits on the device's own bottom safe-area line, where the home
 * indicator's area begins, and never less than 28 points above the bottom of
 * the screen. 34 points on an iPhone with a home indicator, 28 on an iPhone SE,
 * an iPad or a Mac. Apple's own corner buttons keep above that line too: on an
 * iPhone 16 Pro, Safari's Back and Tabs end exactly 34 points above the bottom.
 */
export const BOTTOM_ROW_LOWEST = 28;
export function playerBottomPadding(bottomInset: number, footHeight: number): number {
  return Math.max(4, Math.max(bottomInset, BOTTOM_ROW_LOWEST) - footHeight / 2);
}
