/**
 * The open Player's geometry (#325, after Speechify's floating card).
 *
 * It is a card that floats over the page: normally `CARD_MARGIN` in from the
 * usable sides, reducing that clearance only to recover a compact transport.
 * It is lifted by `playerBottomGap`, clear of the phone's home bar. Two rows
 * when the controls fit: the head (A or M and the Tap Lock at the left, the
 * Voice name, the Sleep Timer and the collapse arrow at the right) and the
 * transport (Contents, the four skips and
 * Play, the speed).
 *
 * The two ends of the compact transport stay equal so Play stays centred.
 * Once they no longer fit, Contents and speed get a row of their own. The
 * Voice moves independently, only when the head cannot keep its scaled slot.
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

/** The seven transport targets and their six minimum 3-point separations. */
function compactTransportWidth(endWidth: number): number {
  return 2 * endWidth + 4 * 44 + 52 + 6 * 3;
}

export function playerLayout(width: number, fontScale: number, borderWidth = 0) {
  const scale = Math.max(1, fontScale);
  const endWidth = Math.ceil(52 * scale);
  const rateHeight = Math.max(44, Math.ceil(24 * scale + 12));
  const headEnd = Math.max(44, Math.ceil(27 * scale + 8));
  // A or M's 26-point block with 3 points above and below; the Voice name's
  // line fits inside it at the default size.
  const headHeight = Math.max(32, Math.ceil(26 * scale + 6));
  // The Tap Lock and the Sleep Timer, one width so the Voice name between
  // them stays centred: the countdown, `60:00` at the speed's size, which is
  // never drawn larger than one and a half times, keeping the head's labelled
  // ends bounded even at the largest accessibility sizes.
  const sideWidth = Math.max(48, Math.ceil(42 * Math.min(scale, SIDE_TEXT_SCALE) + 6));
  // Border and padding both reduce Yoga's content width. At the default text
  // size the seven targets plus six 3-point gaps need 350 actual content points.
  const inside = width - 2 * (CARD_PADDING + borderWidth);
  const splitTransport = inside < compactTransportWidth(endWidth);
  // The Voice keeps at least one scaled labelled-target width between equal
  // sides. Its words can wrap; transport crowding alone must not move it.
  const splitVoice = inside < 2 * (headEnd + sideWidth) + 2 * 4 + endWidth;
  return { endWidth, rateHeight, headEnd, headHeight, sideWidth, splitTransport, splitVoice };
}

/** The most the countdown and the head row's sides grow with the text size. */
export const SIDE_TEXT_SCALE = 1.5;

/** The card remains floating even when decorative clearance yields to controls. */
const MIN_CARD_MARGIN = 6;

/**
 * Start with the existing 12-point clearance inside the usable safe width.
 * Give back only what recovers the compact transport, never below 6 points
 * per side or beyond the cap. Widening a card that must split buys no row.
 */
export function cardWidth(usableWidth: number, cap: number, fontScale = 1, borderWidth = 0): number {
  const normal = Math.min(usableWidth - 2 * CARD_MARGIN, cap);
  const needed = Math.ceil(compactTransportWidth(Math.ceil(52 * Math.max(1, fontScale))) + 2 * (CARD_PADDING + borderWidth));
  if (normal >= needed || needed > Math.min(usableWidth - 2 * MIN_CARD_MARGIN, cap)) return normal;
  return needed;
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
