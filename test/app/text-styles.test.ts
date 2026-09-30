import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { TEXT, TEXT_EMPHASIZED } from '../../src/app/text-styles';

/**
 * The app's text sizes are written in one place (#99): `text-styles.ts`, the
 * phone's own text styles. The drawers and the Library refer to them by name.
 */

const code = (file: string) => readFileSync(join(__dirname, '../../src/app', file), 'utf8');

/** A size, line height or weight written as a number rather than taken from a style. */
const WRITTEN = /\b(fontSize|lineHeight)\s*:\s*\d|\bfontWeight\s*:\s*['"]?\d/g;

/** The files wholly on the phone's styles. */
const ON_STYLES = [
  'sheet.tsx', 'reader-actions.tsx', 'appearance-sheet.tsx', 'download-sheet.tsx', 'contents-sheet.tsx',
  'voice-sheet.tsx', 'lookup-drawer.tsx', 'library-screen.tsx', 'name-text.tsx',
];

describe('the phone’s text styles (#99)', () => {
  it('are Apple’s Dynamic Type sizes at the default size', () => {
    expect(TEXT.headline).toEqual({ fontSize: 17, lineHeight: 22, fontWeight: '600' });
    expect(TEXT.body).toEqual({ fontSize: 17, lineHeight: 22, fontWeight: '400' });
    expect(TEXT.subhead).toEqual({ fontSize: 15, lineHeight: 20, fontWeight: '400' });
    expect(TEXT.footnote).toEqual({ fontSize: 13, lineHeight: 18, fontWeight: '400' });
    expect(TEXT_EMPHASIZED.body.fontWeight).toBe('600');
    expect(TEXT_EMPHASIZED.title2).toEqual({ fontSize: 22, lineHeight: 28, fontWeight: '700' });
  });

  it.each(ON_STYLES)('%s writes no size, line height or weight of its own', (file) => {
    expect(code(file).match(WRITTEN) ?? []).toEqual([]);
  });

  it('the Library row and the note take theirs from the styles too', () => {
    const controls = code('controls.tsx');
    for (const style of ['note: { ...TEXT.footnote', 'documentTitle: { ...TEXT.headline', 'rowProgress: { ...TEXT.footnote']) {
      expect(controls).toContain(style);
    }
  });
});
