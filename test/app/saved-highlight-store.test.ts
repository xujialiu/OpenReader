import { expect, it } from 'vitest';
import { clearDocumentHighlights, colourHighlight, highlightDeletionNotice, moveHighlight, readHighlights, removeHighlights, restoreHighlight, saveHighlight } from '../../src/app/saved-highlight-store';

it('preserves exact excerpts, reading order and overlap identity across undo, removal and reimport', () => {
  const cloud = { section: 1, cfi: 'range-b', text: 'cloud soil', block: 3, offset: 6, endBlock: 3 };
  const later = saveHighlight('book', cloud, 'Clouds', 'chapter-1');
  expect(readHighlights('book')[0].colour).toBe('yellow');
  colourHighlight('book', later, 'green');
  const earlier = saveHighlight('book', { ...cloud, cfi: 'range-a', text: 'white cloud', offset: 0 }, 'Clouds', 'chapter-1');
  expect(saveHighlight('book', cloud, 'Clouds', 'chapter-1')).toBe(later);
  const both = readHighlights('book');
  expect(both.map((one) => [one.id, one.colour])).toEqual([[earlier, 'green'], [later, 'green']]);
  saveHighlight('another', cloud, 'Clouds', 'chapter-1');
  expect(highlightDeletionNotice(['book', 'another'])).toContain('3 saved highlights');
  removeHighlights('book', [earlier]);
  restoreHighlight('book', both[0]);
  expect(readHighlights('book')).toEqual(both);
  removeHighlights('book', [earlier, later]);
  expect(readHighlights('book')).toEqual([]);
  clearDocumentHighlights('another');
  expect(readHighlights('another')).toEqual([]);
});

it('moves the edited mark, merging an exact collision with its own colour and identity', () => {
  const a = { section: 0, cfi: 'a', text: 'white cloud', block: 0, offset: 0, endBlock: 0 };
  const b = { ...a, cfi: 'b', text: 'cloud soil', offset: 6 };
  const id = saveHighlight('move', a, 'One', 'one', 'pink');
  saveHighlight('move', b, 'One', 'one', 'blue');
  const elsewhere = saveHighlight('other', b, 'One', 'one', 'green');
  moveHighlight('move', id, b, 'One', 'one');
  expect(readHighlights('move')).toEqual([{ ...b, id, document: 'move', chapter: 'One', chapterKey: 'one', colour: 'pink' }]);
  expect(readHighlights('other')[0]).toMatchObject({ id: elsewhere, colour: 'green' });
  removeHighlights('move', [id]);
  saveHighlight('move', b, 'One', 'one', 'purple');
  expect(readHighlights('move')[0].colour).toBe('purple');
});
