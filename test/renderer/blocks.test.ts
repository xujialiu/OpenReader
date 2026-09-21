import { describe, expect, it } from 'vitest';

import { blockIds, EMPTY_BLOCKS, withSection, type BlockIndex } from '../../src/renderer/blocks';
import { BLOCKS_MESSAGE, type BlocksMessage, type ReportedBlock } from '../../src/renderer/messages';

/**
 * epub.js renders one section at a time, out of order, and more than once.
 *
 * A reader opening at chapter five renders spine item five before items one to
 * four, and pages back through them afterwards; it also destroys and rebuilds a
 * section's iframe as the reader moves. Both are ordinary, and both would corrupt
 * a naive append — `rejoin.ts` reads two adjacent Blocks to decide whether the
 * document's markup cut a sentence, so a reversed pair is a sentence welded to the
 * wrong neighbour.
 */

function block(id: string, text: string, sectionIndex: number): ReportedBlock {
  return { id, text, role: 'paragraph', section: 'c' + sectionIndex + '.xhtml', sectionIndex, cfi: '' };
}

function message(sectionIndex: number, texts: readonly string[]): BlocksMessage {
  return {
    type: BLOCKS_MESSAGE,
    sectionIndex,
    section: 'c' + sectionIndex + '.xhtml',
    blocks: texts.map((text, at) => block(sectionIndex + '.' + at, text, sectionIndex)),
    sizes: null,
  };
}

const texts = (index: BlockIndex): string[] => index.blocks.map((found) => found.text);

describe('withSection', () => {
  it('puts sections in reading order however they arrived', () => {
    let index = withSection(EMPTY_BLOCKS, message(5, ['chapter five']));
    index = withSection(index, message(1, ['chapter one']));
    index = withSection(index, message(3, ['chapter three']));
    expect(texts(index)).toEqual(['chapter one', 'chapter three', 'chapter five']);
  });

  it('replaces a section rather than adding to it when epub.js renders it again', () => {
    let index = withSection(EMPTY_BLOCKS, message(0, ['one', 'two']));
    index = withSection(index, message(0, ['one', 'two', 'three']));
    expect(texts(index)).toEqual(['one', 'two', 'three']);
    expect(index.sections.size).toBe(1);
  });

  it('is unchanged when a re-render found the same Blocks', () => {
    const index = withSection(EMPTY_BLOCKS, message(0, ['one', 'two']));
    // Identity, not equality: this is what stops the book being segmented again
    // every time the reader crosses back into a section. `onBlocks` fires only
    // when the array it would hand over is different.
    expect(withSection(index, message(0, ['one', 'two']))).toBe(index);
  });

  it('notices a re-render whose text changed, even at the same length', () => {
    const index = withSection(EMPTY_BLOCKS, message(0, ['one', 'two']));
    expect(texts(withSection(index, message(0, ['one', 'TWO'])))).toEqual(['one', 'TWO']);
  });

  it('leaves the index it was given alone', () => {
    const first = withSection(EMPTY_BLOCKS, message(0, ['one']));
    withSection(first, message(1, ['two']));
    expect(texts(first)).toEqual(['one']);
    expect(EMPTY_BLOCKS.blocks).toEqual([]);
  });

  it('keeps the ids a re-render produced, so the Utterances stay valid', () => {
    // The ids are the spine index and the ordinal, so the same DOM walked again
    // yields the same ids — which is why a highlight resumes when a section comes
    // back on screen instead of needing the book segmented again.
    const index = withSection(EMPTY_BLOCKS, message(2, ['a', 'b']));
    expect(blockIds(index.blocks)).toEqual(['2.0', '2.1']);
    expect(blockIds(withSection(index, message(2, ['a', 'b'])).blocks)).toEqual(['2.0', '2.1']);
  });
});

describe('blockIds', () => {
  it('is positional, because UtteranceSpan.block is an index into the same array', () => {
    let index = withSection(EMPTY_BLOCKS, message(1, ['one']));
    index = withSection(index, message(0, ['zero a', 'zero b']));
    expect(blockIds(index.blocks)).toEqual(['0.0', '0.1', '1.0']);
  });
});
