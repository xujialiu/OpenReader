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

/** Whether the reading stopped because the book ended, and what the owner is told either way. */
export interface OutOfText {
  /** True when the furthest section the renderer has reported is the document's last spine item. */
  ended: boolean;
  sentence: string;
}

/**
 * The Utterances the engine was given and never spoke, which is the difference
 * between a book that finished and a Provider that stopped answering.
 *
 * Both fields come from the engine's own bookkeeping (`OutOfTextReport`): it is
 * the only thing that knows a Clip was refused, and the app is the only thing
 * that can say so.
 */
export interface Unspoken {
  /** How many Utterances were never spoken since the reading was last pointed somewhere. */
  count: number;
  /** What the last refusal said, in its own words, or null when nothing kept it. */
  reason: string | null;
}

/** Nothing was lost: the ordinary exhaustion, and the default so that a caller with nothing to report says nothing. */
const NOTHING_UNSPOKEN: Unspoken = { count: 0, reason: null };

/**
 * The engine has spoken every Utterance it was given: which of the **three**
 * things that is, and how to say it.
 *
 * They are not the same event and must not share a sentence. Reaching the last
 * spine item is a **book that has finished**, and the reading stops there because
 * nothing more is coming. Running out anywhere else is the reading having
 * outpaced what the document has rendered — the defect of 2026-09-20 04:43 — and
 * there the reading is left running, because the engine picks up by itself the
 * moment another section reports (notes/NOTES.md footgun 3, and the engine's
 * `extend`).
 *
 * **And running out with Utterances that were never spoken is neither of those.**
 * A Clip the Provider refused leaves no trace in any of `hasRunOut`'s four
 * conditions — it is not in flight, it is stepped over, and the queue empties
 * behind it — so a run of failures at the end of a document reached this function
 * as a finished book and was announced as one: "That was the last of this
 * document", said to an owner whose Fish Audio had lost the network for the last
 * clips (notes/NOTES_2026-09-20.md, 07:48). Design 0023 names that exact lie as
 * worse than the silence it replaced, so it gets the third sentence rather than a
 * fifth condition: the sentence says the reading stopped because something failed,
 * and what failed.
 *
 * `ended` is unchanged by a failure, and deliberately: it decides whether the
 * engine is paused, and at the last spine item there is nothing left to resume for
 * whatever the reason. Before it, more text is still coming and the reading is
 * still waiting for it — the failures are behind the cursor either way.
 *
 * `furthest` is the **furthest** section that has reported, not the last one to
 * report: sections render out of order, so the last to report is routinely behind.
 * A spine of zero is a document that has not said how long it is yet, and that is
 * never the end of a book.
 */
export function outOfTextSentence(furthest: number, spine: number, unspoken: Unspoken = NOTHING_UNSPOKEN): OutOfText {
  const ended = spine > 0 && furthest >= spine - 1;
  if (unspoken.count > 0) {
    const many = unspoken.count === 1;
    return {
      ended,
      sentence:
        `${many ? 'One Utterance was' : `${unspoken.count} Utterances were`} never spoken, because synthesis failed` +
        `${unspoken.reason ? `: ${fullStop(unspoken.reason)}` : '.'} ` +
        (ended
          ? 'The reading has stopped here for that reason and not at the end of the book. '
          : 'The reading has run out of the text this document has reported and is waiting for more of it. ') +
        `Going back to ${many ? 'it' : 'them'} is how ${many ? 'it is' : 'they are'} asked for again; ` +
        'nothing is retried out of sight.',
    };
  }
  return {
    ended,
    sentence: ended
      ? 'That was the last of this document. The reading has stopped at the end of the book.'
      : 'The reading has reached the end of the text this document has reported and is waiting for more of it. ' +
        'It carries on by itself the moment another section arrives.',
  };
}

/**
 * A refusal's own words, ending in something a sentence can follow.
 *
 * Providers are inconsistent about the full stop — `SynthesisError`'s messages end
 * in a question mark, a period or neither — and the sentence above continues after
 * this one, so without it two sentences run together.
 */
function fullStop(said: string): string {
  const trimmed = said.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
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
