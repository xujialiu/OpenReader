/**
 * The open Player's geometry (#325, after Speechify's floating card).
 *
 * It is a card that floats over the page: `CARD_MARGIN` in from the sides of
 * the window, and lifted off the bottom by `playerBottomGap`, so nothing of it
 * lies over the phone's home bar. Two rows at the default text size: the head
 * (A or M and the Tap Lock at the left, the Voice name, the Sleep Timer and the
 * collapse arrow at the right) and the transport (Contents, the four skips and
 * Play, the speed).
 *
 * The two ends of the compact transport stay equal so Play stays centred.
 * Once they no longer fit, Contents and speed get a row of their own, and the
 * Voice name too.
 *
 * `headEnd` and `rateHeight` are touch areas, at least the phone's 44 points.
 * `headHeight` is what the head row is drawn as: shorter, so the rows sit 46
 * points apart around the 52-point Play, with the head row's touch areas
 * reaching past it.
 */
export const CARD_MARGIN = 12;
export const CARD_PADDING = 8;
/** The card's corners: the bottom ones follow the screen's own curve more closely than the top ones need to. */
export const CARD_RADIUS_TOP = 24;
export const CARD_RADIUS_BOTTOM = 36;

export function playerLayout(width: number, fontScale: number) {
  const scale = Math.max(1, fontScale);
  const endWidth = Math.ceil(52 * scale);
  const rateHeight = Math.max(44, Math.ceil(24 * scale + 12));
  const headEnd = Math.max(44, Math.ceil(27 * scale + 8));
  // A or M's 26-point block with 3 points above and below; the Voice name's
  // line fits inside it at the default size.
  const headHeight = Math.max(32, Math.ceil(26 * scale + 6));
  // The Tap Lock and the Sleep Timer, one width so the Voice name between
  // them stays centred: the countdown, `60:00` at the speed's size, which is
  // never drawn larger than one and a half times, so that both ends of the
  // head row fit beside each other at every text size.
  const sideWidth = Math.max(48, Math.ceil(42 * Math.min(scale, SIDE_TEXT_SCALE) + 6));
  // Five transport buttons: 4 × 44 plus 52, and six gaps of at least 3 points,
  // inside the card's padding. 52-point ends, not 58: a 390-point phone (iPhone
  // 12 to 14, 16e) has 350 points inside the card, and 2 × 52 + 228 + 18 is 350.
  const split = width - 2 * CARD_PADDING < 2 * endWidth + 4 * 44 + 52 + 6 * 3;
  return { endWidth, rateHeight, headEnd, headHeight, sideWidth, split };
}

/** The most the countdown and the head row's sides grow with the text size. */
export const SIDE_TEXT_SCALE = 1.5;

/** How wide the card is in a window this wide: its margins off, and never wider than `cap`. */
export function cardWidth(windowWidth: number, cap: number): number {
  return Math.min(windowWidth - 2 * CARD_MARGIN, cap);
}

/**
 * How far the card's bottom edge stands above the bottom of the window: clear
 * of the home bar where there is one (a bottom safe-area inset), and the side
 * margin where there is none, as on an iPhone SE or a Mac.
 */
export const HOME_BAR_CLEARANCE = 20;
export function playerBottomGap(bottomInset: number): number {
  return bottomInset > 0 ? HOME_BAR_CLEARANCE : CARD_MARGIN;
}
