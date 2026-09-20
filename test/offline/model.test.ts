import { expect, it } from 'vitest';
import { descendants, sectionChapters } from '../../src/offline/model';
import { segmentBlocks, type Block } from '../../src/core/segmenter';
import { splitWithSentencex } from '../../src/core/segmenter/sentencex';

it('covers unlisted text and keeps shared-file chapter boundaries without changing utterance text', () => {
  const blocks: Block[] = [
    { text: 'Unlisted preface.', role: 'paragraph', section: 'one' },
    { text: 'Chapter one', role: 'heading', section: 'one' },
    { text: 'This is a', role: 'paragraph', section: 'one' },
    { text: 'continued sentence.', role: 'paragraph', section: 'one' },
    { text: 'Second chapter.', role: 'heading', section: 'one' },
  ];
  const chapters = sectionChapters(0, blocks, [
    { id: 'c1', title: 'One', depth: 0, parent: null, block: 1 },
    { id: 'c2', title: 'Two', depth: 0, parent: null, block: 4 },
  ], 'en');
  expect(chapters.map((c) => c.title)).toEqual(['Part 1', 'One', 'Two']);
  expect(chapters.flatMap((c) => c.texts)).toEqual(segmentBlocks(blocks, 'en', { splitSentences: splitWithSentencex }).filter((u) => u.speakable).map((u) => u.text));
});
it('selects a volume and nested descendants, but not sibling volumes or empty headings', () => {
  const chapters = [
    { id: 'v', title: 'Volume', depth: 0, parent: null, texts: [] },
    { id: 'c', title: 'Chapter', depth: 1, parent: 'v', texts: ['Hi.'] },
    { id: 's', title: 'Section', depth: 2, parent: 'c', texts: ['There.'] },
    { id: 'other', title: 'Other', depth: 0, parent: null, texts: ['Outside.'] },
  ];
  expect(descendants(chapters, 'v').map((c) => c.id)).toEqual(['c', 's']);
});
