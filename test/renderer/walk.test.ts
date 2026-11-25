import { describe, expect, it } from 'vitest';

import { segmentDocument } from '../../src/app/segment';
import { tokenize } from '../../src/core/align';
import { prepareSpeechText } from '../../src/core/speech-text';
import { sectionChapters } from '../../src/offline/model';
import { utteranceAt } from '../../src/renderer/cursor';
import { TAP_MESSAGE } from '../../src/renderer/messages';

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

  it.each(['float:left', 'position:absolute'])('reads and downloads a wrapped initial as part of its word (%s)', async (style) => {
    const { page, section } = open(`<p><b><a><span style="${style}">T</span></a></b><em>he door opened.</em></p>`);
    expect(segmentDocument(page.blocks(section), 'en').map(u => u.text)).toEqual(['The door opened.']);
    const prepared = await page.prepare(3);
    expect(sectionChapters(3, prepared.blocks, [], 'en')[0].texts).toEqual(['The door opened.']);
  });

  it('keeps wrapped positioned lines separate when the only text belongs to those lines', () => {
    const html = '<p>Before.</p><div><b><span style="float:left">First.</span></b>' +
      '<em><span style="float:left">Second.</span></em></div><p>After.</p>';
    expect(blocksOf(html).map(b => b.text)).toEqual(['Before.', 'First.', 'Second.', 'After.']);
  });

  it.each(['position:absolute', 'float:left'])('reads only a linear number of styles for independent lines (%s)', async (style) => {
    const size = 200;
    const body = Array.from({ length: size }, (_, i) => `<div style="${style}">Line ${i}.</div>`).join('');
    const page = standInPage();
    const section = page.addSection(3, body);
    const win = section.document.defaultView;
    const computed = win.getComputedStyle;
    let reads = 0;
    win.getComputedStyle = (element: unknown) => { reads++; return computed(element); };
    page.sweep();
    expect(page.blocks(section)).toHaveLength(size);
    expect(reads).toBeLessThan(8 * size);
    reads = 0;
    expect((await page.prepare(3)).blocks).toHaveLength(size);
    expect(reads).toBeLessThan(8 * size);
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

describe('a bilingual phrasebook entry (#380)', () => {
  const example = 'It took me a while to adapt to the new schedule.';
  const translation = '我花了一段时间才适应新日程。';
  const body = `<p><strong>adapt to</strong> 适应<br/>\n<strong>${example}</strong><br/>\n${translation}</p>`;

  it.each([
    { term: 'account for', gloss: '解释，说明', sentence: 'You need to account for every expense in your report.', translated: undefined },
    { term: 'include in', gloss: '包含', sentence: 'Please include me in the email list.', translated: '请将我加入邮件列表。' },
  ])('reads and downloads the example for "$term" independently', async ({ term, gloss, sentence, translated }) => {
    const lines = [`<strong>${term}</strong> ${gloss}`, `<strong>${sentence}</strong>`];
    const expected = [`${term} ${gloss}`, sentence];
    if (translated) {
      lines.push(translated);
      expected.push(translated);
    }
    const { page, section } = open(`<p>${lines.join('<br/>\n')}</p>`);
    const blocks = page.blocks(section);
    const utterances = segmentDocument(blocks, 'zh-CN');
    expect(utterances.map((u) => u.text)).toEqual(expected);
    page.click(section, section.document.getElementsByTagName('strong')[1]);
    const tap = page.posted.find((message) => message.type === TAP_MESSAGE)!;
    const at = utteranceAt(utterances, blocks.map((block) => block.id), tap.block, tap.offset);
    expect(utterances[at!].text).toBe(sentence);
    const start = blocks[0].text.indexOf(sentence);
    expect(utterances[at!].spans).toEqual([{ block: 0, start, end: start + sentence.length, textOffset: 0 }]);

    const prepared = await page.prepare(3);
    const [chapter] = sectionChapters(3, prepared.blocks, prepared.points, 'zh-CN');
    expect(chapter.texts).toEqual(expected);
  });

  it('keeps the line breaks of ordinary prose, verse and headings as whitespace', () => {
    expect(sentencesOf('<p>He walked<br/>home.</p>')).toEqual(['He walked\nhome.']);
    expect(sentencesOf('<p>Across the hill<br/>under the sky<br/>and home.</p>'))
      .toEqual(['Across the hill\nunder the sky\nand home.']);
    expect(sentencesOf('<h2>adapt to 适应<br/>An example<br/>中文</h2>'))
      .toEqual(['adapt to 适应\nAn example\n中文']);
    expect(sentencesOf('<p>adapt to 适应\nAn example\n中文</p>'))
      .toEqual(['adapt to 适应\nAn example\n中文']);
    expect(sentencesOf('<p>account for 解释，说明\nAn example.</p>'))
      .toEqual(['account for 解释，说明\nAn example.']);
    expect(sentencesOf('<p>include in 包含<br/>在名单中。</p>'))
      .toEqual(['include in 包含\n在名单中。']);
    expect(sentencesOf('<p>include in 包含<br/>An example<br/>continued here.</p>'))
      .toEqual(['include in 包含\nAn example\ncontinued here.']);
  });

  it('keeps the entry apart from a preceding unfinished paragraph, including a repeated example', () => {
    const { page, section } = open('<p>A section label</p>' + body + body);
    page.click(section, section.document.getElementsByTagName('strong')[3]);
    const tap = page.posted.find((message) => message.type === TAP_MESSAGE)!;
    const blocks = page.blocks(section);
    const utterances = segmentDocument(blocks, 'zh-CN');
    const at = utteranceAt(utterances, blocks.map((block) => block.id), tap.block, tap.offset);
    expect(utterances.map((u) => u.text)).toEqual(['A section label', 'adapt to 适应', example, translation, 'adapt to 适应', example, translation]);
    const offset = blocks[2].text.indexOf(example);
    expect(utterances[at!].spans).toEqual([{ block: 2, start: offset, end: offset + example.length, textOffset: 0 }]);
  });

  it('keeps numbered vocabulary entries whole and finds boundaries without bold markup', () => {
    expect(sentencesOf('<p>2. Act up 捣乱<br/>It happened. Again!<br/>又发生了。</p>'))
      .toEqual(['2. Act up 捣乱', 'It happened.', 'Again!', '又发生了。']);
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
