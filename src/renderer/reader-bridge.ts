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

import { useReader } from '@epubjs-react-native/core';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { Utterance } from '../core/segmenter';
import type { ClipCue, PositionCorrection, ReaderClock } from '../playback/reader-clock';

import { blockIds, EMPTY_BLOCKS, withSection, type BlockIndex } from './blocks';
import { countPage, PLAIN_BODY_TEXT_SIZE } from './body-text';
import { correctMessage, speakMessage, utteranceAt } from './cursor';
import {
  appearanceCss,
  DEFAULT_HIGHLIGHT,
  DEFAULT_APPEARANCE,
  highlightCall,
  highlighterSource,
  themeCss,
  type Appearance,
  type HighlightStyles,
  type ReadingScheme,
} from './highlighter';
import {
  BLOCKS_MESSAGE,
  DOCUMENT_MESSAGE,
  PROBLEM_MESSAGE,
  TAP_MESSAGE,
  type CharactersBySize,
  type HighlightMessage,
  type ProblemMessage,
  type ReportedBlock,
  type SpeakMessage,
  type WebViewMessage,
} from './messages';

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
   * How the two Highlight Levels are painted. Fixed at mount: the highlighter is
   * installed once, so changing this afterwards changes nothing.
   */
  styles?: HighlightStyles;
  /**
   * How the document's text is set (ADR 0019), as the book opens.
   *
   * Fixed at mount for the same reason as `styles` and with one difference that
   * matters: this one **does** change while the book is open, and it changes
   * through `setAppearance` rather than through this. What this value is for is
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
   * Beside `appearance` and for the same reason: this is the **first paint**, so
   * a book opened under a dark theme is dark on the frame it appears rather than
   * flashing white until the first message lands. It changes through `setTheme`.
   */
  scheme?: ReadingScheme;
}

export interface ReaderBridge {
  /**
   * What `createPlaybackEngine` is handed as its `clock`.
   *
   * `reader-clock.ts` is the contract and it has two methods, deliberately no
   * third. The lock screen (ADR 0016) implements the same interface over the same
   * clock, which is why the elapsed time and the highlight cannot disagree.
   */
  clock: ReaderClock;
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
   * What a skip button paints before its Clip exists. ADR 0020 requires rapid
   * presses to coalesce — five taps must not be five synthesis requests, which is
   * Zotero's own 600 ms debounce — while the highlight moves on every press. The
   * debounced `seek` is the caller's; this is the immediate half, and it is the
   * same `SpeakMessage` the clock sends, with `words: null` and a zero duration.
   * The WebView's own loop starts only when there are words, so nothing spins and
   * nothing is estimated (ADR 0005): the sentence is lit whole until its Clip
   * arrives and replaces this with the real timings.
   */
  show(utterance: number): void;
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
   */
  hold(): void;
  /** Nothing is being read. Both highlights go. */
  clear(): void;
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
  if (type !== BLOCKS_MESSAGE && type !== DOCUMENT_MESSAGE && type !== PROBLEM_MESSAGE && type !== TAP_MESSAGE) {
    return null;
  }
  return event as WebViewMessage;
}

export function useReaderBridge(options: ReaderBridgeOptions = {}): ReaderBridge {
  const { injectJavascript, goToLocation } = useReader();

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

  const clock = useMemo<ReaderClock>(
    () => ({
      /** A Clip started: the whole Word Timing array, once, in one message (ADR 0005). */
      onClip(cue: ClipCue) {
        const message = speakMessage(cue, utterances.current, ids.current, {
          reveal: latest.current.follow !== false,
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
    (utterance: number) => {
      const message = speakMessage(
        // No words and no duration: nothing is known about the Clip yet, and this
        // is the Highlight Level the absence of Word Timings already means (ADR
        // 0005). Nothing here estimates one.
        { utterance, words: null, duration: 0, rate: 1 },
        utterances.current,
        ids.current,
        { reveal: latest.current.follow !== false },
      );
      if (!message) return;
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
      send({ kind: 'inset', bottomPx: covered });
    },
    [send],
  );

  const setAppearance = useCallback(
    (next: Appearance) => {
      appearance.current = next;
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

  const hold = useCallback(() => {
    send({ kind: 'hold' });
  }, [send]);

  const clear = useCallback(() => {
    cued.current = null;
    send({ kind: 'clear' });
  }, [send]);

  const goTo = useCallback(
    (cfi: string) => {
      goToLocation(cfi);
    },
    [goToLocation],
  );

  const goToSection = useCallback(
    (index: number) => {
      // `goToLocation` interpolates its argument into `rendition.display('…')`,
      // and epub.js's `Spine.get` reads a target that is not a CFI and is not NaN
      // as a spine index. So the index travels as its own decimal spelling.
      goToLocation(String(index));
    },
    [goToLocation],
  );

  const onWebViewMessage = useCallback(
    (event: unknown) => {
      const message = asMessage(event);
      if (!message) return;
      if (message.type === PROBLEM_MESSAGE) {
        latest.current.onProblem?.(message);
        return;
      }
      if (message.type === DOCUMENT_MESSAGE) {
        spine.current = message.spine;
        // The program has installed, so the two things it may have missed go again.
        if (inset.current > 0) send({ kind: 'inset', bottomPx: inset.current });
        if (appearance.current !== installed.current || bodyTextSize.current !== installedBodyTextSize.current) {
          send({ kind: 'appearance', css: appearanceCss(appearance.current, bodyTextSize.current) });
        }
        if (scheme.current !== installedScheme.current) {
          send({ kind: 'theme', css: themeCss(scheme.current) });
        }
        latest.current.onDocument?.({ spine: message.spine, hrefs: message.hrefs });
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
   * Deliberately not rebuilt when `styles` or `appearance` change: the WebView
   * evaluates `injectedJavascript` at page load and the program's first line
   * refuses a second installation, so a new string would be a new prop that
   * changes nothing on the device — a false sense that a setting had been applied
   * (`notes/NOTES_2026-09-20.md`, 01:01). Appearance changes through
   * `setAppearance`, and the two halves are told apart by `installed` above.
   */
  const injectedJavascript = useMemo(
    () =>
      highlighterSource(options.styles ?? DEFAULT_HIGHLIGHT, options.appearance ?? DEFAULT_APPEARANCE, options.scheme ?? 'light', options.bodyTextSize ?? null),
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
    }),
    [injectedJavascript, onWebViewMessage],
  );

  return useMemo(
    () => ({ clock, setUtterances, show, setInset, setAppearance, setTheme, hold, clear, goTo, goToSection, readerProps }),
    [clock, setUtterances, show, setInset, setAppearance, setTheme, hold, clear, goTo, goToSection, readerProps],
  );
}
