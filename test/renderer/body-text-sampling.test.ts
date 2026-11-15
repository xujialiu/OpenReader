import { describe, expect, it } from 'vitest';

import { countPage } from '../../src/renderer/body-text';
import { appearanceCss, DEFAULT_APPEARANCE } from '../../src/renderer/highlighter';
import { BLOCKS_MESSAGE, type CharactersBySize } from '../../src/renderer/messages';

import { standInPage } from './stand-in-page';

/**
 * Production adopt → sizesOf → Blocks message → countPage, not a second sampler.
 * Computed styles are explicit pixel-size/inheritance doubles: these tests
 * establish eligibility and the decision, not WebKit layout/text-size-adjust.
 * The original EPUB replay and full-app checks establish the drawn sizes.
 */
function sampler() {
  const page = standInPage({ bodyTextSize: null });
  return {
    page,
    add(index: number, body: string): CharactersBySize {
      page.addSection(index, body);
      page.sweep();
      return page.posted.filter((m) => m.type === BLOCKS_MESSAGE && m.sectionIndex === index).at(-1).sizes;
    },
  };
}

describe('only Body Text establishes the font-size baseline (#363)', () => {
  it('does not lock onto copyright and Contents that together exceed 2,000 characters', () => {
    const { add } = sampler();
    // Original failure's shape/counts, without any text from the personal EPUB.
    const copyright = add(0, '<p style="text-align:center;font-size:9.328px">' + 'c'.repeat(795) + '</p>');
    const contents = add(1,
      '<h1 style="font-size:24px">Contents</h1>' +
      '<p style="font-size:12px"><a href="chapter.xhtml">' + 't'.repeat(993) + '</a></p>' +
      '<p style="font-size:13.328px"><a href="part.xhtml">' + 't'.repeat(204) + '</a></p>' +
      '<p><a href="notes.xhtml">Notes notes</a></p>');
    const first = countPage(new Map(), 0, copyright);
    const front = countPage(first.pages, 1, contents);
    expect(front.bodyTextSize).toBeNull();
    expect(copyright).toEqual([]);
    expect(contents).toEqual([]);

    const prose = add(2, '<h2 style="font-size:24px">Introduction</h2><p style="font-size:15.008px">' + 'p'.repeat(3000) + '</p>');
    const decided = countPage(front.pages, 2, prose).bodyTextSize;
    expect(decided).toBe(15.01);
    expect(appearanceCss({ ...DEFAULT_APPEARANCE, size: 24 }, decided)).toContain('text-size-adjust: 159.8934%');
  });

  it('ignores a long Contents even when its links are wrapped in nested inline elements', () => {
    const { add } = sampler();
    expect(add(0, '<p style="font-size:12px"><a href="chapter.xhtml"><b><span>' + 'c'.repeat(3000) + '</span></b></a></p>')).toEqual([]);
    expect(add(1, '<nav><p>' + 'c'.repeat(3000) + '</p></nav>')).toEqual([]);
  });

  it.each([
    ['epub:type="copyright-page"', 'section'],
    ['epub:type="frontmatter toc"', 'section'],
    ['epub:type="footnote"', 'aside'],
    ['epub:type="endnotes"', 'section'],
    ['epub:type="titlepage"', 'section'],
    ['role="doc-toc"', 'section'],
    ['role="navigation"', 'div'],
    ['role="doc-footnote"', 'div'],
    ['role="doc-endnotes"', 'section'],
    ['role="heading"', 'div'],
  ])('excludes explicitly non-body ancestors: %s', (attribute, tag) => {
    const { add } = sampler();
    expect(add(0, '<' + tag + ' xmlns:epub="http://www.idpf.org/2007/ops" ' + attribute + '><p><em>' + 'x'.repeat(2400) + '</em></p></' + tag + '>')).toEqual([]);
  });

  it('excludes headings, captions and the Document’s own centered or right-aligned text', () => {
    const { add } = sampler();
    expect(add(0,
      '<h2><span>' + 'h'.repeat(2100) + '</span></h2>' +
      '<figcaption>' + 'c'.repeat(1000) + '</figcaption>' +
      '<div style="text-align:center"><p>' + 'c'.repeat(1000) + '</p></div>' +
      '<p style="text-align:right">' + 'r'.repeat(1000) + '</p>')).toEqual([]);
  });

  it('keeps short prose paragraphs, including CJK dialogue, without a minimum paragraph length', () => {
    const { add } = sampler();
    const counts = add(0, Array.from({ length: 100 }, () => '<p style="font-size:12px">' + '这是正文。'.repeat(5) + '</p>').join(''));
    expect(countPage(new Map(), 0, counts).bodyTextSize).toBe(12);
  });

  it('keeps inline emphasis, bare div prose, non-link anchors and RTL prose', () => {
    const { add } = sampler();
    const counts = add(0,
      '<div dir="rtl" style="font-size:18px"><a id="chapter"><em>' + 'א'.repeat(1000) +
      '</em></a><b>' + 'ב'.repeat(1000) + '</b>' + 'ג'.repeat(400) + '</div>');
    expect(counts).toEqual([[18, 2400]]);
    expect(countPage(new Map(), 0, counts).bodyTextSize).toBe(18);
  });

  it('does not exclude left-aligned prose just because its container is centered', () => {
    const { add } = sampler();
    const counts = add(0, '<div style="text-align:center"><p style="text-align:left;font-size:15px">' + 'p'.repeat(2400) + '</p></div>');
    expect(counts).toEqual([[15, 2400]]);
  });

  it('charges excluded text against the scan budget instead of searching an entire long section', () => {
    const { add } = sampler();
    expect(add(0, '<p><a href="chapter.xhtml">' + 'c'.repeat(5000) + '</a></p><p>' + 'p'.repeat(3000) + '</p>')).toEqual([]);
    expect(add(1, '<p>' + 'p'.repeat(2400) + '</p>')).toEqual([[16, 2400]]);
  });

  it('does not change reported Blocks or offsets when text is excluded from size evidence', () => {
    const { page, add } = sampler();
    add(0, '<h2>Chapter</h2><p>Before <a href="#note">note</a> after.</p><aside xmlns:epub="http://www.idpf.org/2007/ops" epub:type="footnote">Note text.</aside>');
    const blocks = page.posted.find((m) => m.type === BLOCKS_MESSAGE).blocks;
    expect(blocks.map((b: { text: string }) => b.text)).toEqual(['Chapter', 'Before note after.', 'Note text.']);
    page.send({ kind: 'measured' });
    add(1, '<p>' + 'p'.repeat(2400) + '</p>');
    expect(page.posted.filter((m) => m.type === BLOCKS_MESSAGE).at(-1).sizes).toBeNull();
  });
});
