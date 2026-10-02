import { describe, expect, it } from 'vitest';

import { contrast } from '../../src/app/accent';
import { HIGHLIGHT_PAGE, paintOver, sentencePaint, wordPaint } from '../../src/app/highlight-paint';
import { HIGHLIGHT_PRESETS } from '../../src/renderer/highlight-colours';

/**
 * Appearance's Highlight section shows the Highlight Colours as the page
 * paints them (#118): each level at its opacity over what is under it, the
 * word over the sentence over the page.
 */
describe("the Highlight section's sample of the page (#118)", () => {
  it('lays a level over the page at its opacity', () => {
    expect(paintOver('#ffffff', HIGHLIGHT_PRESETS.blue.word)).toBe('#b7c1f4');
    expect(paintOver('#111114', { color: '#ffffff', opacity: 50 })).toBe('#88888a');
  });

  it('shows the page alone at 0 % and the colour alone at 100 %', () => {
    expect(paintOver('#111114', { color: '#4456de', opacity: 0 })).toBe('#111114');
    expect(paintOver('#ffffff', { color: '#4456de', opacity: 100 })).toBe('#4456de');
  });

  it('marks the word over its sentence, and the sentence over the page', () => {
    const colours = HIGHLIGHT_PRESETS.amber;
    for (const { page } of Object.values(HIGHLIGHT_PAGE)) {
      expect(sentencePaint(page, colours)).toBe(paintOver(page, colours.sentence));
      expect(wordPaint(page, colours)).toBe(paintOver(paintOver(page, colours.sentence), colours.word));
    }
  });

  it.each([
    ['blue', 'light', '#daddec', '#a3aee9'],
    ['blue', 'dark', '#212335', '#3b4683'],
    ['amber', 'light', '#faf0db', '#edcd95'],
    ['amber', 'dark', '#372d1a', '#75541e'],
  ] as const)('%s on %s keeps text readable on both nested marks (#126)', (preset, scheme, sentence, word) => {
    const { page, text } = HIGHLIGHT_PAGE[scheme];
    const colours = HIGHLIGHT_PRESETS[preset];
    expect(sentencePaint(page, colours)).toBe(sentence);
    expect(wordPaint(page, colours)).toBe(word);
    expect(contrast(text, sentence)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(text, word)).toBeGreaterThanOrEqual(4.5);
  });

  it('is the reader\'s own page: white with black text, and #111114 with #e6e6ea', () => {
    expect(HIGHLIGHT_PAGE).toEqual({ light: { page: '#ffffff', text: '#000000' }, dark: { page: '#111114', text: '#e6e6ea' } });
  });
});
