/**
 * Where a drawer opens: the **Drawer Height** (CONTEXT.md) turned into the
 * height the phone's own sheet is asked for (#117, ADR 0066).
 *
 * Here and not in `drawer.tsx` so that a test can reach it: it imports no
 * platform, and the arithmetic is the part that was measured and fixed.
 *
 * The owner's setting is a share of the **whole screen's** height measured
 * from its bottom edge: at 50 % on a 402 × 874 phone the drawer's top edge is
 * at 437.0. SwiftUI's `.height` detent is not that, in three ways, all
 * measured on an iOS 27.0 iPhone 17 simulator (notes, 2026-10-01):
 *
 * - **It floats.** Below `large`, iOS 27 draws the sheet as a card inset
 *   `SHEET_FLOATING_INSET` from the screen's sides and bottom, as it draws
 *   `medium` (notes, 11:35).
 * - **It is scaled.** The floating card is the edge-attached sheet shrunk to
 *   the card's width, everything in it by `(width − 2 × 8) / width`, 0.960 on
 *   a 402-pt phone.
 * - **It is asked for within the safe area.** Apple's header says the value
 *   is "a height within the safe area of the sheet … 200 + safeAreaInsets.bottom
 *   when edge-attached, and just 200 when floating"
 *   (`UISheetPresentationController.h`, notes 11:19). Measured, the floating
 *   card is the scaled `value + safeAreaInsets.bottom` all the same: asking
 *   for 403 drew a card 420 pt tall.
 *
 * So the card's top edge is at `height − 8 − scale × (value + bottomInset)`,
 * and the value is that solved for the top edge the owner asked for.
 */

/** How far a floating sheet is inset from the screen's sides and bottom: measured 8.0 pt (notes, 2026-10-01 11:35). */
export const SHEET_FLOATING_INSET = 8;

/** The screen the drawer rises over, in points: `useWindowDimensions()` and `useSafeAreaInsets().bottom`. */
export interface DrawerScreen {
  width: number;
  height: number;
  bottomInset: number;
}

/**
 * The `{ height }` to hand `presentationDetents` for a Drawer Height of
 * `percent`, so that the drawer's top edge sits at `percent` of the screen's
 * height from its bottom edge.
 */
export function drawerDetentHeight(percent: number, screen: DrawerScreen): number {
  const scale = (screen.width - 2 * SHEET_FLOATING_INSET) / screen.width;
  const visible = (screen.height * percent) / 100 - SHEET_FLOATING_INSET;
  return visible / scale - screen.bottomInset;
}
