import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { barTitle, TEXT, TEXT_EMPHASIZED } from '../../src/app/text-styles';

/**
 * The app's text sizes and weights are written in one place (#99):
 * `text-styles.ts`, the phone's own text styles. Everything else refers to a
 * style by name. The page's own text is Appearance's, and is set in the page.
 */

const APP = join(__dirname, '../../src/app');
const code = (file: string) => readFileSync(join(APP, file), 'utf8');

/**
 * A size, a line height, or a weight not taken from a style. A weight may be
 * taken on its own (`fontWeight: TEXT_EMPHASIZED.body.fontWeight`), for text
 * that changes weight and nothing else when it is chosen.
 */
const WRITTEN = /\b(fontSize|lineHeight)\s*:|\bfontWeight\s*:(?!\s*TEXT(_EMPHASIZED)?\.)/g;

const FILES = readdirSync(APP).filter((file) => /\.tsx?$/.test(file) && file !== 'text-styles.ts');

describe('the phone’s text styles (#99)', () => {
  it('are Apple’s Dynamic Type sizes and weights at the default size', () => {
    expect(TEXT.headline).toEqual({ fontSize: 17, fontWeight: '600' });
    expect(TEXT.body).toEqual({ fontSize: 17, fontWeight: '400' });
    expect(TEXT.subhead).toEqual({ fontSize: 15, fontWeight: '400' });
    expect(TEXT.footnote).toEqual({ fontSize: 13, fontWeight: '400' });
    expect(TEXT.caption1).toEqual({ fontSize: 12, fontWeight: '400' });
    expect(TEXT_EMPHASIZED.body.fontWeight).toBe('600');
    expect(TEXT_EMPHASIZED.title2).toEqual({ fontSize: 22, fontWeight: '700' });
  });

  it('leave the line height to the font, as the phone does', () => {
    // The phone's own Settings sets a 13-point footer on a 16-point line
    // (notes, 2026-09-23 17:18), where the HIG's table says 18.
    for (const style of [...Object.values(TEXT), ...Object.values(TEXT_EMPHASIZED)]) {
      expect(style).not.toHaveProperty('lineHeight');
    }
  });

  it.each(FILES)('%s writes no size, line height or weight of its own', (file) => {
    expect(code(file).match(WRITTEN) ?? []).toEqual([]);
  });

  it('a title above a page grows with the text size as the phone’s own does, from 17 to 21 (#100)', () => {
    // React Native's multipliers (RCTAccessibilityManager.mm), and the phone's
    // own About title at each size (notes, 2026-09-30 12:05).
    const at = (fontScale: number) => barTitle(fontScale).fontSize ?? 0;
    expect(barTitle(1)).toEqual({ fontSize: 17, fontWeight: '600' });
    for (const smaller of [0.823, 0.882, 0.941]) expect(at(smaller)).toBe(17);
    // Whole points: react-native-screens drops the fraction (20.995 drew at 20).
    expect(at(1.118)).toBe(19);
    expect(at(1.235)).toBe(21);
    for (const larger of [1.353, 1.786, 2.143, 2.643, 3.143, 3.571]) expect(at(larger)).toBe(21);
  });

  it('the navigation bars’ titles and the reader’s title take that size', () => {
    expect(code('shell.tsx')).toContain('headerTitleStyle: { ...barTitle(fontScale),');
    expect(code('reader-title.tsx')).toContain('barTitle(fontScale)');
  });
});
