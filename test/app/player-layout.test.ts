import { expect, it } from 'vitest';
import { CARD_MARGIN, CARD_PADDING, cardWidth, playerBottomGap, playerLayout } from '../../src/app/player-layout';

/** The card's width on a phone this wide, as the Player computes it. */
const card = (phone: number) => cardWidth(phone, 600);

it('keeps the compact transport at default size on a 402-point phone, inside the card', () => {
  expect(card(402)).toBe(378);
  expect(playerLayout(card(402), 1)).toMatchObject({ split: false, endWidth: 52, rateHeight: 44 });
});
it('keeps the compact transport at default size on a 390-point phone, as on a 393-point one (#218, #325)', () => {
  // The iPhone 12, 13, 14 and 16e: 366 points of card and 350 inside its
  // padding. The seven controls take 2 × 52 + 4 × 44 + 52 = 332: six gaps of 3.
  expect(card(390) - 2 * CARD_PADDING).toBe(350);
  expect(playerLayout(card(390), 1)).toMatchObject({ split: false, endWidth: 52 });
  expect(playerLayout(card(393), 1).split).toBe(false);
  // The SE and the mini: 335 points inside the card, so the ends get their own row.
  expect(playerLayout(card(375), 1).split).toBe(true);
});
it('grows both labelled controls and moves crowded ends to their own row', () => {
  for (const scale of [0.823, 0.882, 0.941, 1, 1.118, 1.235, 1.353, 1.786, 2.143, 2.643, 3.143, 3.571]) {
    for (const phone of [320, 375, 390, 393, 402, 440, 768]) {
      const width = card(phone);
      const layout = playerLayout(width, scale);
      expect(layout.endWidth).toBeGreaterThanOrEqual(52 * Math.max(1, scale));
      expect(layout.rateHeight).toBeGreaterThanOrEqual(24 * Math.max(1, scale) + 12);
      // Compact only with six gaps of at least 3 points between the seven controls.
      if (!layout.split) expect(2 * layout.endWidth + 228 + 6 * 3).toBeLessThanOrEqual(width - 2 * CARD_PADDING);
    }
  }
  expect(playerLayout(card(402), 3.571).split).toBe(true);
});
it('fits both sides of the head row beside each other at every text size, on an iPhone SE too (#325)', () => {
  // A or M and the Tap Lock, the Sleep Timer and the collapse arrow, with the
  // row's three 4-point gaps. Split, the Voice name has a row of its own and
  // the Tap Lock is its 44-point icon; compact, both sides are one width.
  for (const scale of [1, 1.118, 1.353, 2.143, 3.143, 3.571]) {
    for (const phone of [375, 390, 402]) {
      const layout = playerLayout(card(phone), scale);
      const lock = layout.split ? 44 : layout.sideWidth;
      expect(2 * layout.headEnd + lock + layout.sideWidth + 3 * 4).toBeLessThanOrEqual(card(phone) - 2 * CARD_PADDING);
    }
  }
  // At the default size the name keeps 158 points between them on a 390-point
  // phone: the head row's two gaps of 4 either side of it.
  const plain = playerLayout(card(390), 1);
  expect(card(390) - 2 * CARD_PADDING - 2 * (plain.headEnd + plain.sideWidth) - 2 * 4).toBe(158);
});
it('draws the head row 32 points tall, so rows are 46 points apart around the 52-point Play (#325)', () => {
  const layout = playerLayout(card(402), 1);
  expect(layout).toMatchObject({ headHeight: 32, headEnd: 44, sideWidth: 48 });
  expect(layout.headHeight / 2 + 4 + 52 / 2).toBe(46);
});
it('lifts the card clear of the home bar where there is one, and by its side margin where there is not (#325)', () => {
  expect(playerBottomGap(34)).toBe(20);
  expect(playerBottomGap(20)).toBe(20);
  expect(playerBottomGap(0)).toBe(CARD_MARGIN);
  // The page an iPhone 16 Pro's open card takes at the default size: 6 + 32 + 4 + 52 + 8 of card, 20 under it.
  expect(6 + 32 + 4 + 52 + 8 + playerBottomGap(34)).toBe(122);
});
it('shrinks back without a remembered large layout', () => {
  const before = playerLayout(card(402), 1);
  playerLayout(card(402), 3.571);
  expect(playerLayout(card(402), 1)).toEqual(before);
});
