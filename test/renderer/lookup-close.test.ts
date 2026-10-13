import { describe, expect, it } from 'vitest';

import { PROBLEM_MESSAGE, SELECTION_MESSAGE } from '../../src/renderer/messages';

import { standInPage } from './stand-in-page';

/**
 * **A lookup closed after its section is gone (#193).**
 *
 * At the Drawer Height the page above the lookup Drawer still answers a finger,
 * so the chapter holding the looked-up word can be scrolled far enough off the
 * page for epub.js to destroy its view. WebKit then answers that document's
 * `getSelection()` with null (measured in a WKWebView for #193), and the close
 * must still finish: no problem reported, the page brought back to the sentence
 * being read, and the next word looked up rather than translated.
 *
 * Run over the real page program; see `stand-in-page.ts` for what is doubled.
 */

function run(destroyed: boolean) {
  const page = standInPage();
  const first = page.addSection(6, '<p>Some selectable words here.</p>');
  const second = page.addSection(8, '<p>Another paragraph entirely.</p>');
  page.sweep();
  const block = page.blocks(first)[0];
  page.send({ kind: 'speak', utterance: 0, utteranceRanges: [{ block: block.id, start: 0, end: block.text.length, text: block.text }], words: null, durationMs: 60000, reveal: true });
  page.send({ kind: 'lookup', enabled: true });
  page.select(first, 'selectable');
  if (destroyed) page.destroy(first);
  const shown = page.displays.length;
  page.send({ kind: 'lookup', close: true, resumeFollow: true });
  const problems = page.posted.filter((m) => m.type === PROBLEM_MESSAGE).map((m) => m.detail);
  const displayed = page.displays.slice(shown);
  const before = page.posted.length;
  page.select(second, 'Another');
  const next = page.posted.slice(before).filter((m) => m.type === SELECTION_MESSAGE).map((m) => m.expanded);
  return { problems, displayed, next };
}

describe('closing a lookup', () => {
  it('while the word’s section is still on the page reports nothing and brings nothing back', () => {
    expect(run(false)).toEqual({ problems: [], displayed: [], next: [false, false] });
  });

  it('after the word’s section was destroyed reports no problem', () => {
    expect(run(true).problems).toEqual([]);
  });

  it('after the word’s section was destroyed asks for the sentence being read, to bring the page back to it', () => {
    expect(run(true).displayed).toEqual(['epubcfi(/6/6!/4)']);
  });

  it('after the word’s section was destroyed takes the next first selection as not expanded', () => {
    expect(run(true).next).toEqual([false, false]);
  });
});
