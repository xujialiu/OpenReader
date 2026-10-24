import { describe, expect, it } from 'vitest';
import { SELECTION_MESSAGE } from '../../src/renderer/messages';
import { standInPage } from './stand-in-page';

/** The real page program, not a reimplementation of its word classifier. */
function selections(...texts: string[]) {
  const page = standInPage();
  const first = page.addSection(6, '<p>Some selectable words here.</p>');
  const second = page.addSection(8, '<p>Another paragraph entirely.</p>');
  page.sweep();
  page.send({ kind: 'lookup', enabled: true });
  for (const text of texts) page.select(first, text);
  return {
    page, second,
    modes: () => page.posted.filter((m) => m.type === SELECTION_MESSAGE).map((m) => m.multipleWords),
  };
}

describe('selection word boundaries (#323, #274)', () => {
  it('a new word with the Drawer still open is not a multiword expansion', () => {
    const { modes } = selections('selectable', 'words');
    expect(modes()).toEqual([false, false, false, false]);
  });

  it('a word in another section is also a fresh single word', () => {
    const { page, second, modes } = selections('selectable');
    page.select(second, 'Another');
    expect(modes()).toEqual([false, false, false, false]);
  });

  it('expanding then shrinking uses the current words, not drag history', () => {
    const { modes } = selections('give', 'give up', 'give');
    expect(modes()).toEqual([false, false, true, true, false, false]);
  });

  it.each(['give up', '学习语言', 'word,word', 'two\nwords'])('an initial multiword selection %s is Translation', (text) => {
    expect(selections(text).modes()).toEqual([true, true]);
  });

  it.each(['“word,”', "don't", 'reader’s', 'well-known', 'well\u2011known', '学习', 'iv'])('a single word %s stays single after the selection changes', (text) => {
    expect(selections('other', text).modes()).toEqual([false, false, false, false]);
  });

  it.each(['word - word', 'word—word', 'word … word'])('separated words %s are not a hyphenated compound', (text) => {
    expect(selections(text).modes()).toEqual([true, true]);
  });
});
