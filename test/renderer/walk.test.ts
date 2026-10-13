import { describe, expect, it } from 'vitest';

import { segmentDocument } from '../../src/app/segment';
import { tokenize } from '../../src/core/align';
import { prepareSpeechText } from '../../src/core/speech-text';
import { sectionChapters } from '../../src/offline/model';

import { standInPage, type Section, type StandInPage } from './stand-in-page';

/**
 * **What one Block is: the page program's walk (#184, #189, #192, #194).**
 *
 * The walk turns a rendered section into Blocks for the Reading and for a
 * Download's preparation alike, and the sentences are cut from those. Each case
 * here was a sentence the owner would have heard wrong: a list read as one
 * run-on sentence, a drop cap read as a letter alone, two lines of a heading
 * joined with nothing between them.
 *
 * Run over the real page program on the stand-in page (`stand-in-page.ts`),
 * whose computed style answers `display` from the tag and the `style`
 * attribute, and blockifies a floated or absolutely positioned box as WebKit
 * does. Layout itself is the simulator's.
 */

function open(body: string): { page: StandInPage; section: Section } {
  const page = standInPage();
  const section = page.addSection(3, body);
  page.sweep();
  return { page, section };
}

const blocksOf = (body: string) => {
  const { page, section } = open(body);
  return page.blocks(section);
};
const sentencesOf = (body: string) => segmentDocument(blocksOf(body), 'en').map((u) => u.text);

describe('list items, definition-list entries and table cells (#184)', () => {
  it('a bulleted list of lowercase items without full stops is read an item at a time', () => {
    expect(sentencesOf(
      '<p>The new design has three advantages.</p><ul>\n<li>lower cost</li>\n<li>faster startup</li>\n<li>fewer moving parts</li>\n</ul><p>each is discussed below.</p>',
    )).toEqual(['The new design has three advantages.', 'lower cost', 'faster startup', 'fewer moving parts', 'each is discussed below.']);
  });

  it('so is a list whose items hold a paragraph each, where the Block is the paragraph and not the item', () => {
    expect(sentencesOf('<ul><li><p>lower cost</p></li><li><p>faster startup</p></li></ul>')).toEqual(['lower cost', 'faster startup']);
  });

  it('a vocabulary table is read a cell at a time', () => {
    const row = (a: string, b: string) => `<tr><td>${a}</td><td>${b}</td></tr>`;
    expect(sentencesOf(`<table><tbody>${row('perro', 'dog')}${row('gato', 'cat')}${row('casa', 'house')}</tbody></table>`))
      .toEqual(['perro', 'dog', 'gato', 'cat', 'casa', 'house']);
  });

  it('a definition list is read an entry at a time', () => {
    expect(sentencesOf('<dl><dt>perro</dt><dd>a dog</dd><dt>gato</dt><dd>a cat</dd></dl>')).toEqual(['perro', 'a dog', 'gato', 'a cat']);
  });

  it('800 cells give no sentence longer than a cell', () => {
    let rows = '';
    for (let i = 0; i < 800; i += 2) rows += `<tr><td>cell${i}x</td><td>cell${i + 1}x</td></tr>`;
    expect(Math.max(...sentencesOf(`<table><tbody>${rows}</tbody></table>`).map((t) => t.length))).toBe('cell799x'.length);
  });

  it('every Block reports the item it sits in, and the same one for two Blocks of one item', () => {
    const blocks = blocksOf('<p>Before.</p><ul><li><p>one</p><p>two</p></li><li>three</li></ul>');
    expect(blocks.map((b) => [b.text, b.item])).toEqual([['Before.', undefined], ['one', 0], ['two', 0], ['three', 1]]);
  });

  it('control: a paragraph the markup cut mid-sentence is still put back together, inside one cell as outside', () => {
    const cut = '<p>It is a truth universally acknowledged, that a single man in</p><p>possession of a good fortune, must be in want of a wife.</p>';
    const whole = ['It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.'];
    expect(sentencesOf(cut)).toEqual(whole);
    expect(sentencesOf(`<table><tbody><tr><td>${cut}</td></tr></tbody></table>`)).toEqual(whole);
  });
});

describe('a floated or absolutely positioned element in running text (#189, #194)', () => {
  it('a floated drop cap stays in its paragraph, and the first word is read whole', () => {
    const blocks = blocksOf('<h2>Chapter One</h2><p><span style="float:left">T</span>he door opened. It was late.</p>');
    expect(blocks.map((b) => [b.role, b.text])).toEqual([['heading', 'Chapter One'], ['paragraph', 'The door opened. It was late.']]);
    expect(segmentDocument(blocks, 'en').map((u) => u.text)).toEqual(['Chapter One', 'The door opened.', 'It was late.']);
  });

  it('Chapter I of the Gutenberg Pride and Prejudice opens with "IT is a truth", as the Document spells it', () => {
    expect(sentencesOf(
      '<h2>Chapter I.</h2><p class="nind"><span class="letra" style="font-size:250%; float:left; margin-top:-1%">I</span>T is a truth universally acknowledged, that a single man in possession of a good fortune must be in want of a wife.</p>',
    )).toEqual(['Chapter I.', 'IT is a truth universally acknowledged, that a single man in possession of a good fortune must be in want of a wife.']);
  });

  it('a floated pull quote and an absolutely positioned page number leave their paragraph one Block, and so one CFI', () => {
    const blocks = blocksOf(
      '<p>First half one. <span style="float:right">A pull quote sits here.</span> Second half one.</p><p>The quick brown <span style="position:absolute">[Pg 12]</span>fox jumps over the dog.</p>',
    );
    expect(blocks.map((b) => [b.role, b.text])).toEqual([
      ['paragraph', 'First half one. A pull quote sits here. Second half one.'],
      ['paragraph', 'The quick brown [Pg 12]fox jumps over the dog.'],
    ]);
  });

  it('control: lines a converted book positions each in an absolute box of its own stay Blocks of their own', () => {
    expect(blocksOf('<div style="position:absolute">It was a dark and</div>\n<div style="position:absolute">stormy night.</div>').map((b) => b.text))
      .toEqual(['It was a dark and', 'stormy night.']);
  });

  it('control: an element in flow that the document sets as a block still ends the paragraph', () => {
    expect(blocksOf('<p>Before <span style="display:block">a line of its own</span> after.</p>').map((b) => b.text))
      .toEqual(['Before ', 'a line of its own', ' after.']);
  });
});

describe('a line break with no white space beside it (#192)', () => {
  it('a two-line heading reaches the Provider with its two lines apart', () => {
    const blocks = blocksOf('<h2 class="heading_2">Chapter 1:<br/><span class="run_3">Nightmare Begins</span></h2>');
    expect(blocks.map((b) => b.text)).toEqual(['Chapter 1:\nNightmare Begins']);
    const [heading] = segmentDocument(blocks, 'en').map((u) => u.text);
    expect(prepareSpeechText(heading, true).text).not.toContain('1:Nightmare');
  });

  it('two lines of verse stay two words where they meet', () => {
    const [block] = blocksOf('<p>Roses are red<br/>violets are blue</p>');
    expect(tokenize(block.text).map((token) => token.key)).toEqual(['roses', 'are', 'red', 'violets', 'are', 'blue']);
  });

  it('a heading whose second line begins with an abbreviation stays one sentence', () => {
    expect(sentencesOf('<h2>Chapter 2512:<br/><span>Dr. Saint</span></h2>')).toEqual(['Chapter 2512:\nDr. Saint']);
  });

  it('a Chinese chapter heading keeps its number and its title apart', () => {
    expect(blocksOf('<h2><span class="num">第<span class="b">9</span>章</span><br/>下崖</h2>').map((b) => b.text)).toEqual(['第9章\n下崖']);
  });

  it('control: where the Document wrote white space beside the break, the text is exactly the Document\'s', () => {
    expect(blocksOf('<p>Roses are red<br/>\nviolets are blue</p><p>Roses are red <br/>violets</p>').map((b) => b.text))
      .toEqual(['Roses are red\nviolets are blue', 'Roses are red violets']);
  });

  it('control: a break at either end of a Block adds nothing', () => {
    expect(blocksOf('<p><br/>Begins</p><p>Ends<br/></p>').map((b) => b.text)).toEqual(['Begins', 'Ends']);
  });

  it('the sentence across the break, and a word after it, are drawn over the text nodes either side', () => {
    const { page, section } = open('<h2>Chapter 1:<br/><span>Nightmare Begins</span></h2>');
    const [block] = page.blocks(section);
    const word = block.text.indexOf('Nightmare');
    page.send({
      kind: 'speak', utterance: 0, reveal: true, durationMs: 60000,
      utteranceRanges: [{ block: block.id, start: 0, end: block.text.length, text: block.text }],
      words: [{ atMs: 0, ranges: [{ block: block.id, start: word, end: word + 'Nightmare'.length, text: 'Nightmare' }] }],
    });
    page.send({ kind: 'correct', utterance: 0, elapsedMs: 0, word: 0, hold: true });
    const registry = [...section.document.defaultView.CSS.highlights.values()] as Set<any>[];
    const drawn = registry.flatMap((highlight) => [...highlight]).map((range) =>
      [range.startContainer.data, range.startOffset, range.endContainer.data, range.endOffset]);
    expect(drawn).toEqual([['Chapter 1:', 0, 'Nightmare Begins', 16], ['Nightmare Begins', 0, 'Nightmare Begins', 9]]);
  });
});

describe('a Download prepares the same Blocks as the Reading', () => {
  it('reports the item and the line break, and so writes the same sentences', async () => {
    const body = '<h2>Chapter 1:<br/>Nightmare Begins</h2><p><span style="float:left">T</span>he list:</p><ul><li>lower cost</li><li>faster startup</li></ul>';
    const { page, section } = open(body);
    const reading = segmentDocument(page.blocks(section), 'en').map((u) => u.text);
    const answer = await page.prepare(3);
    expect(answer.type).toBe('openreader:offline-section');
    const [chapter] = sectionChapters(3, answer.blocks, answer.points, answer.language);
    expect(chapter.texts).toEqual(reading);
    expect(reading).toEqual(['Chapter 1:\nNightmare Begins', 'The list:', 'lower cost', 'faster startup']);
  });
});
