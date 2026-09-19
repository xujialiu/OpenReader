/**
 * The Blocks the WebView has reported, in reading order.
 *
 * epub.js renders one section at a time and does not render them in order: a
 * reader opening at chapter five renders spine item five before items one to
 * four, and pages back through them afterwards. It also destroys and rebuilds a
 * section's iframe as the reader moves, so the same section is reported more than
 * once. Both of those are ordinary, and both would corrupt a naive append.
 *
 * So this file is small and it is pure, and it holds the two properties the rest
 * of the directory depends on:
 *
 * - **Reading order.** Sections are kept by spine index and concatenated in it,
 *   whatever order they arrived in. `rejoin.ts` reads two adjacent Blocks to
 *   decide whether the document's markup cut a sentence, so a reversed pair is a
 *   sentence welded to the wrong neighbour.
 * - **Re-rendering replaces.** A section reported again replaces its Blocks
 *   rather than adding to them, and the ids are the same, so the Utterances
 *   already segmented from it stay valid and the highlight resumes when the
 *   section comes back on screen.
 *
 * What it deliberately does not do is renumber anything. `UtteranceSpan.block` is
 * an index into the Block array that was segmented, and that array is handed back
 * to the bridge with the Utterances (`setUtterances`) so the two are always the
 * same array. Ids, not indices, cross the bridge.
 */

import type { BlocksMessage, ReportedBlock } from './messages';

/** Every Block reported so far, and the sections they came from. Treat it as a value: `withSection` returns a new one. */
export interface BlockIndex {
  /** Keyed by spine index. */
  sections: ReadonlyMap<number, readonly ReportedBlock[]>;
  /** Every Block, in reading order. This is the array `UtteranceSpan.block` indexes into. */
  blocks: readonly ReportedBlock[];
}

export const EMPTY_BLOCKS: BlockIndex = { sections: new Map(), blocks: [] };

/**
 * The index with one section's Blocks replaced by the ones just reported.
 *
 * Returns the index unchanged when the message would change nothing — the same
 * section reported again with the same Blocks, which is what happens every time
 * the reader crosses back into a section epub.js had destroyed. That is not an
 * optimisation: `onBlocks` is what tells the app to segment the document again,
 * and re-segmenting a whole book for a section that has not changed would be the
 * renderer's most expensive habit.
 */
export function withSection(index: BlockIndex, message: BlocksMessage): BlockIndex {
  const existing = index.sections.get(message.sectionIndex);
  if (existing && sameBlocks(existing, message.blocks)) return index;
  const sections = new Map(index.sections);
  sections.set(message.sectionIndex, message.blocks);
  const order = [...sections.keys()].sort((a, b) => a - b);
  const blocks: ReportedBlock[] = [];
  for (const section of order) blocks.push(...sections.get(section)!);
  return { sections, blocks };
}

function sameBlocks(a: readonly ReportedBlock[], b: readonly ReportedBlock[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((block, at) => block.id === b[at].id && block.text === b[at].text);
}

/** The ids, positionally — what `cursor.ts` turns `UtteranceSpan.block` into so that an index never crosses the bridge. */
export function blockIds(blocks: readonly ReportedBlock[]): string[] {
  return blocks.map((block) => block.id);
}
