/**
 * The protocol between the two halves of this directory.
 *
 * Nothing in the type system distinguishes React Native code from code that runs
 * in Safari's JavaScript, which is why `README.md` insists the two halves live in
 * separate files. This file is the third thing: the shapes that cross between
 * them, belonging to neither side and imported by both — `reader-bridge.ts`
 * builds them, `highlighter.ts` consumes them, and the tests can read them
 * without a DOM.
 *
 * Two directions, and the asymmetry is the point:
 *
 * - **Out** (React Native → WebView, by `injectJavascript`): the whole Word
 *   Timing array **once** when a Clip starts, then one position correction
 *   **about once a second**. Never one message per word: `postMessage` into a
 *   WebView is a script injection and an `eval` per message, and at three to five
 *   words a second that is the wrong mechanism (ADR 0005).
 * - **In** (WebView → React Native, by `postMessage`): the Blocks of a section
 *   as epub.js renders it, and a problem where a highlight could not be drawn.
 *   Both are rare — one per rendered section, and one only when something is
 *   wrong.
 *
 * Every offset here is a **UTF-16 code-unit offset into one Block's own text**.
 * That is the coordinate system `core/segmenter/` already works in, and the
 * conversion out of a Word Timing's own coordinate system (offsets into the
 * Utterance's text) happens in `cursor.ts`, on this side of the bridge, once per
 * Clip. Doing it on the far side is how the two halves start to disagree.
 */

import type { Block, BlockRole } from '../core/segmenter';

/** The `type` of the Blocks message. Must not collide with `@epubjs-react-native/core`'s own `internalEvents`, or `View.js` swallows it instead of forwarding it to `onWebViewMessage`. */
export const BLOCKS_MESSAGE = 'ownreader:blocks';

/** The `type` of the problem message. Same constraint. */
export const PROBLEM_MESSAGE = 'ownreader:problem';

/**
 * A **Block** as the WebView found it in the rendered document.
 *
 * `text` is the **verbatim** concatenation of the Block's text nodes — no
 * collapsed whitespace, no normalisation. That is load-bearing rather than lazy:
 * an offset into this text is turned back into a DOM `Range` by walking the same
 * text nodes, so any rewriting here would break the one mapping that must not
 * drift. It also means an Utterance can contain the source file's newlines and
 * indentation, which a Provider speaks without noticing.
 */
export interface ReportedBlock extends Block {
  /**
   * Stable across re-renders of the same section: the spine index and the
   * Block's ordinal within it. epub.js destroys and rebuilds a section's iframe
   * as the reader pages through, so a DOM node reference would go stale while an
   * id survives — the Utterances segmented from these Blocks stay valid and the
   * highlight resumes when the section comes back.
   */
  id: string;
  /** What the document presents this Block as. Only `rejoin.ts` reads it, and `other` makes it refuse, which is the safe direction. */
  role: BlockRole;
  /** The spine item's href. `rejoin.ts` never joins two Blocks from different sections. */
  section: string;
  /** The spine index, which is what puts sections in reading order when they render out of it (a jump to chapter 5 renders section 5 first). */
  sectionIndex: number;
  /**
   * The Block's own CFI, in epub.js's dialect (ADR 0011), for a Reading Position.
   *
   * An **element** CFI, deliberately without a text step: ADR 0008 records that
   * Zotero's CFI generator and resolver disagree about text steps, which is why
   * the desktop plugin never generates a CFI of its own. An element step is the
   * part of the dialect both sides agree on, and ADR 0008's text anchor is what
   * finds the Utterance inside the Block.
   */
  cfi: string;
}

/** One rendered section's Blocks, in the order the document presents them. Sent again for the same section when epub.js re-renders it. */
export interface BlocksMessage {
  type: typeof BLOCKS_MESSAGE;
  sectionIndex: number;
  /** The spine item's href. */
  section: string;
  blocks: ReportedBlock[];
}

/**
 * A highlight that could not be drawn, reported rather than guessed at.
 *
 * Philosophy rule 1 forbids estimating; the same rule applies to a `Range` whose
 * text no longer matches what was asked for. A highlight silently landing on the
 * wrong words is the defect this whole module exists to prevent, so the
 * disagreement is reported and the highlight is cleared.
 */
export interface ProblemMessage {
  type: typeof PROBLEM_MESSAGE;
  /** The Utterance being spoken when it happened, or -1 if there was none. */
  utterance: number;
  /** What could not be done, in words fit for a debug view. */
  detail: string;
}

export type WebViewMessage = BlocksMessage | ProblemMessage;

/** A half-open range of one Block's own text, in UTF-16 code units. */
export interface BlockRange {
  /** `ReportedBlock.id`, not an index. An index would be a second numbering to keep in step across a bridge. */
  block: string;
  start: number;
  end: number;
}

/** A `BlockRange` carrying the text it must contain, so the WebView can refuse to highlight a Block whose text has moved under it (ADR 0008: text is the arbiter of whether a locator is correct). */
export interface AnchoredRange extends BlockRange {
  text: string;
}

/**
 * One Word Timing, in the units and the coordinate system the WebView works in.
 *
 * `atMs` is heard milliseconds from the start of the Clip's speech. The timings
 * arrived already scaled for the playback rate — `rate.ts` did it, once per Clip
 * — so there is no rate in this file and nothing here divides by one. Scaling
 * twice is, in ADR 0005's words, the single easiest way to reintroduce drift.
 */
export interface WordCue {
  atMs: number;
  /**
   * The Block ranges this word covers.
   *
   * **Empty means "leave the highlight where it is"**, not "clear it". A word can
   * fall entirely on text that is in the Utterance and in no Block — the space
   * `rejoin.ts` inserts between two Blocks it read as one — and blinking the
   * highlight off for it would be a worse lie than holding it.
   */
  ranges: BlockRange[];
}

/**
 * A Clip has started: the whole Word Timing array, once (ADR 0005).
 *
 * It carries no position, exactly as `ClipCue` carries none — at the moment a
 * Clip starts its offset is zero. Where the engine sends a cue mid-Clip (a rate
 * change, or a boundary event it missed) it sends a correction in the same turn,
 * so the interpolation is anchored before the next frame is painted.
 */
export interface SpeakMessage {
  kind: 'speak';
  /** Which Utterance, as the engine numbers them. Echoed in corrections, so a correction for another Utterance is recognisable as a missed cue. */
  utterance: number;
  /**
   * Every Block range the Utterance covers.
   *
   * This is the **utterance-level Highlight Level** (ADR 0005) and it is always
   * drawn: the word highlight rides on top of it. When `words` is null it is the
   * only highlight there is.
   */
  utteranceRanges: AnchoredRange[];
  /**
   * One entry per Word Timing, in the order the Provider reported them.
   *
   * `null` means the Provider reported none, so the Utterance is highlighted
   * whole. Never a partial array, never an estimate (philosophy rule 1) — ADR
   * 0005's matrix names Azure and OpenAI as the Providers this costs.
   */
  words: WordCue[] | null;
  /** How long the speech lasts as it will be heard. The interpolation is clamped to it, because the gap that follows belongs to the pause and not to the words. */
  durationMs: number;
  /** Bring the spoken text into view if it is not on the page. Once per Utterance, never per word: paginating is not frame-path work. */
  reveal: boolean;
}

/**
 * Where the reading is, about once a second — the cadence ADR 0005 chose.
 *
 * This is the only message that carries a position, and it is authoritative: the
 * WebView sets its interpolation epoch from it and takes `word` as the truth,
 * rather than trusting what it had reached on its own.
 */
export interface CorrectMessage {
  kind: 'correct';
  utterance: number;
  /** Heard milliseconds since this Clip's speech began, clamped to `durationMs`. */
  elapsedMs: number;
  /** Which entry of `words` the highlight belongs on, -1 for none yet. See `cursor.ts`'s `wordIndexAt` — it is the same forward scan the WebView runs between corrections, so the two cannot disagree. */
  word: number;
  /** True while the position is inside the gap after the speech (`gap.ts`): the last word stays highlighted and nothing advances. */
  hold: boolean;
}

/**
 * Stop interpolating and stay where you are.
 *
 * Not a third `ReaderClock` message — that interface has two methods and
 * deliberately no third. This one is sent by whoever pauses the engine, because
 * a pause simply stops the position stream, and a WebView still interpolating
 * against `requestAnimationFrame` would run the highlight ahead of silence.
 * Frozen and up to a second late is strictly better than ahead: the reader can
 * see it is waiting, where a highlight ahead of the voice is the drift this
 * project exists to prevent.
 */
export interface HoldMessage {
  kind: 'hold';
}

/** Nothing is being read. Both highlights go. */
export interface ClearMessage {
  kind: 'clear';
}

export type HighlightMessage = SpeakMessage | CorrectMessage | HoldMessage | ClearMessage;
