import { describe, expect, it } from 'vitest';

import {
  appearanceCss,
  DOCUMENT_APPEARANCE,
  highlightCss,
  READING_FONTS,
  READING_SCALES,
  DEFAULT_HIGHLIGHT,
} from '../../src/renderer/highlighter';
import { pin } from '../structural';

/**
 * The stylesheet **Appearance** installs, which is the only thing the sheet
 * actually does (ADR 0019).
 *
 * It is pure and it runs under Node, which is the point of building the CSS on
 * this side of the bridge rather than in the WebView program: what a rule may say
 * is then decided somewhere a test can read it. The one property that matters
 * most cannot be checked any other way — a declaration of `user-select` anywhere
 * in a document silently stops `::highlight()` from painting, with no error and
 * nothing in the registry to look at (`highlighter.ts`, 2026-09-19), and this is
 * a stylesheet the owner's choices build.
 */
describe('Appearance as a stylesheet', () => {
  it('says nothing at all while the document’s own typography is being followed', () => {
    // The default for both, which is what the owner settled: a book that ships its
    // own typography keeps it until it is overridden. An empty string means the
    // <style> element carries the highlight rules and nothing else.
    expect(DOCUMENT_APPEARANCE).toEqual({ font: null, scale: null });
    expect(appearanceCss(DOCUMENT_APPEARANCE)).toBe('');
  });

  it('puts the size on the root and pins the body to it, rather than scaling twice', () => {
    // A percentage font-size resolves against the **parent's** computed size, so
    // `html { 150% }` with `body { 150% }` would be 225%. The body rule is there
    // to overrule a book that sets a size on <body>, not to scale again.
    const css = appearanceCss({ font: null, scale: 150 });
    expect(css).toContain('html { font-size: 150% !important; }');
    expect(css).toContain('body { font-size: 100% !important; }');
    expect(css).not.toContain('font-family');
  });

  it('changes the font on the descendants too, because a book sets one on its paragraphs', () => {
    // `font-family` inherits, so a rule on the two roots alone is beaten by the
    // owner's own novel, whose stylesheet says `div { font-family: "zw" }` — which
    // is where every line of its text is.
    const css = appearanceCss({ font: 'serif', scale: null });
    expect(css).toContain('html, body, body * { font-family: Georgia, "Times New Roman", serif !important; }');
    expect(css).not.toContain('font-size');
  });

  it('cannot declare user-select, whatever it is given', () => {
    // The rule that fails as nothing happening. Every combination the sheet can
    // produce, and then some it cannot.
    const every = [
      DOCUMENT_APPEARANCE,
      ...READING_FONTS.flatMap((font) => [
        { font: font.id, scale: null },
        ...READING_SCALES.map((scale) => ({ font: font.id, scale })),
      ]),
      ...READING_SCALES.map((scale) => ({ font: null, scale })),
    ];
    for (const appearance of every) {
      const css = appearanceCss(appearance);
      expect(css).not.toMatch(/user-select|touch-callout|::highlight/);
      // And only the two properties there are.
      for (const declaration of css.split('\n').filter(Boolean)) {
        expect(declaration).toMatch(/^[^{]+\{ font-(size|family): [^;]+ !important; \}$/);
      }
    }
    // The selectability the highlight needs is in the other half of the sheet, and
    // that half is not built from anything the owner chose.
    //
    // The leading newline and indent are load-bearing: `user-select: text
    // !important;` is a substring of the `-webkit-` line above it, so the bare
    // marker was answered by that line and the standard property — the one iOS
    // Safari honours — could be deleted with this rule still green. The exhaustive
    // form of this is in `rules.test.ts`.
    pin(highlightCss(DEFAULT_HIGHLIGHT), '\n  user-select: text !important;', 'the stylesheet highlightCss builds');
  });

  it('builds nothing at all from a font it does not know, rather than a rule out of the name', () => {
    // The list is what makes this uninjectable: an id is looked up, never
    // interpolated. The cast is what a settings file from another build would do.
    const css = appearanceCss({ font: 'Georgia; } body { display: none } p {' as never, scale: null });
    expect(css).toBe('');
  });

  it('clamps a size rather than passing it through, and ignores one that is not a number', () => {
    expect(appearanceCss({ font: null, scale: 10_000 })).toContain('font-size: 400%');
    expect(appearanceCss({ font: null, scale: 1 })).toContain('font-size: 50%');
    expect(appearanceCss({ font: null, scale: Number.NaN })).toBe('');
    expect(appearanceCss({ font: null, scale: Number.POSITIVE_INFINITY })).toBe('');
  });

  it('offers no size that means the same as following the document', () => {
    // A chip that looks like a choice and changes nothing is what philosophy rule
    // 6 removes.
    expect(READING_SCALES).not.toContain(100);
    expect(new Set(READING_SCALES).size).toBe(READING_SCALES.length);
  });

  it('ends every font stack in a generic family, so something is always found', () => {
    // And names no CJK face: WebKit falls through a stack per script, so a Chinese
    // book under “Serif” gets the system's own serif CJK face rather than a font
    // with no glyphs for it.
    for (const font of READING_FONTS) {
      expect(font.stack).toMatch(/(serif|sans-serif)$/);
      expect(font.stack).not.toMatch(/[一-鿿]|PingFang|Songti|Heiti/);
    }
  });
});
