import { describe, expect, it } from 'vitest';

import { countPage, decideBodyTextSize } from '../../src/renderer/body-text';

/**
 * A Document's **body text size**: what its Font Size is measured against
 * (ADR 0030). The WebView counts characters by the size the Document itself set
 * them in; this decides, once per Document, which size is the body text.
 */
describe('decideBodyTextSize', () => {
  it('decides nothing from pages with too little text, such as a title page', () => {
    // A title page is a big title and a line or two: deciding from it would make
    // the title the body text and shrink it to the owner's size.
    expect(decideBodyTextSize([[32, 12], [16, 300]])).toBeNull();
  });

  it('leaves a page of small print, such as a copyright page, to be outvoted by the chapter after it', () => {
    // Front matter can run to a few hundred characters of 12px text. Deciding on
    // it alone would scale the whole Document from its small print, for good.
    expect(decideBodyTextSize([[12, 900]])).toBeNull();
    expect(decideBodyTextSize([[12, 900], [16, 3000]])).toBe(16);
  });

  it('is the size most of the text is set in, once enough has been counted', () => {
    // The shape of a chapter of the owner's novel: a badge in `x-small`, a
    // chapter title, and the paragraphs.
    expect(decideBodyTextSize([[10, 4], [16, 11], [16, 2980]])).toBe(16);
    // A Document that sets its body text small and its headings large.
    expect(decideBodyTextSize([[24, 40], [12, 2400]])).toBe(12);
  });

  it('adds up what several pages said about the same size', () => {
    expect(decideBodyTextSize([[16, 800], [20, 1400], [16, 800]])).toBe(16);
  });

  it('counts sizes a rounding error apart as one, and ignores counts that are not a size or not text', () => {
    // The WebView reads a size with the owner's percentage already applied and
    // divides it back out, which is exact only up to floating point.
    expect(decideBodyTextSize([[15.999999, 700], [16.000001, 700], [20, 1000]])).toBe(16);
    expect(
      decideBodyTextSize([[Number.NaN, 5000], [0, 5000], [-3, 5000], [Number.POSITIVE_INFINITY, 5000], [16, 2100], [18, Number.NaN]]),
    ).toBe(16);
  });
});

describe('countPage', () => {
  it('decides on the page that brings the count to enough text, and not before', () => {
    const first = countPage(new Map(), 0, [[16, 1200]]);
    expect(first.bodyTextSize).toBeNull();
    expect(countPage(first.pages, 1, [[16, 1200]]).bodyTextSize).toBe(16);
  });

  it('counts a page rendered again once, not once per render', () => {
    // epub.js renders a section again after a resize or on the way back to it,
    // and a title page counted twice must still be a title page.
    const once = countPage(new Map(), 0, [[32, 12], [16, 1100]]);
    const again = countPage(once.pages, 0, [[32, 12], [16, 1100]]);
    expect(again.bodyTextSize).toBeNull();
    expect(countPage(again.pages, 1, [[16, 1100]]).bodyTextSize).toBe(16);
  });
});
