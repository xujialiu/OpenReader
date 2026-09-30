import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { TEXT, TEXT_EMPHASIZED } from '../../src/app/text-styles';

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

  it('the navigation bars’ titles take theirs from the styles too', () => {
    expect(code('shell.tsx')).toContain('headerTitleStyle: { ...TEXT.headline,');
  });
});
