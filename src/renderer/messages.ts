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
export const BLOCKS_MESSAGE = 'openreader:blocks';

/** The `type` of the problem message. Same constraint. */
export const PROBLEM_MESSAGE = 'openreader:problem';

/** The `type` of the document message. Same constraint. */
export const DOCUMENT_MESSAGE = 'openreader:document';

/** The `type` of the tap message. Same constraint. */
export const TAP_MESSAGE = 'openreader:tap';

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
   * as it scrolls out of reach and back, so a DOM node reference would go stale
   * while an id survives — the Utterances segmented from these Blocks stay valid
   * and the highlight resumes when the section comes back.
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

/**
 * One rendered section's Blocks, in the order the document presents them. Sent
 * again for the same section when epub.js re-renders it.
 *
 * **An empty `blocks` is a real answer, not a missing one.** A cover page is a
 * `<svg><image/></svg>` and nothing else — which is how most EPUBs begin — so a
 * section that rendered and holds no text is ordinary, and it is a different
 * thing from a document that has not rendered yet. Both look like "no Blocks" to
 * anyone counting them, so this message is sent either way and the count is not
 * what tells them apart.
 */
export interface BlocksMessage {
  type: typeof BLOCKS_MESSAGE;
  sectionIndex: number;
  /** The spine item's href. */
  section: string;
  blocks: ReportedBlock[];
  /**
   * While the Document's body text size is being measured (ADR 0030): this
   * section's characters by the size the Document itself set them in, counted
   * until `COUNT_LIMIT` is reached. Null once it has been decided, or when there
   * was nothing to measure for.
   */
  sizes: CharactersBySize | null;
}

/**
 * Characters of a Document's text, by the size in CSS pixels the Document itself
 * set them in: what the WebView counts and `body-text.ts` decides from.
 */
export type CharactersBySize = readonly (readonly [px: number, characters: number])[];

/**
 * The shape of the document, sent once when the program installs itself.
 *
 * Its own message rather than a field on every `BlocksMessage`, because how long
 * the spine is is a fact about the **document** and would otherwise be repeated
 * once per section — two thousand times, for the book that made this necessary.
 *
 * Only this side can know it: `book.spine` lives in the WebView. The app needs it
 * to tell "the next section" from "there is no next section", which is what lets
 * a Play that walks forward looking for text stop and say it reached the end
 * instead of waiting for a section that will never render.
 */
export interface DocumentMessage {
  type: typeof DOCUMENT_MESSAGE;
  /** How many spine items the document has. */
  spine: number;
  /**
   * Every spine item's href, in spine order, **in the spine's own spelling**:
   * the manifest href relative to the package document, exactly as
   * `book.spine.get(index).href` gives it, unresolved and unmodified.
   *
   * Here because the Contents cannot be reached without it (ADR 0020). A row of
   * the contents list is a navigation entry, a navigation entry is an href, and
   * the only thing a row can be seeked to is a **spine index** — so turning one
   * into the other needs this table, and `core/document/contents.ts` matches the
   * two hrefs as strings. Unmodified is the load-bearing part: epub.js resolves
   * neither spelling against anything, so any tidying here would be a third
   * spelling that matches neither side.
   *
   * It cannot arrive any other way. `RenderedSection.href` delivers one per
   * section as it renders, which is far too late for a list that opens before
   * most sections have rendered — 2,077 of them on the book this was measured
   * against, where the list has to work on the first tap. Measured there: 2,077
   * hrefs, 50,812 UTF-8 bytes as a JSON array, once per document.
   */
  hrefs: string[];
}

/**
 * The owner tapped a word: read from there (ADR 0020).
 *
 * **A tap and deliberately not a long press.** A long press on text is iOS's
 * selection gesture, and suppressing it means `user-select: none`, which silently
 * stops `::highlight()` from painting — bisected on the device under this exact
 * layout (`notes/NOTES_2026-09-19.md`, 20:10: `text` paints, `none` draws nothing
 * with the same Ranges registered, `text` paints again). So the long press belongs
 * to the platform and this is a `click`.
 *
 * It carries a place in the document and **not** an Utterance index, because the
 * WebView does not have the Utterance list: it hit-tests the tapped point to a
 * text node, finds which Block that node belongs to, and reports the Block's own
 * coordinate system — the same UTF-16 code-unit offset every other message in this
 * file is written in. `cursor.ts`'s `utteranceAt` turns it into an index on the
 * React Native side, which is where the Utterances are and where the rest of the
 * coordinate chain already lives.
 *
 * A tap that hit-tests to no text node posts nothing at all: the design file is
 * explicit that tapping blank space does nothing, and in particular that it is not
 * a toggle for the player's visibility.
 */
export interface TapMessage {
  type: typeof TAP_MESSAGE;
  /** `ReportedBlock.id` of the Block the tapped text node belongs to. */
  block: string;
  /** Where the tap landed in that Block's own text, in UTF-16 code units. */
  offset: number;
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

export type WebViewMessage = BlocksMessage | DocumentMessage | ProblemMessage | TapMessage;

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
   * `null` means the clip came without any, so the Utterance is highlighted
   * whole. Never a partial array, never an estimate (philosophy rule 1). It
   * costs every OpenAI voice (ADR 0005) and Azure's `MAI-Voice-2` voices (ADR
   * 0037).
   */
  words: WordCue[] | null;
  /** How long the speech lasts as it will be heard. The interpolation is clamped to it, because the gap that follows belongs to the pause and not to the words. */
  durationMs: number;
  /**
   * Follow the voice: scroll the document so this Utterance is **centred**
   * (ADR 0011).
   *
   * Once per Utterance and never per word, which is why it rides on this message
   * rather than having one of its own — scrolling is not frame-path work, and a
   * message per word is what ADR 0005 exists to keep off the bridge. The
   * measurement is the WebView's, because the only thing that knows where a
   * sentence is on the screen is the document it is in.
   *
   * True is also the one thing that ends Browsing (#52): it is the voice, or the
   * owner pointing at a sentence, asking for the reading. False repaints the
   * sentence wherever the page is and leaves the page there — a cue while
   * paused, or a new Voice repainting the sentence it will read.
   */
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

/**
 * The page is about to be moved to a part of the document the owner only wants to
 * look at: **Browsing** (CONTEXT.md, #52), which a Contents row is while the
 * reading is paused.
 *
 * Sent just before the display that moves the page, so that the sections that
 * display renders — the reading's own among them, when it is next door — arrive
 * to a page that has stopped following the reading. Measured on 2026-09-23 at
 * 23:30 without it: a display of the section after the reading's re-rendered the
 * reading's section, and the highlighter centred the paused sentence as it
 * arrived, a scroll of −7,424 px that took the page straight back.
 *
 * Nothing in it but the kind: the WebView stays browsing until a highlight is
 * revealed (`SpeakMessage.reveal`), which is Play, a tapped sentence, a skip or a
 * place from another device.
 */
export interface BrowseMessage {
  kind: 'browse';
}

/**
 * How much of the bottom of the scroll container the player is covering.
 *
 * ADR 0011 centres the spoken Utterance against `rendition.manager.container`'s
 * `clientHeight`. ADR 0020's player **floats over** that container rather than
 * pushing it up — so the text never reflows when the player appears, and so the
 * visual centre of the *uncovered* text is not the container's centre. This is the
 * number that difference is made of.
 *
 * **It is an input to the centring and not a constant**, which is the whole reason
 * it is a message. The covered height changes when the player collapses to one
 * button and when it expands again, and the centring runs once per Utterance on
 * the Clip cue — so an offset that went stale is not corrected by the next frame,
 * or by anything else. The player measures itself and sends this whenever its own
 * layout changes.
 *
 * In CSS pixels of the top document, which are React Native points: the library's
 * template sets `width=device-width, initial-scale=1.0`, so the two units are the
 * same and no conversion belongs anywhere.
 */
export interface InsetMessage {
  kind: 'inset';
  /** The covered height at the bottom, in CSS pixels. Zero when nothing covers the text. */
  bottomPx: number;
}

/**
 * How the document's text is set: the owner's **Appearance** (ADR 0019), as the
 * stylesheet the WebView installs.
 *
 * It carries finished CSS rather than a font and a size, and that is the
 * decision. What a rule may say is then settled in one place, on the side that
 * can be tested: `appearanceCss` builds it from a fixed list of font stacks and
 * a clamped percentage, so nothing an owner chose can become a declaration of
 * its own — and in particular nothing here can declare `user-select`, which
 * silently stops `::highlight()` from painting (`highlighter.ts`). The WebView
 * half puts the string in a `<style>` element and never reads it.
 *
 * It is a message and not part of the program's own source because the program
 * is installed **once**, at page load: `injectedJavascript` is evaluated when the
 * WebView loads and the program refuses a second installation, so a source string
 * rebuilt for a new font would change nothing at all on a book that is already
 * open (`notes/NOTES_2026-09-20.md`, 01:01). The owner's current choice is baked
 * into that source *as well*, so a book opened with an override set is laid out
 * that way on its first paint.
 */
export interface AppearanceMessage {
  kind: 'appearance';
  /** CSS declarations for every element of the document: the owner's Font Size, and the font when one is chosen. */
  css: string;
}

/**
 * The Document's body text size has been decided (ADR 0030), so the WebView
 * stops counting characters by size in each section it renders. It changes no
 * style and moves nothing; the CSS for the decided size arrives as an ordinary
 * `AppearanceMessage`.
 */
export interface MeasuredMessage {
  kind: 'measured';
}

/**
 * Light or dark: the owner's **theme**, from General (ADR 0022), as the
 * stylesheet the WebView installs.
 *
 * Finished CSS, for the same reason the Appearance message carries it: what a
 * rule may say is settled on the side that can be tested. `themeCss` builds it
 * from a two-word argument and nothing else, so nothing here can declare
 * `user-select` — which silently stops `::highlight()` from painting.
 *
 * Its own message and not a second field on `AppearanceMessage`, because the two
 * differ in the one way that matters to the reader: a font change reflows every
 * line and has to be followed by a re-centre, and a colour change moves not one
 * character. Merging them would mean running the settle loop for a repaint.
 *
 * Empty under a light theme: light does not repaint the page, it leaves the
 * document's own colours alone (`docs/design/0022`).
 */
export interface ThemeMessage {
  kind: 'theme';
  /** CSS declarations for the document, or the empty string under a light theme. */
  css: string;
}

/**
 * The navigation bar over the top of the scroll container (#67, ADR 0048).
 *
 * The bar floats over the page as the player does, so that hiding it with the
 * player moves no text: the WebView keeps its frame, and a resize would destroy
 * every view (`highlighter.ts`, "the blank open"). So the top has the same two
 * numbers the bottom's `InsetMessage` has one of.
 *
 * `coveredPx` is what the bar covers **now**, zero while it is hidden, and it is
 * the centring's input, exactly as `bottomPx` is: nothing is re-centred when it
 * changes. `reservedPx` is the bar's height whether or not it is shown. Space that
 * tall is kept above the document's first line, and every place epub.js puts at
 * the top of the page lands below it, so a document opened, a chapter chosen or a
 * page put back is never under the bar. It stays put when the bar hides, and a
 * change to it moves the text by the difference, which is why it is a separate
 * number that changes only when the bar's own height does.
 */
export interface BarMessage {
  kind: 'bar';
  coveredPx: number;
  reservedPx: number;
}

export type HighlightMessage =
  | SpeakMessage
  | CorrectMessage
  | HoldMessage
  | ClearMessage
  | BrowseMessage
  | InsetMessage
  | BarMessage
  | AppearanceMessage
  | MeasuredMessage
  | ThemeMessage;
