import { describe, expect, it } from 'vitest';

import {
  appearanceCss,
  DEFAULT_APPEARANCE,
  FONT_SIZES,
  OWN_ALIGNMENT,
  stepFontSize,
  highlightCss,
  READING_FONTS,
  DEFAULT_HIGHLIGHT,
  TEXT_ALIGNMENTS,
} from '../../src/renderer/highlighter';
import { pin } from '../structural';

/** The one alignment rule, as `appearanceCss` writes it, for the value given. */
const aligned = (value: 'start' | 'justify') =>
  'body *:not(h1, h2, h3, h4, h5, h6, h1 *, h2 *, h3 *, h4 *, h5 *, h6 *, [data-openreader-own-alignment]) ' +
  '{ text-align: ' + value + ' !important; }\n';

/**
 * **Font Size** (CONTEXT.md): how big the body text of every Document is shown,
 * the owner's and never the Document's (#17, ADR 0030).
 */
describe('Font Size', () => {
  it('offers 12 to 24 a pixel at a time, then two at a time up to 32', () => {
    // The owner's ladder (#17): fine where people read, coarser where the steps
    // would otherwise take a dozen taps to cross.
    expect(FONT_SIZES).toEqual([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 28, 30, 32]);
  });

  it('moves one step per tap, across the change of step, and stops at either end', () => {
    expect(stepFontSize(16, 1)).toBe(17);
    expect(stepFontSize(16, -1)).toBe(15);
    expect(stepFontSize(24, 1)).toBe(26);
    expect(stepFontSize(26, -1)).toBe(24);
    // Null is a button with nowhere to go, which the sheet shows as disabled.
    expect(stepFontSize(32, 1)).toBeNull();
    expect(stepFontSize(12, -1)).toBeNull();
  });
});

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
  it('starts every Document at 16 with its body text justified, and states both like any other choice', () => {
    // 16px is what every current Document's body text already is (none of them
    // sets a size of its own), so the default changes nothing anyone has seen.
    // The font still starts on the Document's own; the alignment does not
    // (ADR 0034) — the owner reads justified text unless they say otherwise.
    expect(DEFAULT_APPEARANCE).toEqual({ font: null, size: 16, textAlignment: 'justify' });
    expect(appearanceCss(DEFAULT_APPEARANCE, 16)).toBe(
      'html, body, body * { -webkit-text-size-adjust: 100% !important; }\n' +
        'html, body, body * { text-size-adjust: 100% !important; }\n' +
        aligned('justify'),
    );
  });

  it('multiplies every size the Document set by one percentage, so its body text lands on the Font Size', () => {
    // text-size-adjust multiplies em, rem, px and keyword sizes alike, measured on
    // the iOS 27.0 simulator (ADR 0030). On every element, not only the root: a
    // Document's own `body { -webkit-text-size-adjust: 100% }` beat a root-only
    // rule and left the text at its own size, while the same value on every
    // element did not compound through nesting.
    expect(appearanceCss({ ...DEFAULT_APPEARANCE, size: 24 }, 16)).toBe(
      'html, body, body * { -webkit-text-size-adjust: 150% !important; }\n' +
        'html, body, body * { text-size-adjust: 150% !important; }\n' +
        aligned('justify'),
    );
    // A Document that sets its body text at 12px is brought to the owner's 16,
    // rather than kept smaller than every other Document.
    expect(appearanceCss({ ...DEFAULT_APPEARANCE, size: 16 }, 12)).toContain('text-size-adjust: 133.3333% !important;');
    expect(appearanceCss({ ...DEFAULT_APPEARANCE, size: 17 }, 16)).toContain('text-size-adjust: 106.25% !important;');
  });

  it('changes the font on the descendants too, because a book names one on the elements holding its text', () => {
    // `font-family` inherits, so a rule on the two roots alone is beaten by any
    // Document that names a face on a `p`, a `div` or a `span`. The owner's novel
    // names one on `body` and on `div` (notes/NOTES_2026-09-20.md, 03:16).
    const css = appearanceCss({ ...DEFAULT_APPEARANCE, font: 'georgia' }, 16);
    expect(css).toContain('html, body, body * { font-family: Georgia, serif !important; }');
    expect(css).not.toContain('font-size');
  });

  it('cannot declare user-select, whatever it is given', () => {
    // The rule that fails as nothing happening. Every combination the sheet can
    // produce, over body text sizes a Document could measure at and some it
    // should not.
    const fonts = [null, ...READING_FONTS.map((font) => font.id)];
    const alignments = new Set([aligned('start'), aligned('justify')].map((rule) => rule.trimEnd()));
    for (const font of fonts) {
      for (const size of FONT_SIZES) {
        for (const textAlignment of TEXT_ALIGNMENTS) {
          for (const bodyTextSize of [16, 12, 10, 20, 32, 4, 100, Number.NaN]) {
            const css = appearanceCss({ font, size, textAlignment }, bodyTextSize);
            expect(css).not.toMatch(/user-select|touch-callout|::highlight/);
            // And only the properties there are, each in a rule of its own, and
            // the alignment exactly one of its two rules.
            for (const declaration of css.split('\n').filter(Boolean)) {
              if (declaration.includes('text-align:')) {
                expect(alignments.has(declaration)).toBe(true);
                continue;
              }
              expect(declaration).toMatch(
                /^html, body, body \* \{ (-webkit-text-size-adjust|text-size-adjust|font-family): [^;]+ !important; \}$/,
              );
            }
          }
        }
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
    const css = appearanceCss({ ...DEFAULT_APPEARANCE, font: 'Georgia; } body { display: none } p {' as never }, 16);
    expect(css).not.toContain('font-family');
    expect(css).not.toContain('display');
  });

  it('keeps the percentage between a quarter and four times, and reads a body size that is no size as 16', () => {
    // A measurement gone wrong must not make a book unreadable, and a number
    // that is not a size must not reach a stylesheet as `NaN%`.
    expect(appearanceCss({ ...DEFAULT_APPEARANCE, size: 32 }, 4)).toContain('text-size-adjust: 400% !important;');
    expect(appearanceCss({ ...DEFAULT_APPEARANCE, size: 12 }, 64)).toContain('text-size-adjust: 25% !important;');
    // Null is a Document not measured yet, which is taken to be 16 until it is.
    for (const bodyTextSize of [null, undefined, Number.NaN, 0, -16, Number.POSITIVE_INFINITY]) {
      expect(appearanceCss({ ...DEFAULT_APPEARANCE, size: 20 }, bodyTextSize)).toContain('text-size-adjust: 125% !important;');
    }
    expect(appearanceCss({ ...DEFAULT_APPEARANCE, size: Number.NaN as never }, 16)).toContain('text-size-adjust: 100% !important;');
  });

  it('ends every font stack in a generic family, so something is always found', () => {
    // The rule that survived ADR 0029, and the one that was load bearing all
    // along: WebKit falls through a stack per script, so the generic at the end
    // is what a Chinese book gets where the named face has no glyphs for it.
    // `Georgia, serif` lays Latin out in Georgia and Chinese out in the system's
    // own serif CJK face, in the same paragraph.
    //
    // The prohibition on naming a CJK face is gone. It was never the same claim:
    // the danger was a stack with no generic behind it, and `Songti SC, serif`
    // has one. What it cost was an owner reading Chinese being unable to pick a
    // Chinese face at all.
    for (const font of READING_FONTS) {
      expect(font.stack).toMatch(/(serif|sans-serif)$/);
    }
  });

  it('offers both kinds of CJK face through the generics, without naming one', () => {
    // The list named 苹方, 宋体, 楷体 and 圆体 for one commit. Three of the four
    // are absent from `UIFont.familyNames` on the iOS 27.0 simulator runtime, so
    // those rows rendered as the system font and changed nothing (ADR 0029).
    //
    // Nothing is lost by their absence, and this is what says so: a Chinese book
    // still reaches a serif CJK face and a modern one, through the generic at
    // the end of a Latin stack, which is exactly what the three categories that
    // preceded this list gave it.
    const ends = new Set(READING_FONTS.map((font) => font.stack.split(', ').at(-1)));
    expect(ends).toContain('serif');
    expect(ends).toContain('sans-serif');
    for (const font of READING_FONTS) {
      expect(font.label).not.toMatch(/[一-鿿]/);
    }
  });
});

/**
 * **Text Alignment** (CONTEXT.md): how the lines of body text meet the margins,
 * the owner's and never the Document's (#32, ADR 0034).
 */
describe('Text Alignment', () => {
  it('offers Left, then Justify', () => {
    // The order the menu lists them in, which is the order every alignment
    // control uses.
    expect(TEXT_ALIGNMENTS).toEqual(['left', 'justify']);
  });

  it('justifies body text, or sets it from the margin a line starts on when the owner chose Left', () => {
    expect(appearanceCss({ ...DEFAULT_APPEARANCE, textAlignment: 'justify' }, 16)).toContain(aligned('justify'));
    // `start` rather than `left`: the word names what the owner sees, and a
    // right-to-left Document would still be ragged on the side its lines end.
    expect(appearanceCss({ ...DEFAULT_APPEARANCE, textAlignment: 'left' }, 16)).toContain(aligned('start'));
    // One rule either way, and after the font's, so the font rule above it is
    // unchanged by the choice.
    const css = appearanceCss({ font: 'georgia', size: 16, textAlignment: 'left' }, 16);
    expect(css.match(/text-align:/g)).toHaveLength(1);
    expect(css.indexOf('text-align:')).toBeGreaterThan(css.indexOf('font-family:'));
  });

  it('never reaches a heading, what is inside one, or what the Document aligned itself', () => {
    // Justifying a one-line centred title sets it flush left — it is the last
    // line of its block — so the rule must not reach one at all. The program
    // marks what the Document centres or sets right with OWN_ALIGNMENT before
    // this stylesheet arrives; the rule passes over the mark, on the roots too.
    const css = appearanceCss(DEFAULT_APPEARANCE, 16);
    expect(OWN_ALIGNMENT).toBe('data-openreader-own-alignment');
    for (const excluded of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h1 *', 'h6 *', '[' + OWN_ALIGNMENT + ']']) {
      expect(css).toContain(excluded);
    }
    // And not on the roots: a heading that declares nothing inherits from
    // `body`, and with the owner's value there it computed `justify` on the
    // device (notes 2026-09-22). Every element holding body text is reached
    // directly instead.
    const rule = css.split('\n').find((line) => line.includes('text-align:'));
    expect(rule?.startsWith('body *:not(')).toBe(true);
    expect(rule).not.toMatch(/(^|, )(html|body)(:not\([^)]*\))?(, | \{)/);
  });

  it('reads an alignment it does not know as Justify, rather than writing it into a rule', () => {
    // Two words written in highlighter.ts are all that can reach the stylesheet.
    // The cast is what a settings file from another build would do.
    for (const textAlignment of ['center', 'right; } body { display: none } p {', '', undefined] as never[]) {
      const css = appearanceCss({ ...DEFAULT_APPEARANCE, textAlignment }, 16);
      expect(css).toContain(aligned('justify'));
      expect(css).not.toContain('display');
      expect(css).not.toContain('center');
    }
  });
});
