import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ACCENT_SURFACES, accentOn, contrast, MARK_SURFACES, readingAccent, type AccentScheme } from '../../src/app/accent';
import { channels, HIGHLIGHT_PRESETS, type HighlightColours } from '../../src/renderer/highlight-colours';

/**
 * #118: the app's accent follows the word's Highlight Colour, its hue kept and
 * darkened (light) or lightened (dark) just enough for 4.5:1 on the surfaces it
 * is drawn on (owner's Q6 = B, Q8 = A). The player's A is the word's colour at
 * the word's opacity (Q5 = A).
 */

const SCHEMES: AccentScheme[] = ['light', 'dark'];

/** A word colour, the sentence left at Blue's. */
const wordIn = (color: string, opacity = 62): HighlightColours => ({ sentence: HIGHLIGHT_PRESETS.blue.sentence, word: { color, opacity } });

/** The hue, in degrees, of a colour that has one. */
function hue(color: string): number {
  const [r, g, b] = channels(color).map((value) => value / 255);
  const max = Math.max(r, g, b);
  const span = max - Math.min(r, g, b);
  const turn = max === r ? ((g - b) / span) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return (turn * 60 + 360) % 360;
}

describe('the reading accent (#118)', () => {
  it('darkens Blue on light surfaces and keeps its colour on dark ones', () => {
    expect(readingAccent(HIGHLIGHT_PRESETS.blue, 'light').reading).toBe('#5d66cb');
    expect(readingAccent(HIGHLIGHT_PRESETS.blue, 'dark').reading).toBe('#727efa');
  });

  it('darkens Amber on the light surfaces and keeps it on the dark ones', () => {
    expect(readingAccent(HIGHLIGHT_PRESETS.amber, 'light').reading).toBe('#976619');
    expect(readingAccent(HIGHLIGHT_PRESETS.amber, 'dark').reading).toBe('#d99324');
  });

  it('goes a step further on a drawer\'s marked row and round button', () => {
    expect(readingAccent(HIGHLIGHT_PRESETS.blue, 'light').onMark).toBe('#5159b1');
    expect(readingAccent(HIGHLIGHT_PRESETS.blue, 'dark').onMark).toBe('#9aa2fb');
    expect(readingAccent(HIGHLIGHT_PRESETS.amber, 'light').onMark).toBe('#835916');
    expect(readingAccent(HIGHLIGHT_PRESETS.amber, 'dark').onMark).toBe('#dd9d38');
  });

  const COLOURS = [
    HIGHLIGHT_PRESETS.blue.word.color, HIGHLIGHT_PRESETS.amber.word.color,
    '#ffffff', '#000000', '#ffff00', '#0a1a3a', '#ff0000', '#00ff00', '#808080', '#434665',
  ];

  it.each(COLOURS)('%s reads at 4.5:1 or more on every surface, in both themes', (color) => {
    for (const scheme of SCHEMES) {
      const accent = readingAccent(wordIn(color), scheme);
      for (const surface of ACCENT_SURFACES[scheme]) expect(contrast(accent.reading, surface)).toBeGreaterThanOrEqual(4.5);
      for (const surface of MARK_SURFACES[scheme]) expect(contrast(accent.onMark, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the word\'s hue, darkening on light and lightening on dark', () => {
    for (const color of ['#4456de', '#ffa800', '#ffff00', '#0a1a3a', '#ff0000']) {
      const light = accentOn(color, 'light', ACCENT_SURFACES.light);
      const dark = accentOn(color, 'dark', ACCENT_SURFACES.dark);
      expect(Math.abs(hue(light) - hue(color))).toBeLessThan(3);
      expect(Math.abs(hue(dark) - hue(color))).toBeLessThan(3);
      expect(channels(light).every((value, at) => value <= channels(color)[at])).toBe(true);
      expect(channels(dark).every((value, at) => value >= channels(color)[at])).toBe(true);
    }
  });

  it('goes only as far as it has to: one step less would not read', () => {
    // A fixed colour that needs lightening, independent of preset revisions.
    const blue = channels(readingAccent(wordIn('#5c73e6'), 'dark').reading);
    const lessBlue = '#' + blue.map((value) => (value - 1).toString(16).padStart(2, '0')).join('');
    expect(Math.min(...ACCENT_SURFACES.dark.map((surface) => contrast(lessBlue, surface)))).toBeLessThan(4.5);
  });

  it('takes no part of the word\'s opacity, which is the page\'s', () => {
    for (const scheme of SCHEMES) {
      expect(readingAccent(wordIn('#4456de', 0), scheme).reading).toBe(readingAccent(wordIn('#4456de', 100), scheme).reading);
    }
  });

  it('washes the player\'s A in the word\'s colour at the word\'s opacity, the same in both themes', () => {
    for (const scheme of SCHEMES) {
      expect(readingAccent(HIGHLIGHT_PRESETS.blue, scheme).following).toBe('rgba(114, 126, 250, 0.47)');
      expect(readingAccent(HIGHLIGHT_PRESETS.amber, scheme).following).toBe('rgba(217, 147, 36, 0.38)');
      expect(readingAccent(wordIn('#4456de', 0), scheme).following).toBe('rgba(68, 86, 222, 0)');
    }
  });

  it('is held to the surfaces the app actually draws (controls.tsx\'s PALETTE, drawer.tsx\'s DRAWER)', () => {
    const app = join(__dirname, '../../src/app');
    const controls = readFileSync(join(app, 'controls.tsx'), 'utf8');
    const drawer = readFileSync(join(app, 'drawer.tsx'), 'utf8');
    for (const pair of ["page: '#ffffff'", "panel: '#f4f4f6'", "line: '#dcdce2'", "page: '#111114'", "panel: '#1c1c21'"]) {
      expect(controls).toContain(pair);
    }
    for (const pair of ["mark: '#3e3e47'", "button: '#2c2c32'", 'mark: PALETTE.light.line', 'button: SETTINGS_SURFACE.light.card']) {
      expect(drawer).toContain(pair);
    }
  });
});
