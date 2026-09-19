/**
 * Blocks into Utterances, and the two questions that come with doing it more
 * than once.
 *
 * This is where the sentence splitter is bound. `core/segmenter/index.ts` takes
 * `splitSentences` as an argument and deliberately names no package — ADR 0006
 * calls upstream `sentencex` "the first segmenter here, not the final one", so
 * replacing it should be rewiring one call site rather than editing that
 * directory. This is that call site, and there is exactly one.
 *
 * Platform-free, like `settings.ts` beside it, and for the same reason: what it
 * decides is testable and what the renderer does with the result is not.
 */

import { segmentBlocks, type Block, type Utterance } from '../core/segmenter';
import { splitWithSentencex } from '../core/segmenter/sentencex';

/**
 * The Utterances of every Block the renderer has reported, in reading order.
 *
 * `language` is the document's own and is never sniffed (ADR 0006 keeps a
 * language detector and its two megabytes out; ADR 0010 accepts the consequence
 * that a document with two languages in it is read in its one Voice).
 */
export function segmentDocument(blocks: readonly Block[], language: string): Utterance[] {
  return segmentBlocks(blocks, language, { splitSentences: splitWithSentencex });
}

/**
 * The language a document is segmented in, and whether the document said so.
 *
 * An EPUB's `dc:language` is what epub.js reports as its metadata's `language`,
 * and plenty of real EPUBs carry none. The fallback is English because that is
 * where upstream `sentencex` ends up anyway — `fallbacks.json`, then English —
 * so pretending otherwise would change nothing but the label. What is not done
 * is guessing from the text: `declared: false` is shown to the owner instead,
 * which is philosophy rule 1 applied to something small.
 */
export function documentLanguage(declared: string | null | undefined): { language: string; declared: boolean } {
  const language = (declared ?? '').trim();
  return language ? { language, declared: true } : { language: 'en', declared: false };
}

/** The one thing this file needs of a reported Block: which spine item it came from. Structural, so a `ReportedBlock` goes straight in and nothing here imports the renderer. */
export interface SectionedBlock {
  sectionIndex: number;
}

/**
 * The first Utterance of a spine item, or null when it has none.
 *
 * The second half of a contents tap (ADR 0020). `goToSection` moves the **page**
 * and nothing else; seeking the reading to that chapter can only happen once the
 * section has rendered and reported its Blocks, because until then the section
 * contributes no Utterance and there is no index to seek to. So a contents tap is
 * two steps, and this is what the second one needs.
 *
 * The **first span's** Block decides which section an Utterance belongs to, and
 * that is unambiguous rather than a choice: `rejoin.ts` refuses to weld two Blocks
 * from different sections, so every Utterance lies entirely within one.
 *
 * Null is ordinary and not a failure. A volume's title page is a real destination
 * with no text on it — the owner's book puts one at the start of each of its
 * thirteen volumes — and a cover page is a `<svg><image/></svg>`. The page has
 * still moved there, which is what the tap asked for.
 */
export function firstUtteranceOfSection(
  utterances: readonly Utterance[],
  blocks: readonly SectionedBlock[],
  section: number,
): number | null {
  for (let at = 0; at < utterances.length; at++) {
    const span = utterances[at].spans[0];
    if (span && blocks[span.block]?.sectionIndex === section) return at;
  }
  return null;
}

/**
 * Whether `next` continues `loaded` rather than renumbering it.
 *
 * The renderer reports its Blocks again, in full, every time epub.js renders a
 * section it has not seen (`blocks.ts`), so the Utterance list grows while the
 * reading is under way. An Utterance is identified to the engine by its **index**
 * — `PlaybackSnapshot.utterance`, `ClipCue.utterance`, `seek(utterance)` — and
 * sections do not render in reading order: a jump to chapter five renders five
 * before one, and when one arrives it is *prepended*. Every index the engine and
 * the WebView are holding would then mean a different sentence, which is drift of
 * the worst kind: silent, and about position rather than time.
 *
 * So the prefix is compared before the longer list is trusted. Text, not object
 * identity — the list is built again from scratch each time — and the same
 * principle as ADR 0008's text anchor: the text is what says whether two
 * locators mean the same place.
 */
export function samePrefix(loaded: readonly Utterance[], next: readonly Utterance[]): boolean {
  if (next.length < loaded.length) return false;
  for (let at = 0; at < loaded.length; at++) {
    if (next[at].text !== loaded[at].text) return false;
  }
  return true;
}
