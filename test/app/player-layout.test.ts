import { expect, it } from 'vitest';
import { CARD_MARGIN, CARD_PADDING, cardWidth, playerBottomGap, playerLayout } from '../../src/app/player-layout';

/** Usable safe width, not the full window behind a system side reservation. */
const card = (width: number, scale = 1, border = 0.5) => cardWidth(width, 600, scale, border);
const layout = (width: number, scale = 1, border = 0.5) => playerLayout(card(width, scale, border), scale, border);

it('keeps the existing card when its transport already fits', () => {
  expect(card(402)).toBe(378);
  expect(layout(402)).toMatchObject({ splitTransport: false, splitVoice: false, endWidth: 52, rateHeight: 44 });
  expect(card(393)).toBe(369);
  expect(card(900)).toBe(600);
});

it('gives back only the clearance needed to recover two rows beside system controls (#348)', () => {
  // The recorded Duo outer usable width is 382. Its seven controls need350,
  // padding16 and doubled half-point borders1: a367-point card, not358.
  expect(card(382)).toBe(367);
  expect(layout(382)).toMatchObject({ splitTransport: false, splitVoice: false });
  // The 390-point phone stays compact too, now accounting for its border.
  expect(card(390)).toBe(367);
  expect(layout(390).splitTransport).toBe(false);
});

it('does not spend clearance when widening cannot recover a compact transport', () => {
  expect(card(375)).toBe(351);
  expect(layout(375)).toMatchObject({ splitTransport: true, splitVoice: false });
  expect(card(382, 1.118)).toBe(358);
  expect(layout(382, 1.118)).toMatchObject({ splitTransport: true, splitVoice: false });
  expect(cardWidth(900, 365, 1, 0.5)).toBe(365);
  expect(playerLayout(365, 1, 0.5).splitTransport).toBe(true);
});

it('keeps six points of safe-side clearance at the exact compact boundary', () => {
  expect(card(379)).toBe(367);
  expect(layout(379).splitTransport).toBe(false);
  expect(card(378.99)).toBeCloseTo(354.99);
  expect(layout(378.99).splitTransport).toBe(true);
});

it('moves the Voice independently of the crowded transport', () => {
  expect(layout(375)).toMatchObject({ splitTransport: true, splitVoice: false });
  expect(layout(382, 3.571)).toMatchObject({ splitTransport: true, splitVoice: true });
  // Room inside the capped large-screen head is real; the transport still splits.
  expect(layout(867, 3.571)).toMatchObject({ splitTransport: true, splitVoice: false });
});

it('preserves touch targets, actual content spacing and the cap across widths, borders and text sizes', () => {
  for (const scale of [0.823, 0.882, 0.941, 1, 1.118, 1.235, 1.353, 1.786, 2.143, 2.643, 3.143, 3.571]) {
    for (const usable of [320, 375, 378, 379, 382, 390, 393, 402, 440, 768, 1200]) {
      for (const border of [0, 1 / 3, 0.5, 1]) {
        const width = card(usable, scale, border);
        const current = playerLayout(width, scale, border);
        const inside = width - 2 * (CARD_PADDING + border);
        expect(width).toBeGreaterThanOrEqual(Math.min(usable - 24, 600));
        expect(width).toBeLessThanOrEqual(Math.min(usable - 12, 600));
        expect(current.endWidth).toBeGreaterThanOrEqual(52 * Math.max(1, scale));
        expect(current.rateHeight).toBeGreaterThanOrEqual(24 * Math.max(1, scale) + 12);
        expect(current.headEnd).toBeGreaterThanOrEqual(44);
        if (!current.splitTransport) expect(inside - 2 * current.endWidth - 228).toBeGreaterThanOrEqual(18);
        if (!current.splitVoice) expect(inside - 2 * (current.headEnd + current.sideWidth) - 8).toBeGreaterThanOrEqual(current.endWidth);
        if (width > Math.min(usable - 24, 600)) {
          expect(current.splitTransport).toBe(false);
          expect(playerLayout(width - 1, scale, border).splitTransport).toBe(true);
        }
      }
    }
  }
});

it('draws the head row 32 points tall while keeping its 44-point touch areas (#325)', () => {
  const current = layout(402);
  expect(current).toMatchObject({ headHeight: 32, headEnd: 44, sideWidth: 48 });
  expect(current.headHeight / 2 + 4 + 52 / 2).toBe(46);
});

it('lifts the card clear of the home bar where present, otherwise by its usual side margin', () => {
  expect(playerBottomGap(34)).toBe(20);
  expect(playerBottomGap(20)).toBe(20);
  expect(playerBottomGap(0)).toBe(CARD_MARGIN);
  expect(6 + 32 + 4 + 52 + 8 + playerBottomGap(34)).toBe(122);
});

it('returns to the same compact layout after width and text-size changes', () => {
  const before = layout(382);
  layout(867, 3.571);
  layout(320);
  expect(layout(382)).toEqual(before);
  expect(layout(382, 0.823)).toEqual(before);
});
