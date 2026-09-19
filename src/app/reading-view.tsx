/**
 * The reader screen: the document, and the player floating over it.
 *
 * The controls are `player.tsx` and the two sheets beside it; what is here is the
 * wiring, and three things worth reading twice.
 *
 * **The player floats.** The document fills the screen and the player is
 * positioned over the bottom of it, so the text does not reflow when the player
 * appears, goes, collapses or expands (ADR 0020). Nothing about `<Reader>`'s size
 * mentions the player, which is what makes that true rather than nearly true.
 *
 * **Which means the centring has to be told.** ADR 0011 centres the spoken
 * Utterance against the scroll container's own height, and the player now covers
 * the bottom of that container — so the middle of the *visible* text is not the
 * middle of the container, and the difference changes when the player collapses.
 * The player measures itself and the height goes straight to the renderer
 * (`bridge.setInset`). It is a live coupling, not a constant: the centring runs
 * once per Utterance on the Clip cue, so an offset that went stale is not
 * corrected by anything.
 *
 * **It says what it is doing.** Which Utterance is being read, at which Highlight
 * Level, and what the last thing to refuse said. `docs/PHILOSOPHY.md` rule 1 is
 * honest signals, and a player that cannot say whether it is highlighting the word
 * or the sentence leaves the owner to guess at exactly the thing this app is for.
 * Those lines live inside the player so that collapsing hides them with the rest.
 *
 * It is mounted per Document, keyed by it, so that opening another one starts with
 * a new bridge, a new engine and none of the previous book's Blocks. The renderer
 * keeps its section index outside React (`blocks.ts`), and a remount is the honest
 * way to clear it.
 */

import { Reader, useReader } from '@epubjs-react-native/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { readLocator, type ReadingPosition } from '../core/document';
import { contentsOf, type NavigationEntry } from '../core/document/contents';
import { chapterOf, useNowPlaying } from '../now-playing';
import type { ProviderId } from '../core/providers/types';

import { ContentsSheet } from './contents-sheet';
import { INK } from './controls';
import type { OpenDocument } from './document';
import { Player } from './player';
import { useReaderFileSystem } from './reader-file-system';
import { PROVIDER_LABELS, readiness, readinessSentence, type AppSettings } from './settings';
import type { SecretPresence } from './use-provider-secrets';
import { useReading, type ReadingStatus } from './use-reading';
import { useVoiceLists } from './use-voices';
import { VoiceSheet } from './voice-sheet';

/**
 * How often a Reading Position is written to the Library while the reading is
 * under way, at most.
 *
 * ADR 0019 says the Library file is written after every change, and a Reading
 * Position changes once an Utterance — every few seconds. Rewriting a few tens
 * of kilobytes that often is not expensive, but it is not free either, and the
 * thing being protected is a force-quit: at three seconds a sentence this loses
 * at most the last three or four sentences, which is inside the paragraph the
 * owner was listening to. Leaving the screen writes unconditionally, so the
 * ordinary way out loses nothing at all.
 */
const POSITION_INTERVAL_MS = 10_000;

export interface ReadingViewProps {
  document: OpenDocument;
  settings: AppSettings;
  /**
   * What the Keychain says about the chosen Provider's key. The screen holds it,
   * because the sheet is what changes it.
   *
   * The whole value rather than a boolean: until the lookup has answered there is
   * nothing to claim, and "the Keychain would not say" is a third answer that is
   * worth showing rather than reading as "no key" (`src/keys/refusal.ts`).
   */
  keyPresence: SecretPresence;
  /**
   * The shell's count of credential writes, passed straight to `useReading`.
   *
   * Here rather than read from the shell inside this component because every
   * other thing it shows arrives as a prop from `reader-screen.tsx`, and a
   * component that takes its settings from one place and its credentials from
   * another is one that can show the two disagreeing.
   */
  credentialsWrittenAt: number;
  /**
   * Where the reading stopped (ADR 0008), or null for a Document that has not
   * been read. **The whole position, not the CFI**, because it does two things
   * and they are not the same thing.
   *
   * Its locator goes to `<Reader initialLocation>`, which the library applies
   * inside its own `onReady` — before it injects the highlighter, so the section
   * that reports its Blocks first is the one the owner was left in rather than
   * the cover. That moves the **page**.
   *
   * Its anchor is what moves the **reading**: `use-reading.ts` resolves it
   * against the Blocks as they report and hands the Utterance to the engine. The
   * two halves were written together by `readingPositionAt` precisely so that
   * they describe one place, and splitting them here — a CFI to the page and
   * nothing to the voice — is what ADR 0019 recorded as not done.
   */
  position: ReadingPosition | null;
  onRate(rate: number): void;
  /** A Provider and a Voice together: a Voice belongs to exactly one Provider (CONTEXT.md, ADR 0010). */
  onVoice(provider: ProviderId, voice: string): void;
  /** Where speech got to. Called on a Clip boundary at most every `POSITION_INTERVAL_MS`, and once more on the way out. */
  onReached(position: ReadingPosition): void;
  /** What the EPUB calls itself, once epub.js has its metadata. */
  onTitle(title: string): void;
}

/**
 * Where the reading is, in one sentence.
 *
 * The two "no Utterances" states are kept apart, because they were one sentence
 * and it was false in the commoner of the two. Nothing having rendered is a
 * document that has not started. A section having rendered and yielded nothing is
 * a **cover page** — a `<svg><image/></svg>` with no text in it, which is how most
 * EPUBs begin — and telling the owner to wait for it is a dead end they cannot
 * leave, because the thing they are waiting for has already happened.
 */
function readingLine(status: ReadingStatus, settings: AppSettings): string {
  if (status.utterance !== null) {
    const level = status.level === 'word' ? 'the word' : 'the whole Utterance';
    const where = `Utterance ${status.utterance + 1} of ${status.known}`;
    return status.playing ? `Reading ${where}, highlighting ${level}.` : `Paused at ${where}.`;
  }
  if (status.playing) return `Waiting for the first Clip from ${PROVIDER_LABELS[settings.provider]}.`;
  if (status.known > 0) return `${status.known} Utterances ready. Tap a word to read from there.`;
  if (!status.rendered) return 'Waiting for the document to render its first section.';
  if (status.seeking) return 'Looking for the first section of this document with text in it.';
  return `${status.rendered.href} has no text to read — a cover page usually has none. Play moves to the first section that has.`;
}

/**
 * What the owner is told about Word Timings, and when.
 *
 * Two different claims, and they are kept apart. Before a Clip has played, the
 * Provider's own `capabilities.wordTimestamps` is all there is. Once one has
 * played, whether it carried timings is a fact about this Voice on this server —
 * which is the one that matters, because a wrong address behind the Local
 * provider looks exactly like a Voice with no timings.
 */
function highlightLine(status: ReadingStatus): string | null {
  if (status.level === 'utterance') {
    return 'This Clip came with no Word Timings, so the whole Utterance is highlighted. Nothing is estimated (ADR 0005).';
  }
  if (status.level === 'word') return null;
  if (status.reportsWordTimings === false) {
    return 'This Provider reports no Word Timings, so the reading is highlighted an Utterance at a time.';
  }
  if (status.reportsWordTimings === true) return 'This Provider reports Word Timings, so the word being spoken is highlighted.';
  return null;
}

export function ReadingView({
  document,
  settings,
  keyPresence,
  credentialsWrittenAt,
  position,
  onRate,
  onVoice,
  onReached,
  onTitle,
}: ReadingViewProps) {
  const fileSystem = useReaderFileSystem;
  /**
   * `toc` as well as `getMeta` now. The library's own template already posts the
   * whole navigation at load and stores it here; nothing in `src/` had read it. It
   * is the other half of the contents list, the first half being the spine's hrefs
   * from the document message.
   */
  const { getMeta, toc } = useReader();
  /**
   * `readLocator` rather than reaching into the position: a `Locator` is opaque
   * by construction (ADR 0007) and this is its one door — it hands back the CFI
   * only if the locator really is one this Document's format can resolve.
   */
  const resumeAt = useMemo(
    () => (position ? readLocator(position.locator, document.identity.format) : null),
    [position, document.identity.format],
  );
  const reading = useReading(settings, { hasKey: keyPresence.state === 'held', writtenAt: credentialsWrittenAt }, position);
  const voices = useVoiceLists(settings);
  const [displayError, setDisplayError] = useState<string | null>(null);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [voicesOpen, setVoicesOpen] = useState(false);
  /** Down to one button, or the whole strip. Here rather than in the player because pausing re-opens it, and the pause is this screen's. */
  const [collapsed, setCollapsed] = useState(false);
  /**
   * The size to give `<Reader>`, in points, measured rather than inherited.
   *
   * Its `width`/`height` default to `'100%'` and it puts them on the WebView,
   * several wrappers below — the last of them the gesture library's
   * `TouchableWithoutFeedback`, which has no height of its own. A percentage
   * resolves against that, so the WebView lays out at nothing: epub.js renders
   * the section, the highlighter walks it and reports its Blocks, and the page
   * is blank. It looks like a rendering failure and is a layout one, which is
   * why this is measured and passed as numbers.
   *
   * It is measured on the element the document fills, which the player is *over*
   * rather than beside — so this number does not change when the player does.
   */
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const measure = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((was) => (was && was.width === width && was.height === height ? was : { width, height }));
  }, []);

  /**
   * epub.js has displayed the book, so its metadata is in and the highlighter has
   * been installed — the Blocks of the first section are on their way. The
   * language goes in now because it decides how the text is split, and the
   * document's own is the only one that is ever used (ADR 0006).
   */
  const onReady = useCallback(() => {
    setDisplayError(null);
    const meta = getMeta();
    reading.opened(meta.language);
    // The book's own title, which is worth more than the file name the Library
    // has been calling it. Ignored when the EPUB does not say (`use-library.ts`).
    onTitle(meta.title ?? '');
  }, [getMeta, reading, onTitle]);

  /**
   * Where speech got to, written down.
   *
   * The last position is kept in a ref rather than fetched at unmount, because
   * `useReading`'s own cleanup runs first — it is registered first, being a hook
   * of this component — and it clears the Utterance the position would be built
   * from. So the position is taken at each Clip boundary, where everything it
   * needs is certainly still there, and the ref is what leaving the screen
   * writes.
   */
  const status = reading.status;
  const positionRef = useRef<ReadingPosition | null>(null);
  const onReachedRef = useRef(onReached);
  useEffect(() => {
    onReachedRef.current = onReached;
  }, [onReached]);
  const writtenAtRef = useRef(0);

  const readingPosition = reading.readingPosition;
  useEffect(() => {
    const position = readingPosition();
    if (!position) return;
    positionRef.current = position;
    const now = Date.now();
    if (now - writtenAtRef.current < POSITION_INTERVAL_MS) return;
    writtenAtRef.current = now;
    onReachedRef.current(position);
    // Once per Utterance, not once per render: `reading` is a fresh object every
    // render and depending on it would run this on every one of them.
  }, [status.utterance, readingPosition]);

  useEffect(
    () => () => {
      if (positionRef.current) onReachedRef.current(positionRef.current);
    },
    [],
  );

  /**
   * The document's contents, flattened once per document.
   *
   * Here rather than inside the sheet because two things read it now: the sheet,
   * and the lock screen's second line (ADR 0016). Measured on the owner's book at
   * 0.772 ms for all 2,076 entries, so the cost is the memo, not the work.
   *
   * The library types its own entries with a `parent` that is an unreliable id and
   * `subitems: any[]`; `NavigationEntry` is the structural subset
   * `core/document/contents.ts` will trust, and nesting comes from `subitems`.
   */
  const contents = useMemo(() => contentsOf(toc as readonly NavigationEntry[], status.spineHrefs), [toc, status.spineHrefs]);

  /**
   * Pause, and the one path there is.
   *
   * **Pausing re-opens the player** — the assumption is that the owner is about to
   * do something else, go back a sentence or change the Voice, so the controls
   * arriving at that moment is convenient. That line used to live in `player.tsx`,
   * next to the button. It is here now because the lock screen has a pause too
   * (ADR 0016), and a remote press has to leave this screen in a state it agrees
   * with: two pauses written to behave the same is two pauses that will stop
   * behaving the same.
   */
  const pause = useCallback(() => {
    reading.pause();
    setCollapsed(false);
    // `reading` is a fresh object every render; its `pause` is the stable callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading.pause]);

  /**
   * The lock screen, Control Centre and the headphone remote (ADR 0016).
   *
   * Four things it is told, and each one is the value this screen already has:
   * the Document's own title, the part of the book being read, whether the
   * reading is running, and the speed — which is also the rate iOS extrapolates
   * the elapsed time at between the once-a-second pushes `use-reading.ts` makes
   * from the clock.
   *
   * `live` is `status.utterance !== null` and not `status.playing`: an app is the
   * system's now-playing app for as long as it holds an active audio session, so
   * the lock screen has to survive a pause — that is the whole point of it — and
   * cannot appear before the first Clip, because until then there is no session
   * and a press could not reach us.
   *
   * `play` is `reading.play` and `pause` is the one above, which is the same
   * handler the button calls. Nothing here is a second transport.
   */
  useNowPlaying({
    title: document.title,
    chapter: chapterOf(contents, status.section),
    playing: status.playing,
    rate: settings.rate,
    live: status.utterance !== null,
    onIntent: (intent) => (intent === 'play' ? reading.play() : pause()),
  });

  const ready = readiness(settings, keyPresence.state === 'held');
  // Nothing is claimed about a key while the Keychain is still being asked.
  const sayWhatIsMissing = !ready.ready && keyPresence.state !== 'unknown';

  /**
   * Everything the owner has to act on, in one list, so the player draws it without
   * deciding anything. Order is worst first: what is missing before the app can
   * speak at all, then what refused, then what it is doing to the highlight.
   */
  const notes = useMemo(() => {
    const said: string[] = [];
    if (sayWhatIsMissing && !ready.ready) {
      said.push(
        `${readinessSentence(settings.provider, ready.missing)} There is no zero-key path: nothing can be spoken until Settings has what it asks for.`,
      );
    }
    if (keyPresence.state === 'refused') {
      said.push(`The Keychain would not say whether a key is saved: ${keyPresence.message}`);
    }
    if (displayError) said.push(`The document would not display: ${displayError}`);
    if (status.note) said.push(status.note);
    // After what refused and before what is being done to the highlight: where the
    // reading came back to is neither an error nor a property of the Provider.
    if (status.resume) said.push(status.resume);
    const highlight = highlightLine(status);
    if (highlight) said.push(highlight);
    return said;
  }, [sayWhatIsMissing, ready, settings.provider, keyPresence, displayError, status]);

  /**
   * The Voice's locale, when it is known — which is only once the Provider's list
   * has been asked for. See `player.tsx`'s `voiceLine`.
   */
  const voiceLocale = useMemo(() => {
    const listed = voices.voicesOf(settings.provider);
    return listed?.find((voice) => voice.id === settings.voice)?.locale ?? null;
  }, [voices, settings.provider, settings.voice]);

  /**
   * Where the contents list marks: the section the **reading** is in, or the last
   * one the renderer put on the page when nothing has been read yet. The second is
   * coarser and is said to be — it is the page's answer, not the voice's — and it is
   * better than opening the list at the top of a two-thousand-chapter book.
   */
  const at = status.section ?? status.rendered?.index ?? null;

  const chooseVoice = useCallback(
    (provider: ProviderId, voice: string) => {
      onVoice(provider, voice);
    },
    [onVoice],
  );

  return (
    <View style={styles.screen}>
      <View style={styles.document} onLayout={measure}>
        {size ? (
          <Reader
            src={document.base64}
            fileSystem={fileSystem}
            width={size.width}
            height={size.height}
            onReady={onReady}
            initialLocation={resumeAt ?? undefined}
            onDisplayError={setDisplayError}
            renderLoadingFileComponent={() => <Waiting words={`Reading ${document.title}…`} />}
            renderOpeningBookComponent={() => <Waiting words="Laying the document out…" />}
            /**
             * Last, and it carries more than the highlighter: `manager` and
             * `flow` come through here too, because ADR 0011's continuous scroll
             * and the centring that rides on it are one decision with the
             * highlighter, and `src/renderer/` is where it is made. Setting
             * either of them on this element would split it in half.
             */
            {...reading.bridge.readerProps}
          />
        ) : (
          <Waiting words={`Opening ${document.title}…`} />
        )}
      </View>

      <Player
        settings={settings}
        playing={status.playing}
        collapsed={collapsed}
        onCollapsed={setCollapsed}
        enabled={ready.ready || status.playing}
        voiceLocale={voiceLocale}
        reading={readingLine(status, settings)}
        notes={notes}
        onPlay={reading.play}
        onPause={pause}
        onSkip={reading.skip}
        onRate={onRate}
        onContents={() => setContentsOpen(true)}
        onVoices={() => setVoicesOpen(true)}
        onHeight={reading.bridge.setInset}
      />

      <ContentsSheet
        visible={contentsOpen}
        onClose={() => setContentsOpen(false)}
        contents={contents}
        spineKnown={status.spineHrefs.length > 0}
        section={at}
        onGo={reading.goToSection}
      />

      <VoiceSheet
        visible={voicesOpen}
        onClose={() => setVoicesOpen(false)}
        settings={settings}
        lists={voices}
        onChoose={chooseVoice}
      />
    </View>
  );
}

/** Never a blank screen: a blank screen and a crash look identical. */
function Waiting({ words }: { words: string }) {
  return (
    <View style={styles.waiting}>
      <Text style={styles.waitingWords}>{words}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  document: { backgroundColor: INK.page, flex: 1 },
  screen: { backgroundColor: INK.page, flex: 1 },
  waiting: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 32 },
  waitingWords: { color: INK.quiet, fontSize: 15 },
});
