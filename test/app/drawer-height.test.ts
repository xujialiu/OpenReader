import { describe, expect, it } from 'vitest';

import { drawerDetentHeight, SHEET_FLOATING_INSET } from '../../src/app/drawer-height';

/**
 * The Drawer Height is a share of the whole screen, from its bottom edge
 * (#117). These are the numbers measured on an iOS 27.0 iPhone 17 simulator,
 * 402 × 874 with a 34-pt bottom safe area (notes, 2026-10-01): each value
 * below put the drawer's top edge at that share of 874, to the pixel.
 */
const IPHONE_17 = { width: 402, height: 874, bottomInset: 34 };

/** Where the floating card's top edge comes out for a detent value: the card is the scaled sheet, 8 from the bottom. */
function topEdge(value: number, screen = IPHONE_17): number {
  const scale = (screen.width - 2 * SHEET_FLOATING_INSET) / screen.width;
  return screen.height - SHEET_FLOATING_INSET - scale * (value + screen.bottomInset);
}

describe('the Drawer Height as a sheet detent (#117)', () => {
  it('floats 8 pt in from the screen, as iOS 27 draws a sheet below large', () => {
    expect(SHEET_FLOATING_INSET).toBe(8);
  });

  it('puts the top edge at 437.0 on a 402 × 874 phone at half', () => {
    expect(drawerDetentHeight(50, IPHONE_17)).toBeCloseTo(412.78, 2);
    expect(topEdge(drawerDetentHeight(50, IPHONE_17))).toBeCloseTo(437, 9);
  });

  it('puts the top edge at the chosen share of the screen for every Drawer Height', () => {
    for (const percent of [40, 50, 60, 70, 80, 90]) {
      expect(topEdge(drawerDetentHeight(percent, IPHONE_17))).toBeCloseTo(874 * (1 - percent / 100), 9);
    }
  });

  it('asks for the values that were measured at 40 and 90 %', () => {
    // Top edges measured 524.67 and 87.33 against 524.4 and 87.4: within one 1/3-pt pixel.
    expect(drawerDetentHeight(40, IPHONE_17)).toBeCloseTo(321.76, 2);
    expect(drawerDetentHeight(90, IPHONE_17)).toBeCloseTo(776.87, 2);
  });

  it('follows the screen it is given, not the one it was measured on', () => {
    const air = { width: 420, height: 912, bottomInset: 34 };
    expect(topEdge(drawerDetentHeight(50, air), air)).toBeCloseTo(456, 9);
    expect(drawerDetentHeight(60, air)).toBeGreaterThan(drawerDetentHeight(50, air));
  });
});
