import { describe, expect, it } from 'vitest';

import {
  appearanceCss,
  DEFAULT_APPEARANCE,
  FONT_SIZES,
  MARGINS,
  OWN_ALIGNMENT,
  stepFontSize,
  stepMargins,
  highlightCss,
  READING_FONTS,
  TEXT_ALIGNMENTS,
  UTTERANCE_HIGHLIGHT,
  WORD_HIGHLIGHT,
} from '../../src/renderer/highlighter';
import { pin } from '../structural';
import { DEFAULT_HIGHLIGHT_COLOURS, HIGHLIGHT_PRESETS, type HighlightColours } from '../../src/renderer/highlight-colours';

/** The one alignment rule, as `appearanceCss` writes it, for the value given. */
const aligned = (value: 'start' | 'justify') =>
  'body *:not(h1, h2, h3, h4, h5, h6, h1 *, h2 *, h3 *, h4 *, h5 *, h6 *, [data-openreader-own-alignment]) ' +
  '{ text-align: ' + value + ' !important; }\n';

/** The one Margins rule, as `appearanceCss` writes it, for the value given. */
const margined = (points: number) =>
  'body { margin-left: 0 !important; margin-right: 0 !important; ' +
  'padding-left: ' + points + 'px !important; padding-right: ' + points + 'px !important; }\n';

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
  it('starts every Document at 26 with 24-point Margins and its body text justified, and states each like any other choice', () => {
    // 26 and 24 are what the owner reads at on the iPhone (2026-10-01); the first
    // defaults were 16 and 16. A Document whose body text is 16px is shown at
    // 162.5%. The font still starts on the Document's own; the alignment does
    // not (ADR 0034) — the owner reads justified text unless they say otherwise.
    // Nor do the Margins (#84).
    expect(DEFAULT_APPEARANCE).toEqual({ font: null, size: 26, margins: 24, textAlignment: 'justify', highlight: DEFAULT_HIGHLIGHT_COLOURS });
    expect(appearanceCss(DEFAULT_APPEARANCE, 16)).toBe(
      'html, body, body * { -webkit-text-size-adjust: 162.5% !important; }\n' +
        'html, body, body * { text-size-adjust: 162.5% !important; }\n' +
        aligned('justify') +
        margined(24),
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
        aligned('justify') +
        margined(24),
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
    const marginRules = new Set(MARGINS.map((points) => margined(points).trimEnd()));
    for (const font of fonts) {
      for (const size of FONT_SIZES) {
        for (const margins of MARGINS) {
          for (const textAlignment of TEXT_ALIGNMENTS) {
            for (const bodyTextSize of [16, 12, 10, 20, 32, 4, 100, Number.NaN]) {
              const css = appearanceCss({ font, size, margins, textAlignment, highlight: DEFAULT_HIGHLIGHT_COLOURS }, bodyTextSize);
              expect(css).not.toMatch(/user-select|touch-callout|::highlight/);
              // And only the properties there are, each in a rule of its own, the
              // alignment exactly one of its two rules and the Margins one of theirs.
              for (const declaration of css.split('\n').filter(Boolean)) {
                if (declaration.includes('text-align:')) {
                  expect(alignments.has(declaration)).toBe(true);
                  continue;
                }
                if (declaration.startsWith('body {')) {
                  expect(marginRules.has(declaration)).toBe(true);
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
    }
    // The selectability the highlight needs is in the other half of the sheet, and
    // that half is not built from anything the owner chose.
    //
    // The leading newline and indent are load-bearing: `user-select: text
    // !important;` is a substring of the `-webkit-` line above it, so the bare
    // marker was answered by that line and the standard property — the one iOS
    // Safari honours — could be deleted with this rule still green. The exhaustive
    // form of this is in `rules.test.ts`.
    pin(highlightCss(DEFAULT_HIGHLIGHT_COLOURS), '\n  user-select: text !important;', 'the stylesheet highlightCss builds');
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
    const css = appearanceCss({ font: 'georgia', size: 16, margins: 16, textAlignment: 'left', highlight: DEFAULT_HIGHLIGHT_COLOURS }, 16);
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

/**
 * **Margins** (CONTEXT.md): the empty space between a Document's text and each
 * side of the screen, the owner's and never the Document's (#84, ADR 0056).
 */
describe('Margins', () => {
  it('offers 8 to 48 points, four at a time', () => {
    // The owner's ladder (#84). Not below 8: at 0 or 4 the letters meet the
    // edge of the glass.
    expect(MARGINS).toEqual([8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48]);
  });

  it('moves one step per tap and stops at either end', () => {
    expect(stepMargins(16, 1)).toBe(20);
    expect(stepMargins(16, -1)).toBe(12);
    // Null is a button with nowhere to go, which the sheet shows as disabled.
    expect(stepMargins(48, 1)).toBeNull();
    expect(stepMargins(8, -1)).toBeNull();
  });

  it('sets the same padding on both sides of the body, and clears the body\'s own side margins', () => {
    // epub.js writes `padding: 0 <width / 12>px` on each section's body as an
    // inline style, which a stylesheet rule with !important beats; the side
    // margins go to 0 so a Document's own `!important` body margin cannot add
    // to the owner's.
    for (const margins of MARGINS) {
      const css = appearanceCss({ ...DEFAULT_APPEARANCE, margins }, 16);
      expect(css).toContain(margined(margins));
      expect(css.match(/padding/g)).toHaveLength(2);
    }
  });

  it('reaches the body alone, so a Document\'s own indents come on top', () => {
    // A quotation's or a list's indent is inside the body and is the Document's.
    const rule = appearanceCss(DEFAULT_APPEARANCE, 16).split('\n').find((line) => line.includes('padding'));
    expect(rule?.startsWith('body { ')).toBe(true);
  });

  it('reads Margins it does not know as the default, 24, rather than writing them into a rule', () => {
    // A number on the ladder is all that can reach the stylesheet. The cast is
    // what a settings file from another build would do.
    for (const margins of [0, 4, 15, 50, -8, Number.NaN, '16', '8px; } body { display: none } p {', null, undefined] as never[]) {
      const css = appearanceCss({ ...DEFAULT_APPEARANCE, margins }, 16);
      expect(css).toContain(margined(24));
      expect(css).not.toContain('display');
      expect(css.match(/padding-left/g)).toHaveLength(1);
    }
  });
});

/**
 * The owner's **Highlight Colours** (CONTEXT.md, #118) as the page's stylesheet:
 * `highlightCss`, the same under either theme.
 */
describe('Highlight Colours as a stylesheet', () => {
  /** The two `::highlight()` rules of the sheet, without `SELECTABLE`. */
  const highlightRules = (colours: HighlightColours) =>
    highlightCss(colours).split('\n').filter((line) => line.startsWith('::highlight('));

  /** `top` at `alpha` over the opaque `under`, per channel, as WebKit composites a background. */
  const over = (top: [number, number, number], alpha: number, under: [number, number, number]) =>
    top.map((channel, i) => channel * alpha + under[i] * (1 - alpha)) as [number, number, number];
  const hex = (rgb: [number, number, number]) => '#' + rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('');

  it('marks the sentence and the word in Blue, the default, at its opacities', () => {
    expect(highlightRules(DEFAULT_HIGHLIGHT_COLOURS)).toEqual([
      '::highlight(' + UTTERANCE_HIGHLIGHT + ') { background-color: rgba(67, 70, 101, 0.22); }',
      '::highlight(' + WORD_HIGHLIGHT + ') { background-color: rgba(68, 86, 222, 0.62); }',
    ]);
    expect(DEFAULT_HIGHLIGHT_COLOURS).toEqual(HIGHLIGHT_PRESETS.blue);
  });

  it('marks them in Amber exactly as the light page did before #118', () => {
    expect(highlightRules(HIGHLIGHT_PRESETS.amber)).toEqual([
      '::highlight(' + UTTERANCE_HIGHLIGHT + ') { background-color: rgba(255, 196, 0, 0.22); }',
      '::highlight(' + WORD_HIGHLIGHT + ') { background-color: rgba(255, 168, 0, 0.62); }',
    ]);
  });

  it('writes an opacity of 0 as a transparent rule rather than leaving the rule out', () => {
    // A word at 0 is a reading marked by the sentence alone (owner's Q11). The
    // rule stays, so the sheet has the same shape whatever the owner chose.
    const colours = { sentence: { color: '#434665', opacity: 0 }, word: { color: '#4456de', opacity: 0 } };
    expect(highlightRules(colours)).toEqual([
      '::highlight(' + UTTERANCE_HIGHLIGHT + ') { background-color: rgba(67, 70, 101, 0); }',
      '::highlight(' + WORD_HIGHLIGHT + ') { background-color: rgba(68, 86, 222, 0); }',
    ]);
    expect(highlightRules({ ...colours, word: { color: '#ffffff', opacity: 100 } })[1]).toBe(
      '::highlight(' + WORD_HIGHLIGHT + ') { background-color: rgba(255, 255, 255, 1); }',
    );
  });

  it('composites Blue to what the simulator measures, on the white page and the dark one', () => {
    // The word paints over the sentence (registered second), and both over the
    // page. These are the colours a screenshot of a highlighted word should hold.
    const blue = HIGHLIGHT_PRESETS.blue;
    const sentenceRgb: [number, number, number] = [67, 70, 101];
    const wordRgb: [number, number, number] = [68, 86, 222];
    for (const [page, sentence, word] of [
      [[255, 255, 255], '#d6d6dd', '#7b87de'],
      [[0x11, 0x11, 0x14], '#1c1d26', '#354098'],
    ] as const) {
      const underWord = over(sentenceRgb, blue.sentence.opacity / 100, [...page]);
      expect(hex(underWord)).toBe(sentence);
      expect(hex(over(wordRgb, blue.word.opacity / 100, underWord))).toBe(word);
    }
  });

  it('begins with the selectability the highlight needs, and declares nothing else, whatever it is given', () => {
    // A settings file from another build, or one written by hand, must not be
    // able to put a declaration of its own into the page: the colours are read
    // through the model, and `rgba` writes only numbers.
    const hostile = [
      DEFAULT_HIGHLIGHT_COLOURS,
      HIGHLIGHT_PRESETS.amber,
      { sentence: { color: '#ffc400; } body { user-select: none } x {', opacity: 22 }, word: { color: 'red', opacity: '62); user-select: none; (' } },
      { sentence: { color: '#4456DE', opacity: Number.NaN }, word: { color: '#4456de80', opacity: -40 } },
      { sentence: null, word: 'user-select: none' },
      null,
      'body { user-select: none }',
    ] as never[];
    const selectable = highlightCss(DEFAULT_HIGHLIGHT_COLOURS).slice(0, highlightCss(DEFAULT_HIGHLIGHT_COLOURS).indexOf('}') + 2);
    for (const colours of hostile) {
      const css = highlightCss(colours);
      expect(css.startsWith(selectable)).toBe(true);
      const rest = css.slice(selectable.length);
      expect(rest).not.toMatch(/user-select|touch-callout|display/);
      expect(rest.split('\n').filter(Boolean)).toHaveLength(2);
      for (const rule of rest.split('\n').filter(Boolean)) {
        expect(rule).toMatch(/^::highlight\(openreader-(utterance|word)\) \{ background-color: rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0\.\d+)\); \}$/);
      }
    }
    // What does not read as a colour is the default's; what does, is kept.
    expect(highlightCss({ sentence: { color: '#4456DE', opacity: Number.NaN }, word: { color: '#4456de80', opacity: -40 } } as never)).toContain(
      '::highlight(' + UTTERANCE_HIGHLIGHT + ') { background-color: rgba(68, 86, 222, 0.22); }',
    );
  });
});
