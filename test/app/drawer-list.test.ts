import { describe, expect, it } from 'vitest';

import { DRAWER_LIST, drawerRowText } from '../../src/app/drawer-list';

/**
 * A drawer's rows are Apple Books' contents rows (#117, Q46–Q48), measured
 * from the owner's 3× screenshots on a 402-pt iPhone: a row is its lines plus
 * `padding` above and below, and never less than 52 pt, separator included.
 */
function rowHeight(lines: number): number {
  return Math.max(DRAWER_LIST.rowHeight, lines * drawerRowText(false).lineHeight + 2 * DRAWER_LIST.padding);
}

describe("a drawer's list row, as Books draws its contents (#117)", () => {
  it('is 52 pt with one line', () => {
    expect(rowHeight(1)).toBe(52);
  });

  it('is 62 pt with two lines, as Cultivation Online\'s Chapter 1005 is', () => {
    expect(rowHeight(2)).toBeCloseTo(62, 1);
  });

  it("is 112 pt with five lines, as Shadow Slave's Chapter 139 is", () => {
    expect(rowHeight(5)).toBeCloseTo(112, 1);
  });

  it('sets its words at 15 pt on a line pitch a hundredth under 16.67, regular, and semibold when emphasized', () => {
    expect(drawerRowText(false)).toEqual({ fontSize: 15, fontWeight: '400', lineHeight: 16.66 });
    expect(drawerRowText(true).fontWeight).toBe('600');
  });

  it('insets the separators 25 pt at both ends, and the words a point less', () => {
    expect(DRAWER_LIST.inset).toBe(25);
    expect(DRAWER_LIST.textInset).toBe(24);
  });
});
