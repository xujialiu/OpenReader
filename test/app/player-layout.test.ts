import { expect, it } from 'vitest';
import { playerLayout } from '../../src/app/player-layout';
it('keeps the compact transport at default size on a 402-point phone', () => {
  expect(playerLayout(402, 1)).toMatchObject({ split: false, endWidth: 58, rateHeight: 44 });
});
it('grows both labelled controls and moves crowded ends to their own row', () => {
  for (const scale of [0.823, 0.882, 0.941, 1, 1.118, 1.235, 1.353, 1.786, 2.143, 2.643, 3.143, 3.571]) {
    for (const width of [320, 375, 402, 440, 768]) {
      const layout = playerLayout(width, scale);
      expect(layout.endWidth).toBeGreaterThanOrEqual(58 * Math.max(1, scale));
      expect(layout.rateHeight).toBeGreaterThanOrEqual(24 * Math.max(1, scale) + 12);
      if (!layout.split) expect(2 * layout.endWidth + 228 + 24).toBeLessThanOrEqual(width - 24);
    }
  }
  expect(playerLayout(402, 3.571).split).toBe(true);
});
it('shrinks back without a remembered large layout', () => {
  const before = playerLayout(402, 1);
  playerLayout(402, 3.571);
  expect(playerLayout(402, 1)).toEqual(before);
});
