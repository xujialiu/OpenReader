import { expect, it } from 'vitest';
import { playerBottomPadding, playerLayout } from '../../src/app/player-layout';
it('keeps the compact transport at default size on a 402-point phone', () => {
  expect(playerLayout(402, 1)).toMatchObject({ split: false, endWidth: 58, rateHeight: 44 });
});
it('keeps the compact transport at default size on a 390-point phone, as on a 393-point one (#218)', () => {
  // The iPhone 12, 13, 14 and 16e. The seven controls take 2 × 58 + 4 × 44 + 52
  // = 344 of the 366 points inside the padding: six gaps of 3.67.
  expect(playerLayout(390, 1)).toMatchObject({ split: false, endWidth: 58 });
  expect(playerLayout(393, 1).split).toBe(false);
  // The SE and the mini: 351 points, gaps of 1.17, so the ends get their own row.
  expect(playerLayout(375, 1).split).toBe(true);
});
it('grows both labelled controls and moves crowded ends to their own row', () => {
  for (const scale of [0.823, 0.882, 0.941, 1, 1.118, 1.235, 1.353, 1.786, 2.143, 2.643, 3.143, 3.571]) {
    for (const width of [320, 375, 390, 393, 402, 440, 768]) {
      const layout = playerLayout(width, scale);
      expect(layout.endWidth).toBeGreaterThanOrEqual(58 * Math.max(1, scale));
      expect(layout.rateHeight).toBeGreaterThanOrEqual(24 * Math.max(1, scale) + 12);
      // Compact only with six gaps of at least 3 points between the seven controls.
      if (!layout.split) expect(2 * layout.endWidth + 228 + 6 * 3).toBeLessThanOrEqual(width - 24);
    }
  }
  expect(playerLayout(402, 3.571).split).toBe(true);
});
it('shrinks back without a remembered large layout', () => {
  const before = playerLayout(402, 1);
  playerLayout(402, 3.571);
  expect(playerLayout(402, 1)).toEqual(before);
});

it('draws the head and bottom rows 32 points tall, so rows are 46 points apart around the 52-point Play (#325)', () => {
  const layout = playerLayout(402, 1);
  expect(layout).toMatchObject({ headHeight: 32, footHeight: 32, headEnd: 44, rateHeight: 44 });
  // Centre to centre, with the 4-point gap between rows: 16 + 4 + 26.
  expect(layout.headHeight / 2 + 4 + 52 / 2).toBe(46);
  expect(52 / 2 + 4 + layout.footHeight / 2).toBe(46);
  // Grows with the text, never under the touch areas' reach of 6 a side at the default size.
  for (const scale of [1, 1.353, 2.143, 3.571]) {
    const big = playerLayout(402, scale);
    expect(big.headHeight).toBeGreaterThanOrEqual(26 * scale);
    expect(big.footHeight).toBeGreaterThanOrEqual(24 * scale);
    expect(big.headEnd).toBeGreaterThanOrEqual(big.headHeight);
    expect(big.rateHeight).toBeGreaterThanOrEqual(big.footHeight);
  }
});
it('puts the bottom row on the home indicator\'s safe line, and never under 28 points above the bottom (#325)', () => {
  // An iPhone with a home indicator: 34. The row's centre is its padding plus half its height.
  expect(playerBottomPadding(34, 32) + 16).toBe(34);
  // An iPhone SE, a Mac (no inset) and an iPad (20): 28.
  expect(playerBottomPadding(0, 32) + 16).toBe(28);
  expect(playerBottomPadding(20, 32) + 16).toBe(28);
  // A row grown with the text keeps at least 4 points under it.
  expect(playerBottomPadding(34, 80)).toBe(4);
  // The open Player at the default size on an iPhone 16 Pro: 4 + 32 + 4 + 52 + 4 + 32 + 18.
  expect(4 + 32 + 4 + 52 + 4 + 32 + playerBottomPadding(34, 32)).toBe(146);
});
