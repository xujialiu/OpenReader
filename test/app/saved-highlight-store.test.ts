import { expect, it } from 'vitest';
import { clearDocumentHighlights, colourHighlight, highlightDeletionNotice, readHighlights, removeHighlights, restoreHighlight, saveHighlight } from '../../src/app/saved-highlight-store';

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
