/**
 * The React Native half: the bridge over `@epubjs-react-native/core`.
 *
 * Messages out, Blocks and problems in, and the document moved on command. It is
 * a wiring file on purpose — every decision it would otherwise make lives in
 * `cursor.ts` and `blocks.ts`, which run under Node and are tested, because
 * nothing in this file can be (`test/README.md`: React Native code is not tested
 * here by design, and a mock of the library would only prove the mock was called).
 *
 * ## The two rules this file exists to obey
 *
 * - **Nothing is sent per word.** `onClip` sends one message with the whole Word
 *   Timing array; `onPosition` sends one correction, about once a second, which is
 *   the cadence the engine's `POSITION_INTERVAL_MS` produces. There is no third
 *   path from the clock to `injectJavascript` (ADR 0005).
 * - **No playback position in React state.** There is no `useState` in this file
 *   at all. The position arrives on `onPosition`, is turned into a string, and
 *   goes into the WebView; nothing re-renders, so nothing costs a frame (ADR 0005).
 *   The consequence is deliberate: what this hook returns is not reactive, and the
 *   Blocks reach the app through `onBlocks` rather than as a value to read during
 *   render.
 *
 * Highlighting does not go through the library's annotation API. `updateAnnotation`
 * re-renders every view's annotation pane and each call is a fresh string
 * evaluation (ADR 0011); `injectJavascript` installs `highlighter.ts` once instead,
 * and after that every message is a call into it.
 */

import { useReader, type Theme } from '@epubjs-react-native/core';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { Utterance } from '../core/segmenter';
import { cutText, debugLog } from '../debug/debug-log';
import { DEBUG_MODE } from '../debug/mode';
import type { ClipCue, PositionCorrection, ReaderClock } from '../playback/reader-clock';

import { blockIds, EMPTY_BLOCKS, withSection, type BlockIndex } from './blocks';
import { countPage, PLAIN_BODY_TEXT_SIZE } from './body-text';
import { BAKED_LINE_POSITION, BAKED_SCROLLING } from './glide';
import { correctMessage, speakMessage, utteranceAt } from './cursor';
import {
  appearanceCss,
  DEFAULT_APPEARANCE,
  highlightCall,
  highlightCss,
  highlighterSource,
  READER_THEME,
  themeCss,
  type Appearance,
  type ReadingScheme,
} from './highlighter';
import {
  BLOCKS_MESSAGE,
  DOCUMENT_MESSAGE,
  FOLLOWING_STATE_MESSAGE,
  PROBE_MESSAGE,
  PROBLEM_MESSAGE,
  RENDERER_MESSAGE,
  TAP_MESSAGE,
  SELECTION_MESSAGE,
  type SelectionMessage,
  type CharactersBySize,
  type FollowingMessage,
  type HighlightMessage,
  type ProblemMessage,
  type ReportedBlock,
  type SpeakMessage,
  type WebViewMessage,
} from './messages';
import { isPageLine, logFromPage } from './renderer-log';

/**
 * The section epub.js has just rendered, and how long the document's spine is.
 *
 * Reported beside the Blocks because **a section that yielded none still
 * rendered**, and the two are different things to be told. A cover page is a
 * `<svg><image/></svg>` with no text in it, which is how most EPUBs begin; a
 * screen that only counts Blocks cannot tell it from a document that has not
 * started, and says the wrong one of the two for ever.
 */
export interface RenderedSection {
  /** The spine index. */
  index: number;
  /** The spine item's href — what the document itself calls this section. */
  href: string;
  /** How many spine items the document has, so that "the next section" and "there is no next section" can be told apart. */
  spine: number;
}

/**
 * What the document itself is, reported once as the program installs.
 *
 * Two facts about the **document** rather than about a section, which is why they
 * are one message and not a field repeated on every `BlocksMessage` — two thousand
 * times, for the book that made this necessary. Only the WebView can know either:
 * `book.spine` lives there.
 */
export interface ReportedDocument {
  /** How many spine items the document has. */
  spine: number;
  /**
   * Every spine item's href, in spine order, in the spine's own spelling.
   *
   * The contents list is built out of this and the navigation (ADR 0020):
   * `core/document/contents.ts`'s `contentsOf` takes exactly this array as its
   * `spine` argument, and without it every row of the list is unreachable and the
   * current row is null.
   */
  hrefs: readonly string[];
}

export interface ReaderBridgeOptions {
  /**
   * Every **Block** the document has rendered so far, in reading order, each time
   * that changes — once per section, and again if epub.js re-renders one with
   * different text.
   *
   * Segment them and hand the Utterances back with `setUtterances`, passing this
   * very array: `UtteranceSpan.block` is an index into it.
   *
   * `section` is the one that just rendered, and it arrives even when it
   * contributed no Blocks at all.
   */
  onBlocks?(blocks: readonly ReportedBlock[], section: RenderedSection): void;
  /**
   * The shape of the document, once, before any section reports its Blocks.
   *
   * A callback rather than a value to read during render, for the same reason as
   * `onBlocks`: nothing this hook returns is reactive, because there is no
   * `useState` in this file at all (ADR 0005).
   */
  onDocument?(document: ReportedDocument): void;
  /**
   * The owner tapped a word, and this is the **Utterance** to read from —
   * resolved here rather than reported raw, because the tap arrives as a place in
   * a Block (`TapMessage`) and the Utterances and the Block ids are both already
   * in this file's refs. `cursor.ts` owns the arithmetic and is tested; this is
   * the call site.
   *
   * It is not called at all for a tap that landed on no text, or on text no
   * Utterance covers. Tapping blank space does nothing (docs/design/0020), and
   * "nothing" is the absence of this call rather than a null passed to it.
   */
  onTap?(utterance: number): void;
  /** A highlight the WebView could not draw. Rare, and never a guess: see `ProblemMessage`. */
  onProblem?(problem: ProblemMessage): void;
  /**
   * Whether the page follows the reading — the player's **A** — or the owner is
   * browsing, its **M** (#71). Called when it changes, and with `true` whenever
   * the program installs, which is where it starts.
   */
  onFollowing?(following: boolean): void;
  /**
   * The Document's body text size has just been measured (ADR 0030): keep it, so
   * that the next open passes it back as `bodyTextSize` and is laid out at the
   * owner's size on its first paint. Called at most once per mount, only when
   * `bodyTextSize` was not known, and after that section's Blocks.
   */
  onBodyTextSize?(px: number): void;
  /**
   * Scroll the document so the Utterance being spoken is **centred**. Default
   * true.
   *
   * ADR 0005 names "scroll it into view on command" as one of the two
   * requirements that chose this renderer, and ADR 0011 says where: the middle of
   * the screen, not merely somewhere on it. It happens once per Utterance and
   * never per word — the scroll is driven by the Clip cue below and adds no
   * message of its own.
   */
  follow?: boolean;
  /**
   * How the document's text is set (ADR 0019), as the book opens, and the
   * Highlight Colours it is marked in (#118).
   *
   * Fixed at mount, because the highlighter is installed once, and it **does**
   * change while the book is open: through `setAppearance` rather than through
   * this. What this value is for is
   * the first paint — a book opened with an override already chosen is laid out
   * that way rather than reflowing once the first message arrives.
   */
  appearance?: Appearance;
  /**
   * The Document's own body text size, from an earlier open (ADR 0030), or null
   * when it has never been measured — in which case the program measures it from
   * the first pages it renders and `onBodyTextSize` hands the answer back.
   *
   * Fixed at mount like `appearance`: it is baked into the program, so a Document
   * measured before is laid out at the owner's size on its first paint.
   */
  bodyTextSize?: number | null;
  /**
   * Light or dark, as the book opens (ADR 0022).
   *
   * Beside `appearance` and for the same reason: every section the program adopts
   * is dark from the program's installation, rather than white until the first
   * message lands. It changes through `setTheme`.
   *
   * **Not the first section's first frame.** The library installs the program
   * only after it has displayed the first section (`onReady`), so that one is
   * drawn once under the library's own theme before this reaches it. What keeps
   * that frame from being white is `readerProps.defaultTheme`'s transparent page
   * (#27, ADR 0043).
   */
  scheme?: ReadingScheme;
}

/** Whether a highlight brings the page to itself. Absent means it does, which is what a highlight has always done. */
export interface RevealOptions {
  /**
   * False to repaint the sentence wherever the page is, and leave the page
   * there: the reading has not moved, and the owner may be looking at another
   * part of the document (Browsing, #52).
   */
  reveal?: boolean;
  /**
   * A cue the reading moved on to while it plays (#71): the page follows it, but
   * a page the owner took away stays away unless the sentence begins on the
   * visible page. Only `onClip` reads it; see `SpeakMessage.recover`.
   */
  recover?: boolean;
}

/**
 * The clock, with one thing the bridge's own `onClip` takes that the contract
 * does not: whether the cue brings the page to its sentence.
 *
 * Still a `ReaderClock` — the second argument is optional, so this is assignable
 * wherever the two-method contract is expected, and the engine never passes it.
 * The screen does, because it knows what the engine does not: whether the owner
 * is listening. A cue while paused is a paused seek's Clip arriving, or a speed
 * change re-cueing the Clip it re-scales (`engine.ts`); either can come while
 * the owner is browsing, and neither is a reason to take the page away.
 */
export interface BridgeClock extends ReaderClock {
  onClip(cue: ClipCue, options?: RevealOptions): void;
}

export interface ReaderBridge {
  setLookupEnabled(enabled: boolean): void;
  resumeFollowing(): void;
  releaseSelection(): void;
  onSelection(callback: (selection: SelectionMessage) => void): () => void;
  closeLookup(resumeFollow: boolean): void;
  /**
   * What `createPlaybackEngine` is handed as its `clock`.
   *
   * `reader-clock.ts` is the contract and it has two methods, deliberately no
   * third. The lock screen (ADR 0016) implements the same interface over the same
   * clock, which is why the elapsed time and the highlight cannot disagree.
   */
  clock: BridgeClock;
  /**
   * The Utterances the Blocks were segmented into, and the Blocks they were
   * segmented from.
   *
   * Both, because `UtteranceSpan.block` is an index into the second and the bridge
   * needs the ids at those indices. Passing the array `onBlocks` gave you is what
   * makes the two impossible to get out of step; keeping a snapshot here instead
   * would make it possible.
   */
  setUtterances(utterances: readonly Utterance[], blocks: readonly ReportedBlock[]): void;
  /**
   * Draw this Utterance's highlight now, at **utterance level and with no words**,
   * and follow the page to it.
   *
   * What a skip button paints before its Clip exists. The caller's `seek` goes out
   * at the same press (#86), and the Clip it asks for takes as long as the
   * Provider takes; this is the highlight for that wait, and it is the
   * same `SpeakMessage` the clock sends, with `words: null` and a zero duration.
   * The WebView's own loop starts only when there are words, so nothing spins and
   * nothing is estimated (ADR 0005): the sentence is lit whole until its Clip
   * arrives and replaces this with the real timings.
   *
   * `reveal: false` paints it without moving the page, for a repaint of the
   * sentence the reading is already on (#52).
   */
  show(utterance: number, options?: RevealOptions): void;
  /**
   * How much of the bottom of the page the player is covering, in points.
   *
   * The centring's input, not a style: ADR 0011 centres against the scroll
   * container's height and ADR 0020's player floats over the bottom of it, so the
   * visible middle is not the container's middle — and the covered height changes
   * when the player collapses and expands. Send it whenever the player's own
   * layout changes; see `InsetMessage`.
   */
  setInset(bottomPx: number): void;
  /**
   * The player's height when it is open and has nothing to say, in points: its
   * controls, padding and border, without notes (#71). What the Line Position is
   * measured above, so that a note coming or going and the player collapsing
   * move nothing. Travels in the same `InsetMessage` as `setInset`'s number.
   */
  setOpenPlayer(openPx: number): void;
  /**
   * The owner's **Line Position** (#71, ADR 0050), in percent of the visible
   * page from its top. Live, as the theme is: a page following the reading when
   * it arrives is brought to the new position. See `FollowingMessage`.
   */
  setLinePosition(percent: number): void;
  /**
   * How the page moves to the Line Position (#71, ADR 0050): a line at a time,
   * or continuously as the words are spoken. Live, and in the same
   * `FollowingMessage` as the Line Position, which always carries both.
   */
  setScrolling(scrolling: FollowingMessage['scrolling']): void;
  /**
   * The navigation bar over the top of the page, in points (#67): what it covers
   * now, zero while hidden, and its height whether or not it is shown. The first
   * is the centring's, as `setInset`'s is; the second is the space the page keeps
   * above the document's first line and at the top of every place it lands on.
   * See `BarMessage`.
   */
  setBar(coveredPx: number, reservedPx: number): void;
  /**
   * How the document's text is set: the owner's Appearance (ADR 0019).
   *
   * A message and not a remount. The program is installed once, at page load, so
   * a rebuilt source string changes nothing on a book that is already open — and
   * a remount would reparse the EPUB and lose the highlight to change a font
   * size, which is the opposite of what the sheet exists for: Appearance is
   * presented *over* the reader so the text stays visible while the change is
   * judged.
   *
   * The WebView restyles every rendered section and then **re-centres** the
   * Utterance being spoken, because a change that reflows the text moves it.
   * A change of the Highlight Colours alone (#118) is sent as its own message
   * and is not re-centred, as `setTheme` is not: a colour moves no character.
   */
  setAppearance(appearance: Appearance): void;
  /**
   * Light or dark, live (ADR 0022).
   *
   * Shaped like `setAppearance` and different in the one way that matters: the
   * WebView restyles every rendered section and **does not re-centre**. A colour
   * change moves not one character, so the sentence being spoken is exactly where
   * it was — this is the `setInset` case, not the font case.
   */
  setTheme(scheme: ReadingScheme): void;
  /**
   * Freeze the highlight where it is. Call it when the engine is paused.
   *
   * Not a third clock message: a pause stops the position stream, and a WebView
   * still interpolating against `requestAnimationFrame` would run the highlight
   * ahead of silence. The next correction unfreezes it.
   *
   * `stop` is the owner pausing: the page stops moving on the same frame (#71).
   * Without it, a glide already under way — a tapped sentence's, a skip's —
   * finishes.
   */
  hold(options?: { stop?: boolean }): void;
  /** Nothing is being read. Both highlights go. */
  clear(): void;
  /**
   * M (#71, #53): bring the page back to the reading and follow it again,
   * without starting it.
   *
   * `utterance` is where the reading is, or null when it is nowhere yet. When the
   * WebView is already showing that sentence it is told to go back to it
   * (`ReturnMessage`), which keeps a playing Clip's Word Timings and goes to the
   * spoken word's line. Otherwise the sentence is shown and revealed, as a skip
   * shows one, which brings the page to it.
   */
  returnToReading(utterance: number | null): void;
  /**
   * The player has collapsed, and the page only follows: no finger moves it and
   * none starts Browsing (#71). False when it opens again. See `FollowOnlyMessage`.
   */
  setFollowOnly(on: boolean): void;
  /**
   * Move the document to a CFI — epub.js's own dialect, unchanged (ADR 0011), so
   * that a Reading Position stored by this app resolves in Zotero's reader and one
   * stored there resolves here (ADR 0008).
   */
  goTo(cfi: string): void;
  /**
   * Move the document to a spine item by index.
   *
   * The second way in, and it exists because the first one cannot reach a section
   * the app has never seen: a section that has not rendered has reported no Block
   * and therefore has no CFI. epub.js's `Spine.get` takes a CFI, an href **or an
   * index**, and `rendition.display` hands its target straight to it, so the
   * index goes through the same call `goTo` uses (read out of the bundled
   * epub.js, which the library documents no more than the rest of it).
   *
   * It is a move of the page, so only something the owner asked for should call
   * it.
   */
  goToSection(index: number): void;
  /**
   * Move the page to a spine item, and leave the reading where it is:
   * **Browsing** (CONTEXT.md, #52), which is what a Contents row is whenever the
   * reading is on a sentence it keeps, playing or paused (#107).
   *
   * `goToSection`'s display, preceded by a message that stops the page following
   * the reading until a highlight is next revealed. Without it the reading's own
   * section, rendered again as the neighbour of the one displayed, is centred as
   * it arrives and takes the page back (`BrowseMessage`).
   */
  browse(index: number): void;
  /**
   * Debug Mode (#113): have the page write a `[renderer]` snapshot of epub.js —
   * views, queues, scroll, sections asked for and reported, location, the
   * page's visibility — to the Debug Log now, saying `why`. Does nothing in a
   * build without Debug Mode, whose program has nothing to answer it with.
   */
  snapshot(why: string): void;
  /**
   * Spread onto `<Reader>`. `injectedJavascript` installs the highlighter once,
   * from the library's own `onReady`; `onWebViewMessage` receives what the
   * highlighter posts back.
   *
   * **And the layout, because the highlighter is the half that was proved under
   * it.** ADR 0011 mounts the reader with `flow: 'scrolled-continuous'` and the
   * `continuous` manager, which is what makes the page scroll rather than turn,
   * and the centring in `highlighter.ts` measures against that manager's own
   * scroll container. The two are one decision, so they are stated in one place;
   * a screen that spread these props and then set `flow` itself would have moved
   * half of it.
   */
  readerProps: {
    injectedJavascript: string;
    onWebViewMessage(event: unknown): void;
    manager: 'continuous';
    flow: 'scrolled-continuous';
    /**
     * The library's own theme with a transparent page (`READER_THEME`, #27): the
     * library colours the WebView with it, so wherever no section is drawn the
     * reader's own page shows rather than the library's white.
     */
    defaultTheme: Theme;
  };
}

/**
 * What `@epubjs-react-native/core` actually hands to `onWebViewMessage`, which is
 * not what its type or its parameter name says.
 *
 * Read out of the installed `lib/commonjs/View.js`, because the package documents
 * neither: its `onMessage` does `JSON.parse(event.nativeEvent.data)` and forwards
 * the **parsed object**, not the WebView event — and only when the object's `type`
 * is not one of the library's own `internalEvents`, which is why both message
 * names here are prefixed. The declared type is `(event: any) => void`.
 */
function asMessage(event: unknown): WebViewMessage | null {
  if (typeof event !== 'object' || event === null) return null;
  const type = (event as { type?: unknown }).type;
  if (
    type !== BLOCKS_MESSAGE &&
    type !== DOCUMENT_MESSAGE &&
    type !== FOLLOWING_STATE_MESSAGE &&
    type !== PROBLEM_MESSAGE &&
    type !== TAP_MESSAGE &&
    type !== SELECTION_MESSAGE &&
    type !== RENDERER_MESSAGE &&
    type !== PROBE_MESSAGE
  ) {
    return null;
  }
  return event as WebViewMessage;
}

/** A height in points, or zero for anything that is not a positive number. */
function pointsOrZero(points: number): number {
  return Number.isFinite(points) && points > 0 ? points : 0;
}

export function useReaderBridge(options: ReaderBridgeOptions = {}): ReaderBridge {
  const { injectJavascript, goToLocation } = useReader();

  /**
   * `readerProps.defaultTheme`, put in the provider before this reader's WebView
   * is created (#27, ADR 0043).
   *
   * The library colours the WebView from the **provider's** theme, which starts on
   * its own white and takes the prop only when the template posts `onStarted`. A
   * WebView created white stays white after that, until the first section covers
   * it: the first open after every launch flashed white, 6 of 6. The provider sits
   * above the navigator and keeps what it is given, so after the first open this
   * finds it already done — which also means the library has no WebView yet
   * whenever `changeTheme` runs here, and its injection into one is skipped.
   *
   * An effect is early enough: `<Reader>` is not rendered until the reading view
   * has measured itself, a layout later, and React runs this before that render.
   */
  const { theme, changeTheme } = useReader();
  useEffect(() => {
    if (theme !== READER_THEME) changeTheme(READER_THEME);
  }, [theme, changeTheme]);

  /** The callbacks, kept current without making the bridge itself change identity every render. */
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  }, [options]);

  /**
   * Everything the clock touches is a ref, and that is the point rather than a
   * style: a `useState` here would re-render the reader at the correction cadence,
   * and the position would be in React state, which ADR 0005 forbids.
   */
  const utterances = useRef<readonly Utterance[]>([]);
  const ids = useRef<readonly string[]>([]);
  const blocks = useRef<BlockIndex>(EMPTY_BLOCKS);
  /** The Clip the WebView is showing, so a correction can be matched against it and clamped to its duration. */
  const cued = useRef<SpeakMessage | null>(null);
  /**
   * How many spine items the document has, from the message the program posts as
   * it installs. Zero until it arrives, which it does before any section reports.
   */
  const spine = useRef(0);
  /**
   * The last inset sent, kept so it can be sent **again** when the program says it
   * has installed.
   *
   * The player measures itself as it lays out, which is before the WebView has
   * finished loading its own template — and `highlightCall` is a call into a
   * function that is not there yet, so that first message is a no-op that nothing
   * reports. Losing it would leave the centring aiming at the middle of a
   * container whose bottom is covered, silently, until the player happened to
   * change size. The document message is the one signal that the program exists,
   * so it is what re-sends this.
   */
  const inset = useRef(0);
  const lookupEnabled = useRef(false);
  const selectionCallback = useRef<((selection: SelectionMessage) => void) | null>(null);
  /** The open player's own height, sent beside the inset and re-sent with it; see `setOpenPlayer`. */
  const openPlayer = useRef(0);
  /** The Line Position last asked for, as a share, re-sent at install when it is not the one the program was built with. */
  const linePosition = useRef(BAKED_LINE_POSITION);
  /** How the page moves to it, last asked for; sent beside it and re-sent with it. */
  const scrolling = useRef<FollowingMessage['scrolling']>(BAKED_SCROLLING);
  /** The last bar sent, re-sent for the same reason as `inset` above. */
  const bar = useRef({ coveredPx: 0, reservedPx: 0 });
  /**
   * What was baked into the program at mount, and what the owner has chosen
   * since.
   *
   * The pair exists so that the document message re-sends an Appearance the
   * program may have missed — the same trap as the inset above — **without**
   * sending one that is already in the source it was built from. The first is a
   * book laid out in the wrong font until something else happens; the second is
   * an injection and a reflow per document for nothing.
   */
  const installed = useRef(options.appearance ?? DEFAULT_APPEARANCE);
  const appearance = useRef(options.appearance ?? DEFAULT_APPEARANCE);
  /**
   * The Document's own body text size (ADR 0030): what the Font Size is measured
   * against. Null until it is known — from an earlier open, or once enough of the
   * pages rendered here have been counted — and the CSS is built against
   * `PLAIN_BODY_TEXT_SIZE` meanwhile, which is every current Document's actual size.
   */
  const bodyTextSize = useRef<number | null>(options.bodyTextSize ?? null);
  /** What each page rendered so far said, one entry per section, while `bodyTextSize` is still null. */
  const pages = useRef<ReadonlyMap<number, CharactersBySize>>(new Map());
  /** The body text size the program was built with, the other half of `installed`. */
  const installedBodyTextSize = useRef(options.bodyTextSize ?? null);
  /** The same pair for the theme, and for the same reason. */
  const installedScheme = useRef<ReadingScheme>(options.scheme ?? 'light');
  const scheme = useRef<ReadingScheme>(options.scheme ?? 'light');

  const send = useCallback(
    (message: HighlightMessage) => {
      injectJavascript(highlightCall(message));
    },
    [injectJavascript],
  );

  const setLookupEnabled = useCallback((enabled: boolean) => {
    lookupEnabled.current = enabled;
    send({ kind: 'lookup', enabled });
  }, [send]);
  const onSelection = useCallback((callback: (selection: SelectionMessage) => void) => {
    selectionCallback.current = callback;
    return () => { if (selectionCallback.current === callback) selectionCallback.current = null; };
  }, []);
  const releaseSelection = useCallback(() => send({ kind: 'lookup', selectionReleased: true }), [send]);
  const resumeFollowing = useCallback(() => send({ kind: 'lookup', releaseBrowsing: true }), [send]);
  const closeLookup = useCallback((resumeFollow: boolean) => send({ kind: 'lookup', close: true, resumeFollow }), [send]);

  const clock = useMemo<BridgeClock>(
    () => ({
      /** A Clip started: the whole Word Timing array, once, in one message (ADR 0005). */
      onClip(cue: ClipCue, options?: RevealOptions) {
        const message = speakMessage(cue, utterances.current, ids.current, {
          reveal: latest.current.follow !== false && options?.reveal !== false,
          recover: latest.current.follow !== false && options?.recover === true,
        });
        cued.current = message;
        // Null means the reading and the document are out of step — an Utterance
        // the renderer does not have, or one whose Blocks are not reported. The
        // last highlight is left alone rather than replaced with a guess.
        if (message) send(message);
      },
      /** One correction, about once a second. This is the only position that crosses the bridge. */
      onPosition(correction: PositionCorrection) {
        const message = correctMessage(correction, cued.current);
        if (message) send(message);
      },
    }),
    [send],
  );

  const setUtterances = useCallback((list: readonly Utterance[], reported: readonly ReportedBlock[]) => {
    utterances.current = list;
    ids.current = blockIds(reported);
  }, []);

  const show = useCallback(
    (utterance: number, options?: RevealOptions) => {
      const message = speakMessage(
        // No words and no duration: nothing is known about the Clip yet, and this
        // is the Highlight Level the absence of Word Timings already means (ADR
        // 0005). Nothing here estimates one.
        { utterance, words: null, duration: 0, rate: 1 },
        utterances.current,
        ids.current,
        { reveal: latest.current.follow !== false && options?.reveal !== false },
      );
      if (!message) return;
      if (options?.reveal !== false) send({ kind: 'lookup', releaseBrowsing: true });
      // `cued` so that a correction still arriving for the Utterance that *was*
      // playing is recognised as stale and dropped, rather than repainting the
      // sentence the owner has just skipped away from.
      cued.current = message;
      send(message);
    },
    [send],
  );

  const setInset = useCallback(
    (bottomPx: number) => {
      const covered = Number.isFinite(bottomPx) && bottomPx > 0 ? bottomPx : 0;
      if (covered === inset.current) return;
      inset.current = covered;
      send({ kind: 'inset', bottomPx: covered, openPx: openPlayer.current });
    },
    [send],
  );

  const setOpenPlayer = useCallback(
    (openPx: number) => {
      const open = Number.isFinite(openPx) && openPx > 0 ? openPx : 0;
      if (open === openPlayer.current) return;
      openPlayer.current = open;
      send({ kind: 'inset', bottomPx: inset.current, openPx: open });
    },
    [send],
  );

  const setLinePosition = useCallback(
    (percent: number) => {
      if (!Number.isFinite(percent)) return;
      const share = Math.min(Math.max(percent, 0), 100) / 100;
      if (share === linePosition.current) return;
      linePosition.current = share;
      send({ kind: 'following', linePosition: share, scrolling: scrolling.current });
    },
    [send],
  );

  const setScrolling = useCallback(
    (way: FollowingMessage['scrolling']) => {
      if (way !== 'line' && way !== 'continuous') return;
      if (way === scrolling.current) return;
      scrolling.current = way;
      send({ kind: 'following', linePosition: linePosition.current, scrolling: way });
    },
    [send],
  );

  const setBar = useCallback(
    (coveredPx: number, reservedPx: number) => {
      const next = { coveredPx: pointsOrZero(coveredPx), reservedPx: pointsOrZero(reservedPx) };
      if (next.coveredPx === bar.current.coveredPx && next.reservedPx === bar.current.reservedPx) return;
      bar.current = next;
      send({ kind: 'bar', ...next });
    },
    [send],
  );

  const setAppearance = useCallback(
    (next: Appearance) => {
      const previous = appearance.current;
      appearance.current = next;
      const colours = highlightCss(next.highlight);
      if (colours !== highlightCss(previous.highlight)) {
        send({ kind: 'highlight', css: colours });
        // The Highlight Colours alone (#118) are a repaint, as the theme is: a
        // colour moves no character, so the page is not placed again.
        if (appearanceCss(next, bodyTextSize.current) === appearanceCss(previous, bodyTextSize.current)) return;
      }
      send({ kind: 'appearance', css: appearanceCss(next, bodyTextSize.current) });
    },
    [send],
  );

  const setTheme = useCallback(
    (next: ReadingScheme) => {
      scheme.current = next;
      send({ kind: 'theme', css: themeCss(next) });
    },
    [send],
  );

  const hold = useCallback((options?: { stop?: boolean }) => {
    send(options?.stop ? { kind: 'hold', stop: true } : { kind: 'hold' });
  }, [send]);

  const clear = useCallback(() => {
    cued.current = null;
    send({ kind: 'clear' });
  }, [send]);

  const returnToReading = useCallback(
    (utterance: number | null) => {
      if (utterance === null || cued.current?.utterance === utterance) {
        send({ kind: 'return' });
        return;
      }
      show(utterance);
    },
    [send, show],
  );

  /** Whether the page only follows, kept so it is sent again when the program installs, as the inset is. */
  const followOnly = useRef(false);
  const setFollowOnly = useCallback(
    (on: boolean) => {
      if (on === followOnly.current) return;
      followOnly.current = on;
      send({ kind: 'followOnly', on });
    },
    [send],
  );

  const goTo = useCallback(
    (cfi: string) => {
      // The page's own `display` line says only "injected code" of every
      // display the library's goToLocation asks for; this says which (#113).
      debugLog('renderer', `the app asks epub.js to display ${cutText(cfi)} (goTo)`);
      goToLocation(cfi);
    },
    [goToLocation],
  );

  const goToSection = useCallback(
    (index: number) => {
      // `goToLocation` interpolates its argument into `rendition.display('…')`,
      // and epub.js's `Spine.get` reads a target that is not a CFI and is not NaN
      // as a spine index. So the index travels as its own decimal spelling.
      debugLog('renderer', `the app asks epub.js to display section ${index} (goToSection)`);
      goToLocation(String(index));
    },
    [goToLocation],
  );

  const browse = useCallback(
    (index: number) => {
      // First, so the sections the display renders arrive to a page that has
      // stopped following the reading: both are injected, and run in this order.
      send({ kind: 'browse' });
      debugLog('renderer', `the app asks epub.js to display section ${index} (browse)`);
      goToLocation(String(index));
    },
    [send, goToLocation],
  );

  const snapshot = useCallback(
    (why: string) => {
      if (DEBUG_MODE) send({ kind: 'snapshot', why });
    },
    [send],
  );

  const onWebViewMessage = useCallback(
    (event: unknown) => {
      const message = asMessage(event);
      if (!message) return;
      // Debug Mode's lines from the page (#113): written, and nothing else.
      if (isPageLine(message)) {
        if (DEBUG_MODE) logFromPage(message);
        return;
      }
      if (message.type === SELECTION_MESSAGE) {
        if (lookupEnabled.current && typeof message.text === 'string' && typeof message.expanded === 'boolean' && typeof message.selecting === 'boolean') {
          selectionCallback.current?.({ ...message, text: message.text.slice(0, 5001) });
        }
        return;
      }
      if (message.type === PROBLEM_MESSAGE) {
        latest.current.onProblem?.(message);
        return;
      }
      if (message.type === DOCUMENT_MESSAGE) {
        spine.current = message.spine;
        send({ kind: 'lookup', enabled: lookupEnabled.current });
        // The program has installed, so the two things it may have missed go again.
        if (inset.current > 0 || openPlayer.current > 0) send({ kind: 'inset', bottomPx: inset.current, openPx: openPlayer.current });
        if (linePosition.current !== BAKED_LINE_POSITION || scrolling.current !== BAKED_SCROLLING) {
          send({ kind: 'following', linePosition: linePosition.current, scrolling: scrolling.current });
        }
        if (bar.current.reservedPx > 0) send({ kind: 'bar', ...bar.current });
        if (appearance.current !== installed.current || bodyTextSize.current !== installedBodyTextSize.current) {
          send({ kind: 'appearance', css: appearanceCss(appearance.current, bodyTextSize.current) });
        }
        if (scheme.current !== installedScheme.current) {
          send({ kind: 'theme', css: themeCss(scheme.current) });
        }
        if (highlightCss(appearance.current.highlight) !== highlightCss(installed.current.highlight)) {
          send({ kind: 'highlight', css: highlightCss(appearance.current.highlight) });
        }
        // A new program follows the reading and lets a finger move the page; the
        // player is told the first, and the program the collapsed player it missed.
        latest.current.onFollowing?.(true);
        if (followOnly.current) send({ kind: 'followOnly', on: true });
        latest.current.onDocument?.({ spine: message.spine, hrefs: message.hrefs });
        return;
      }
      if (message.type === FOLLOWING_STATE_MESSAGE) {
        latest.current.onFollowing?.(message.following);
        return;
      }
      if (message.type === TAP_MESSAGE) {
        const at = utteranceAt(utterances.current, ids.current, message.block, message.offset);
        // Null is a tap on text no Utterance covers, which is the same as a tap on
        // nothing: it does nothing, and says nothing (docs/design/0020).
        if (at !== null) latest.current.onTap?.(at);
        return;
      }
      // The Document's body text size, decided once from the first pages with
      // enough text on them (ADR 0030). Until then every section reports how its
      // characters are sized; `countPage` keeps one count per section.
      let decided: number | null = null;
      if (bodyTextSize.current === null && message.sizes) {
        const counted = countPage(pages.current, message.sectionIndex, message.sizes);
        pages.current = counted.pages;
        decided = counted.bodyTextSize;
        if (decided !== null) {
          bodyTextSize.current = decided;
          pages.current = new Map();
          send({ kind: 'measured' });
          // The page was laid out against PLAIN_BODY_TEXT_SIZE; only a Document
          // whose own body text differs is restyled, so every current one — whose
          // body text is exactly that — never reflows for this.
          if (decided !== PLAIN_BODY_TEXT_SIZE) send({ kind: 'appearance', css: appearanceCss(appearance.current, decided) });
        }
      }
      const next = withSection(blocks.current, message);
      // Unchanged means epub.js rendered a section whose text is the same, which
      // happens whenever the reader crosses back into one. Re-segmenting the book
      // for that would be the renderer's most expensive habit.
      if (next !== blocks.current) {
        blocks.current = next;
        latest.current.onBlocks?.(next.blocks, {
          index: message.sectionIndex,
          href: message.section,
          spine: spine.current,
        });
      }
      // After the Blocks, which the reading cannot do without: keeping the size
      // for the next open is the app's business, and nothing it does can cost them.
      if (decided !== null) latest.current.onBodyTextSize?.(decided);
    },
    [send],
  );

  /**
   * The program, built once.
   *
   * Deliberately not rebuilt when `appearance` changes: the WebView
   * evaluates `injectedJavascript` at page load and the program's first line
   * refuses a second installation, so a new string would be a new prop that
   * changes nothing on the device — a false sense that a setting had been applied
   * (`notes/NOTES_2026-09-20.md`, 01:01). Appearance changes through
   * `setAppearance`, and the two halves are told apart by `installed` above.
   */
  const injectedJavascript = useMemo(
    () =>
      highlighterSource(options.appearance ?? DEFAULT_APPEARANCE, options.scheme ?? 'light', options.bodyTextSize ?? null, DEBUG_MODE),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const readerProps = useMemo<ReaderBridge['readerProps']>(
    () => ({
      injectedJavascript,
      onWebViewMessage,
      // ADR 0011. `flow` picks the layout and `manager` picks the view manager
      // that implements it; the library defaults to `'auto'` and `'default'`,
      // which is the paginated reader this one replaces. Both are interpolated
      // into the WebView's template at mount, so they are fixed for a document.
      manager: 'continuous',
      flow: 'scrolled-continuous',
      defaultTheme: READER_THEME,
    }),
    [injectedJavascript, onWebViewMessage],
  );

  return useMemo(
    () => ({ releaseSelection, resumeFollowing, setLookupEnabled, onSelection, closeLookup, clock, setUtterances, show, setInset, setOpenPlayer, setBar, setLinePosition, setScrolling, setAppearance, setTheme, hold, clear, returnToReading, setFollowOnly, goTo, goToSection, browse, snapshot, readerProps }),
    [releaseSelection, resumeFollowing, setLookupEnabled, onSelection, closeLookup, clock, setUtterances, show, setInset, setOpenPlayer, setBar, setLinePosition, setScrolling, setAppearance, setTheme, hold, clear, returnToReading, setFollowOnly, goTo, goToSection, browse, snapshot, readerProps],
  );
}
