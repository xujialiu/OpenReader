/**
 * The reader screen: the document, and the three controls that act on it.
 *
 * Play, pause, speed. There is nothing else here because there is nothing else
 * to be honest about yet — and what there is says what it is doing: which
 * Utterance is being read, at which **Highlight Level**, in which language, and
 * what the last thing to refuse said. `docs/PHILOSOPHY.md` rule 1 is honest
 * signals, and a player that cannot say whether it is highlighting the word or
 * the sentence leaves the owner to guess at exactly the thing this app is for.
 *
 * It is mounted per Document, keyed by it, so that opening another one starts
 * with a new bridge, a new engine and none of the previous book's Blocks. The
 * renderer keeps its section index outside React (`blocks.ts`), and a remount is
 * the honest way to clear it.
 */

import { Reader, useReader } from '@epubjs-react-native/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import type { ReadingPosition } from '../core/document';

import { Action, Choice, INK, Note } from './controls';
import type { OpenDocument } from './document';
import { useReaderFileSystem } from './reader-file-system';
import { PROVIDER_LABELS, READING_RATES, readiness, readinessSentence, type AppSettings } from './settings';
import type { KeyPresence } from './use-provider-key';
import { useReading, type ReadingStatus } from './use-reading';

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
  keyPresence: KeyPresence;
  /**
   * The CFI to open at, out of the stored Reading Position, or null for a
   * Document that has not been read.
   *
   * It goes to `<Reader initialLocation>`, which the library applies inside its
   * own `onReady` — before it injects the highlighter, so the section that
   * reports its Blocks first is the one the owner was left in rather than the
   * cover.
   */
  resumeAt: string | null;
  onRate(rate: number): void;
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
  if (status.known > 0) return `${status.known} Utterances ready.`;
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

export function ReadingView({ document, settings, keyPresence, resumeAt, onRate, onReached, onTitle }: ReadingViewProps) {
  const fileSystem = useReaderFileSystem;
  const { getMeta } = useReader();
  const reading = useReading(settings, keyPresence.state === 'held');
  const [displayError, setDisplayError] = useState<string | null>(null);
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

  const ready = readiness(settings, keyPresence.state === 'held');
  const highlight = highlightLine(status);
  // Nothing is claimed about a key while the Keychain is still being asked.
  const sayWhatIsMissing = !ready.ready && keyPresence.state !== 'unknown';

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

      <View style={styles.bar}>
        <View style={styles.transport}>
          <Action
            label={status.playing ? 'Pause' : 'Play'}
            primary
            onPress={status.playing ? reading.pause : reading.play}
            disabled={!ready.ready && !status.playing}
          />
          <Choice options={READING_RATES} value={settings.rate} onChange={onRate} labelOf={(rate) => `${rate}×`} />
        </View>

        <Text style={styles.reading}>{readingLine(status, settings)}</Text>

        {sayWhatIsMissing && !ready.ready ? (
          <Note attention>
            {readinessSentence(settings.provider, ready.missing)} There is no zero-key path: nothing can be spoken until
            Settings has what it asks for.
          </Note>
        ) : null}

        {keyPresence.state === 'refused' ? (
          <Note attention>The Keychain would not say whether a key is saved: {keyPresence.message}</Note>
        ) : null}

        {highlight ? <Note>{highlight}</Note> : null}

        <Note>
          {PROVIDER_LABELS[settings.provider]} · {settings.voice || 'no Voice'} ·{' '}
          {status.language
            ? `${status.language.language}${status.language.declared ? '' : ' (the document declares no language)'}`
            : 'language unknown until the document opens'}
        </Note>

        {displayError ? <Note attention>The document would not display: {displayError}</Note> : null}
        {status.note ? <Note attention>{status.note}</Note> : null}
      </View>
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
  bar: {
    backgroundColor: INK.panel,
    borderTopColor: INK.line,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
    paddingBottom: 28,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  document: { backgroundColor: INK.page, flex: 1 },
  reading: { color: INK.reading, fontSize: 15, fontWeight: '600' },
  screen: { backgroundColor: INK.page, flex: 1 },
  transport: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  waiting: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 32 },
  waitingWords: { color: INK.quiet, fontSize: 15 },
});
