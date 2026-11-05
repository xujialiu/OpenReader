import { describe, expect, it } from 'vitest';
import { appearanceCss, DEFAULT_APPEARANCE, MARGINS, stepMargins } from '../../src/renderer/highlighter';

describe('percentage Margins (#344)', () => {
  it('offers every whole percentage from zero through 25, defaults to five and steps by one', () => {
    expect(MARGINS).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
    expect(DEFAULT_APPEARANCE.margins).toBe(5);
    expect(stepMargins(8, 1)).toBe(9);
    expect(stepMargins(8, -1)).toBe(7);
  });
  it('applies the chosen share to each side of the whole EPUB viewport, without flattening internal indents', () => {
    const css = appearanceCss({ ...DEFAULT_APPEARANCE, margins: 8 });
    expect(css).toContain('body { margin-left: 0 !important; margin-right: 0 !important; padding-left: 8% !important; padding-right: 8% !important; }');
    expect(css).not.toMatch(/max-width|p\s*\{[^}]*padding|blockquote\s*\{/);
  });
});
