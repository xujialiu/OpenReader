import { describe, expect, it } from 'vitest';

import { sectionChapters } from '../../src/offline/model';
import { BLOCKS_MESSAGE } from '../../src/renderer/messages';

import { standInPage } from './stand-in-page';

/**
 * **Where a Contents entry starts: the page program's one rule (#212, #190, #167).**
 *
 * A Contents entry that points into a file by its fragment starts at the first
 * Block whose first text lies inside the fragment's element or after it. A
 * Download cuts a file's sentences into chapters by it, and the Reader tells the
 * rows of a shared file apart by it, so the Contents, the Lock Screen and the
 * Download drawer name the same chapter.
 *
 * Run over the real page program on the stand-in page (`stand-in-page.ts`); the
 * DOM is xmldom's, and `compareDocumentPosition` answers as WebKit was measured
 * to (#190: an anchor inside its heading compares as contained in it).
 */

const SECTION = 3;
const points = (...fragments: string[]) =>
  fragments.map((fragment, at) => ({ id: 'nav.' + at, title: 'Entry ' + at, depth: 0, parent: null, section: SECTION, fragment }));

/** A Download's preparation of one section with these entries, as `indexer.tsx` asks for it. */
async function prepared(body: string, ...fragments: string[]) {
  const page = standInPage();
  page.addSection(SECTION, body);
  return page.prepare(SECTION, points(...fragments));
}
const startsOf = async (body: string, ...fragments: string[]) => (await prepared(body, ...fragments)).points.map((p: { block: number | null }) => p.block);

const TAIL = '<p>First paragraph. Second sentence.</p><p>Third.</p>';

describe('a chapter whose anchor is inside its heading starts at that heading (#190)', () => {
  it('an empty <a id> before the heading text', async () => {
    expect(await startsOf('<h2><a id="c1"></a>Chapter One</h2>' + TAIL, 'c1')).toEqual([0]);
  });

  it('a <span id> around the heading text', async () => {
    expect(await startsOf('<h2><span id="c1">Chapter One</span></h2>' + TAIL, 'c1')).toEqual([0]);
  });

  it('with the source file\'s white space before the anchor', async () => {
    expect(await startsOf('<h2>\n    <a id="c1"></a>Chapter One</h2>' + TAIL, 'c1')).toEqual([0]);
  });

  it('two such chapters in one file: neither ends with the other\'s title', async () => {
    const answer = await prepared(
      '<h2><a id="c1"></a>Chapter One</h2><p>One one. One two.</p><h2><a id="c2"></a>Chapter Two</h2><p>Two one.</p>', 'c1', 'c2');
    expect(answer.points.map((p: { block: number }) => p.block)).toEqual([0, 2]);
    const chapters = sectionChapters(answer.index, answer.blocks, answer.points, answer.language);
    expect(chapters.map((c) => [c.id, c.texts])).toEqual([
      ['nav.0', ['Chapter One', 'One one.', 'One two.']],
      ['nav.1', ['Chapter Two', 'Two one.']],
    ]);
  });

  it('controls, placed as before: the id on the heading, an anchor before it, an id on a <div> around the chapter', async () => {
    expect(await startsOf('<h2 id="c1">Chapter One</h2>' + TAIL, 'c1')).toEqual([0]);
    expect(await startsOf('<a id="c1"></a><h2>Chapter One</h2>' + TAIL, 'c1')).toEqual([0]);
    expect(await startsOf('<div id="c1"><h2>Chapter One</h2>' + TAIL + '</div>', 'c1')).toEqual([0]);
  });

  it('an empty <span id> at the start of a paragraph starts at that paragraph', async () => {
    expect(await startsOf('<p>Before it.</p><p><span id="s"></span>First of the chapter.</p>', 's')).toEqual([1]);
  });

  it('an anchor in the middle of a paragraph starts at the Block after it, as before', async () => {
    expect(await startsOf('<p>Before.</p><p>Some text <a id="m"></a>more text.</p><p>After.</p>', 'm')).toEqual([2]);
  });

  it('an anchor after every Block starts at the end', async () => {
    expect(await startsOf('<p>Only.</p><a id="end"></a>', 'end')).toEqual([1]);
  });
});

describe('an entry whose anchor the file lacks places nothing, and stops nothing (#167)', () => {
  it('prepares the file, with the entry unplaced and its text read with the entry before it', async () => {
    const answer = await prepared('<h1>B one</h1><p>Text of B one.</p><h2>B two</h2><p>Text of B two.</p>', '', 'gone');
    expect(answer.type).toBe('openreader:offline-section');
    expect(answer.points.map((p: { block: number | null }) => p.block)).toEqual([0, null]);
    const chapters = sectionChapters(answer.index, answer.blocks, answer.points, answer.language);
    expect(chapters.map((c) => [c.id, c.texts])).toEqual([
      ['nav.0', ['B one', 'Text of B one.', 'B two', 'Text of B two.']],
      ['nav.1', []],
    ]);
  });
});

describe('the Reader is told where each Contents fragment starts in a section it lays out (#212)', () => {
  /** The Blocks message the program posts for the section, after epub.js's content hook. */
  function report(toc: readonly unknown[] | undefined, body: string) {
    const page = standInPage({ toc });
    page.addSection(SECTION, body);
    page.sweep();
    return page.posted.filter((m) => m.type === BLOCKS_MESSAGE && m.sectionIndex === SECTION).pop();
  }
  const BODY = '<h2 id="a">A</h2><p>a.</p><h2><a id="b"></a>B</h2><p>b.</p><h2 id="café">C</h2><p>c.</p>';

  it('as Block ordinals by fragment, by the same rule a Download cuts by, and only for fragments in this section', () => {
    const toc = [
      { href: '/ch3.xhtml#a', subitems: [{ href: '/ch3.xhtml#b', subitems: [] }] },
      { href: 'ch4.xhtml#elsewhere' },
      { href: 'ch3.xhtml#caf%C3%A9' },
    ];
    expect(report(toc, BODY).anchors).toEqual([['a', 0], ['b', 2], ['café', 4]]);
  });

  it('sends nothing new for a Document whose Contents names no fragment, or before the navigation is known', () => {
    expect(report([{ href: 'ch3.xhtml' }], BODY)).not.toHaveProperty('anchors');
    expect(report(undefined, BODY)).not.toHaveProperty('anchors');
  });
});
