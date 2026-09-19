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
import { correctMessage, speakMessage } from './cursor';
import { DEFAULT_HIGHLIGHT, highlightCall, highlighterSource, type HighlightStyles } from './highlighter';
import {
  BLOCKS_MESSAGE,
  PROBLEM_MESSAGE,
  type HighlightMessage,
  type ProblemMessage,
  type ReportedBlock,
  type SpeakMessage,
  type WebViewMessage,
} from './messages';

export interface ReaderBridgeOptions {
  /**
   * Every **Block** the document has rendered so far, in reading order, each time
   * that changes — once per section, and again if epub.js re-renders one with
   * different text.
   *
   * Segment them and hand the Utterances back with `setUtterances`, passing this
   * very array: `UtteranceSpan.block` is an index into it.
   */
  onBlocks?(blocks: readonly ReportedBlock[]): void;
  /** A highlight the WebView could not draw. Rare, and never a guess: see `ProblemMessage`. */
  onProblem?(problem: ProblemMessage): void;
  /**
   * Bring each Utterance onto the page as it starts being spoken. Default true.
   *
   * ADR 0005 names "scroll it into view on command" as one of the two
   * requirements that chose this renderer. It happens once per Utterance and never
   * per word.
   */
  follow?: boolean;
  /**
   * How the two Highlight Levels are painted. Fixed at mount: the highlighter is
   * installed once, so changing this afterwards changes nothing.
   */
  styles?: HighlightStyles;
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
   * Spread onto `<Reader>`. `injectedJavascript` installs the highlighter once,
   * from the library's own `onReady`; `onWebViewMessage` receives what the
   * highlighter posts back.
   */
  readerProps: {
    injectedJavascript: string;
    onWebViewMessage(event: unknown): void;
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
  if (type !== BLOCKS_MESSAGE && type !== PROBLEM_MESSAGE) return null;
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

  const onWebViewMessage = useCallback((event: unknown) => {
    const message = asMessage(event);
    if (!message) return;
    if (message.type === PROBLEM_MESSAGE) {
      latest.current.onProblem?.(message);
      return;
    }
    const next = withSection(blocks.current, message);
    // Unchanged means epub.js rendered a section whose text is the same, which
    // happens whenever the reader crosses back into one. Re-segmenting the book
    // for that would be the renderer's most expensive habit.
    if (next === blocks.current) return;
    blocks.current = next;
    latest.current.onBlocks?.(next.blocks);
  }, []);

  const injectedJavascript = useMemo(
    () => highlighterSource(options.styles ?? DEFAULT_HIGHLIGHT),
    [options.styles],
  );

  const readerProps = useMemo(
    () => ({ injectedJavascript, onWebViewMessage }),
    [injectedJavascript, onWebViewMessage],
  );

  return useMemo(
    () => ({ clock, setUtterances, hold, clear, goTo, readerProps }),
    [clock, setUtterances, hold, clear, goTo, readerProps],
  );
}
