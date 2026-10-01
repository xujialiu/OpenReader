/**
 * The plain list every drawer's rows are drawn in (#117, the owner's Q46–Q48):
 * rows straight on the drawer, as the phone's Books draws its contents, with
 * no card around them.
 *
 * Here and not in `drawer.tsx` so that a test can reach it, as
 * `drawer-height.ts` is; `DRAWER.row` is this. Measured from the owner's 3×
 * screenshots of Books' contents on a 402-pt iPhone (2026-10-01), pixels ÷ 3:
 *
 * - The words' ink starts 24.7 pt from the screen's edge; the separators run
 *   from 25.0 to 377.0, so they are inset 25 on both sides. Every row has one,
 *   the last included.
 * - A one-line row is 52.0 pt from separator to separator.
 * - A title wraps in full. Shadow Slave's Chapter 139 takes 5 lines 16.67 pt
 *   apart in a 112-pt row, and a 2-line title takes 62: so a row is its lines
 *   plus 14.33 above and below, and never less than 52.
 * - The words are semibold and a little under 15 pt: "Chapter 137: All Eyes
 *   on Me" is 567 px wide and 39 px from ascender to descender, where the
 *   app's 15-pt semibold draws it 589 and 42. Subhead, the phone's own 15-pt
 *   style, is the nearest; the line pitch is Books'. The weight is the app's
 *   own (Q48): regular, and the chapter being read semibold in the reading
 *   amber.
 */

import { onLinePitch, TEXT, TEXT_EMPHASIZED, type TextStyleName } from './text-styles';

export const DRAWER_LIST = {
  /** From the screen's edges to both ends of a row's separator, and to the right end of its words. */
  inset: 25,
  /**
   * From the screen's left edge to a row's words: a point less than the
   * separator, because a letter's ink starts a point inside its frame. Measured
   * on the simulator, a 'C' here is inked from 25.0, where Books' is from 24.7.
   */
  textInset: 24,
  /** A row of one line, separator included. */
  rowHeight: 52,
  /** Above a row's first line and below its last: (112 − 5 × 16.67) / 2. */
  padding: 43 / 3,
  /** The words' size: Subhead, 15 pt, as Books has it. `'body'` would make them 17. */
  text: 'subhead' as TextStyleName,
  /** The line pitch, as a share of the size: Books' 16.67 for 15. */
  leading: 10 / 9,
  /** How much further in each level of a nested list starts. */
  indent: 16,
  /** The line under a row: 1 pt, as the phone's measured 3 px. */
  separator: 1,
  /** A row's icon before its words (a Document's actions menu), drawn at the size the old menu drew it less two, to sit in a 52-pt row. */
  icon: 24,
  /** Between a row's icon, its words and what stands at its right. */
  gap: 16,
} as const;

/** The words of a drawer's row: its size, its weight, and its line pitch. Emphasized is the chapter being read, and a heading. */
export function drawerRowText(emphasized: boolean): ReturnType<typeof onLinePitch> {
  return onLinePitch((emphasized ? TEXT_EMPHASIZED : TEXT)[DRAWER_LIST.text], DRAWER_LIST.leading);
}
