import { useLookup } from './use-lookup';
import { LookupDrawer } from './lookup-drawer';
/**
 * The reader screen: the document, and the player floating over it.
 *
 * The controls are `player.tsx` and the two sheets beside it; what is here is the
 * wiring, and three things worth reading twice.
 *
 * **The player floats.** The document fills the screen and the player is
 * positioned over the bottom of it, so the text does not reflow when the player
 * appears, goes, collapses or expands (ADR 0020). Nothing about `<Reader>`'s size
 * mentions the player, which is what makes that true rather than nearly true. The
 * navigation bar floats over the top the same way and comes and goes with the
 * player (#67, ADR 0048), so `<Reader>`'s size does not mention it either.
 *
 * **Which means the centring has to be told.** ADR 0011 centres the spoken
 * Utterance against the scroll container's own height, and the player now covers
 * the bottom of that container — so the middle of the *visible* text is not the
 * middle of the container, and the difference changes when the player collapses.
 * The player measures itself and the height goes straight to the renderer
 * (`bridge.setInset`), and the bar's goes with it (`bridge.setBar`). It is a live
 * coupling, not a constant: the centring runs once per Utterance on the Clip cue,
 * so an offset that went stale is not corrected by anything.
 *
 * **It says what it is doing.** Which Utterance is being read, at which Highlight
 * Level, and what the last thing to refuse said. `docs/PHILOSOPHY.md` rule 1 is
 * honest signals, and a player that cannot say whether it is highlighting the word
 * or the sentence leaves the owner to guess at exactly the thing this app is for.
 * Those lines live inside the player so that collapsing hides them with the rest.
 *
 * It is rendered by the shell (`reading-host.tsx`, #68) rather than by the
 * Reader screen, and moved into the screen's slot while the Reader shows it, so
 * that it goes on reading when the owner goes back to the Library.
 *
 * It is mounted per Document, keyed by it, so that opening another one starts with
 * a new bridge, a new engine and none of the previous book's Blocks. The renderer
 * keeps its section index outside React (`blocks.ts`), and a remount is the honest
 * way to clear it.
 */

// WALKTHROUGH-HARNESS
import { hlog, probeScript, statusLine, useHarnessCommands, type HarnessCommand } from './walkthrough-harness';

import { Reader, useReader } from '@epubjs-react-native/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { readLocator, type ReadingPlace, type ReadingPosition } from '../core/document';
import { contentsOf, type NavigationEntry } from '../core/document/contents';
import { cutText, debugLog } from '../debug/debug-log';
import { DEBUG_MODE } from '../debug/mode';
import { chapterOf, useNowPlaying } from '../now-playing';
import { MULTILINGUAL, type ProviderId } from '../core/providers/types';

import { ContentsSheet } from './contents-sheet';
import { INK } from './controls';
import type { OpenDocument } from './document';
import { useDocumentCover } from './document-cover';
import { Player } from './player';
import { useReaderFileSystem } from './reader-file-system';
import { useShell } from './routes';
import { TEXT } from './text-styles';
import { NO_PROVIDER_SENTENCE, PROVIDER_LABELS, readiness, readinessNote, type AppSettings } from './settings';
import type { SecretPresence } from './use-provider-secrets';
import { useReading, type ReadingStatus } from './use-reading';
import { useVoiceLists } from './use-voices';
import { voiceInList } from './voices';
import { knownVoice } from './voice-catalog';
import { VoiceSheet } from './voice-sheet';
import { hasSavedVoice, inventoryReady, inventoryError, requestInventory, useDownloads } from '../offline/runtime';

/**
 * How often a Reading Position is written to the Library while the reading is
 * under way, at most.
 *
 * ADR 0019 says the Library file is written after every change, and a Reading
 * Position changes once an Utterance — every few seconds. Rewriting a few tens
 * of kilobytes that often is not expensive, but it is not free either, and the
 * thing being protected is a force-quit: at three seconds a sentence this loses
 * at most the last three or four sentences, which is inside the paragraph the
 * owner was listening to. The Reading's end writes unconditionally, so the
 * ordinary way out loses nothing at all.
 */
const POSITION_INTERVAL_MS = 10_000;

/**
 * How many times the page may be opened again within `PAGE_RESTART_WINDOW_MS`
 * after its web content process ended (#120). One more, and the page is left
 * as it is: a page that ends its process every time it opens would otherwise
 * be reopened for ever, at the cost of a book read in and laid out each time.
 */
const PAGE_RESTARTS = 3;
const PAGE_RESTART_WINDOW_MS = 60_000;

export interface ReadingViewProps {
  /** The held Reading can live above the navigator while its page is hidden. */
  shown: boolean;
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
   * Something about this Document's own Voice that the owner has to be told, or
   * null — which is every ordinary case.
   *
   * Today it is one sentence: a remembered Voice naming a Provider this build does
   * not have, which `unusableVoiceSentence` composes and which means the book is
   * being read in the default Voice instead (ADR 0010). It arrives as a prop rather
   * than being worked out here because the entry it is about belongs to
   * `reader-screen.tsx`, which is the one place that knows which Document is open.
   */
  voiceNote: string | null;
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
   * inside its own `onReady` by asking epub.js to display it. That moves the
   * **page** — a frame later: epub.js runs the display on its next animation
   * frame, and the highlighter installed just after the ask reports what is on
   * the page before then, which is the start of the book (#51).
   *
   * Its anchor is what moves the **reading**: `use-reading.ts` resolves it
   * against the Blocks as they report and hands the Utterance to the engine. The
   * two halves were written together by `readingPositionAt` precisely so that
   * they describe one place, and splitting them here — a CFI to the page and
   * nothing to the voice — is what ADR 0019 recorded as not done.
   */
  position: ReadingPosition | null;
  /**
   * A place that arrived from another device while this book is open, or null
   * (issue #20): `at` is when it arrived, which is what the effect keys on, and
   * `position` is where it points. The reading moves there unless it is playing;
   * then it may move there when it stops (`resumeAt`, #105).
   */
  adopted: { at: number; position: ReadingPlace } | null;
  onRate(rate: number): void;
  /** A Provider and a Voice together: a Voice belongs to exactly one Provider (CONTEXT.md, ADR 0010). */
  onVoice(provider: ProviderId, voice: string): void;
  /** Where speech got to. Called on a Clip boundary at most every `POSITION_INTERVAL_MS`, on a pause, and once more on the way out. */
  onReached(place: ReadingPlace): void;
  /** What the EPUB calls itself, once epub.js has its metadata. */
  onTitle(title: string): void;
  /**
   * How tall the navigation bar over the top of the page is, in points, whether
   * or not it is shown (#67). The screen measures it; the page keeps that much
   * space above the document, and the centring leaves it out while it is shown.
   */
  barHeight: number;
  /**
   * Whether the player is shown in full, which is when the navigation bar is
   * too (#67): they come and go together, so that one state says what is on the
   * screen and any pause or note that brings the player back brings the bar.
   */
  onChrome(shown: boolean): void;
  /**
   * Whether the reading is playing and whether it is waiting for audio (#68):
   * what the Library's Reading Button shows while this view is held out of sight.
   */
  onState(playing: boolean, buffering: boolean): void;
  /**
   * The section the contents list marks (`at` below), for the download drawer to
   * mark and open at the same chapter (#88). The drawer is the screen's, not
   * this view's, so it hears it through the shell as the Reading Button does.
   */
  onSection(section: number | null): void;
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
    const where = `Utterance ${status.utterance + 1} of ${status.known}`;
    if (!status.playing) return `Paused at ${where}.`;
    /**
     * **No Highlight Level until a Clip has answered.** `utterance` is set the
     * moment Play is pressed and `level` only when a Clip arrives with or without
     * Word Timings, so for the second or two between them this line used to claim
     * "highlighting the whole Utterance" — the Level that means the Provider
     * reported no timings. Sub-second on a warm cache and a second or two on a cold
     * one, and it is a claim about the one thing this app exists to do
     * (notes/NOTES_2026-09-20.md, 07:02). Null is not a third Level to name: the
     * sentence simply does not make the claim yet.
     */
    if (status.level === null) return `Reading ${where}.`;
    return `Reading ${where}, highlighting ${status.level === 'word' ? 'the word' : 'the whole Utterance'}.`;
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
  shown,
  document,
  settings,
  voiceNote,
  keyPresence,
  credentialsWrittenAt,
  position,
  adopted,
  onRate,
  onVoice,
  onReached,
  onTitle,
  barHeight,
  onChrome,
  onState,
  onSection,
}: ReadingViewProps) {
  const fileSystem = useReaderFileSystem;
  const { sync, library, setSettings } = useShell();
  /**
   * `toc` as well as `getMeta` now. The library's own template already posts the
   * whole navigation at load and stores it here; nothing in `src/` had read it. It
   * is the other half of the contents list, the first half being the spine's hrefs
   * from the document message.
   */
  // WALKTHROUGH-HARNESS: `injectJavascript` is the harness's only probe into the WebView.
  const { getMeta, toc, injectJavascript, currentLocation } = useReader();
  /**
   * `readLocator` rather than reaching into the position: a `Locator` is opaque
   * by construction (ADR 0007) and this is its one door — it hands back the CFI
   * only if the locator really is one this Document's format can resolve.
   */
  const resumeAt = useMemo(
    () => (position ? readLocator(position.locator, document.identity.format) : null),
    [position, document.identity.format],
  );
  const reading = useReading(settings, { hasKey: keyPresence.state === 'held', writtenAt: credentialsWrittenAt }, position, document.identity.id);
  const lookup = useLookup(settings.lookup, reading, shown);
  useDownloads();
  useEffect(()=>{void requestInventory(document.identity.id,{provider:settings.provider,voice:settings.voice}).catch(()=>{});},[document.identity.id,settings.provider,settings.voice]);
  const savedVoice = hasSavedVoice(document.identity.id, settings.provider, settings.voice);
  useEffect(() => { onState(reading.status.playing, reading.status.buffering); }, [reading.status.playing, reading.status.buffering, onState]);
  const voices = useVoiceLists(settings);
  const [displayError, setDisplayError] = useState<string | null>(null);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [voicesOpen, setVoicesOpen] = useState(false);
  const closeContents = useCallback(() => setContentsOpen(false), []);
  const closeVoices = useCallback(() => setVoicesOpen(false), []);
  /** Down to the Reading Button, or the whole strip and the navigation bar with it (#67). Here rather than in the player because pausing re-opens both, and the pause is this screen's. */
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
    // A zero size is never the page's (#68): it is this view between two places,
    // a slot that has not been laid out yet. Passing it on would resize the
    // WebView, and a resize destroys every epub.js view.
    if (width < 1 || height < 1) return;
    setSize((was) => (was && was.width === width && was.height === height ? was : { width, height }));
  }, []);

  /**
   * The page, and how many times it has been opened again (#120).
   *
   * iOS can end the web content process that draws the book: memory, or a long
   * idle while the app is suspended (on the owner's phone, 13 minutes after a
   * pause, `JETSAM_REASON_MEMORY_LONGIDLE_EXIT`). The WebView is then empty and
   * nothing fills it again, while the Reading, which lives here and not in the
   * page, is untouched. So only `<Reader>` is mounted again, by its key, and the
   * Reading carries on: a voice that was playing keeps playing. The new page
   * opens at the sentence the bridge last cued (`restart()`), else where the old
   * page was, else where the book opened; the bridge paints the sentence once the
   * new page has reported it.
   */
  const [page, setPage] = useState<{ generation: number; at: string | null }>({ generation: 0, at: null });
  const restarts = useRef<number[]>([]);
  const restartBridge = reading.bridge.restart;
  const shownAt = currentLocation?.start?.cfi ?? null;
  const onPageGone = useCallback(() => {
    const now = Date.now();
    restarts.current = [...restarts.current.filter((at) => now - at < PAGE_RESTART_WINDOW_MS), now];
    if (restarts.current.length > PAGE_RESTARTS) {
      debugLog('renderer', `the page's web content process ended, ${restarts.current.length} times in a minute: the page is not opened again`);
      return;
    }
    const at = restartBridge() ?? shownAt ?? resumeAt;
    debugLog('renderer', `the page's web content process ended; the page opens again at ${at ? cutText(at) : 'the start of the book'}`);
    setPage((was) => ({ generation: was.generation + 1, at }));
  }, [restartBridge, shownAt, resumeAt]);

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
   * needs is certainly still there, and the ref is what the Reading's end
   * writes.
   */
  const status = reading.status;
  const positionRef = useRef<ReadingPlace | null>(null);
  const onReachedRef = useRef(onReached);
  useEffect(() => {
    onReachedRef.current = onReached;
  }, [onReached]);
  const writtenAtRef = useRef(0);

  const readingPosition = reading.readingPosition;
  useEffect(() => {
    const position = readingPosition();
    if (!position) {
      // A cursor that yields no place is the sentence a resume landed on: the
      // stored position already is that place, with its true Stamp, and the
      // place held here for the way out must not overwrite it with an older one.
      if (status.utterance !== null) positionRef.current = null;
      return;
    }
    positionRef.current = position;
    const now = Date.now();
    if (now - writtenAtRef.current < POSITION_INTERVAL_MS) return;
    writtenAtRef.current = now;
    onReachedRef.current(position);
    // Once per Utterance, not once per render: `reading` is a fresh object every
    // render and depending on it would run this on every one of them.
  }, [status.utterance, readingPosition]);

  const syncRef = useRef(sync);
  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);
  useEffect(
    () => () => {
      // The Reading ending is a sync moment (issue #20): the place is written
      // first, so the run that follows carries it. It ends when the Reader goes
      // while it is paused, when another document is opened, and when this one
      // is deleted (#68); going back while it plays does not unmount this view.
      if (positionRef.current) onReachedRef.current(positionRef.current);
      syncRef.current.poke('leave');
    },
    [],
  );

  /**
   * A place from another device, while this book is open (issue #20). Keyed on
   * when it arrived, so each arrival is offered once. `resumeAt` declines it
   * while playing and settles it itself when the reading stops (#105). An arrival
   * Play has already passed on from its own sync is held or being read by then,
   * and is taken once (#54).
   */
  const takePlace = reading.resumeAt;
  useEffect(() => {
    // Taken, so the place held for the way out is the adopted one — which is
    // already stored and is not written again (`use-reading.ts`, `resumedAtRef`).
    if (adopted && takePlace(adopted.position)) positionRef.current = null;
  }, [adopted, takePlace]);

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
   * **Pausing re-opens the player**, and the navigation bar with it (#67) — the assumption is that the owner is about to
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
    lookup.stopPronunciation(false);
    // A pause is a sync moment (issue #20), and the moment a locked phone may
    // be suspended, so the place is written now rather than at the ten-second
    // mark and the run starts at once.
    const place = readingPosition();
    if (place) {
      positionRef.current = place;
      writtenAtRef.current = Date.now();
      onReachedRef.current(place);
    }
    sync.poke('pause');
    // `reading` is a fresh object every render; its `pause` is the stable callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading.pause, readingPosition, sync, lookup.stopPronunciation]);

  /**
   * Play, after one look at the folder (issue #20): a place from another device
   * that is newer than this one wins while the book is paused, so the run is
   * waited for — up to `WAIT_MS` — and the reading starts from wherever is
   * newest. The outcome is that run's own, so a sync queued meanwhile cannot
   * hide what it adopted; and a place whose section has not rendered yet is
   * waited for by `reading.play()` rather than given up (#54). Past the bound,
   * or with the server down, it starts from here. A place the run takes after
   * that does not move the reading while it plays; the Reading keeps it and
   * takes it when it stops, unless the reading has moved on since (#105).
   */
  const play = useCallback(() => {
    lookup.stopPronunciation(false);
    void sync.wait('play').then((outcome) => {
      if (outcome && outcome !== 'late' && outcome.adopted.includes(document.identity.id)) {
        const place = library.current(document.identity.id)?.position;
        if (place && reading.resumeAt(place)) positionRef.current = null;
      }
      reading.play();
    });
    // `reading` is a fresh object every render; the two callbacks are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading.play, reading.resumeAt, sync, library, document.identity.id, lookup.stopPronunciation]);

  /**
   * The lock screen, Control Centre and the headphone remote (ADR 0016).
   *
   * Five things it is told, and each one is the value this screen already has:
   * the Document's own title, the part of the book being read, its Cover — the
   * one the Library shows, or none, for which Now Playing shows the app's icon
   * (#119) — whether the reading is running, and the speed, which is also the
   * rate iOS extrapolates the elapsed time at between the once-a-second pushes
   * `use-reading.ts` makes from the clock.
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
  const cover = useDocumentCover(document.identity);
  useNowPlaying({
    title: document.title,
    chapter: chapterOf(contents, status.section),
    cover,
    playing: status.playing,
    rate: settings.rate,
    live: status.utterance !== null,
    onIntent: (intent) => (intent === 'play' ? play() : pause()),
  });

  const ready = readiness(settings, keyPresence.state === 'held');
  // Nothing is claimed about a key while the Keychain is still being asked.
  const sayWhatIsMissing = inventoryReady(document.identity.id) && !savedVoice && !ready.ready && keyPresence.state !== 'unknown';
  const inventoryProblem=inventoryError(document.identity.id);

  /** Only actionable problems occupy the player; routine status stays in diagnostics. */
  const notes = useMemo(() => {
    const said: { said: string; attention: boolean }[] = [];
    // Each sentence once, whichever of its sources says it: the readiness
    // sentence below and a refused Play's `status.note` are the same words (#72).
    // While the Voice sheet is open with nothing enabled, it says so itself, just
    // below this line: `Enable a provider in Settings to choose a voice.` (#103).
    const hidden = voicesOpen ? NO_PROVIDER_SENTENCE : null;
    const say = (words: string, attention: boolean) => {
      if (words !== hidden && !said.some((note) => note.said === words)) said.push({ said: words, attention });
    };
    // First, because it says which Provider the sentence below is even about.
    if (voiceNote) say(voiceNote, true);
    const missing = sayWhatIsMissing ? readinessNote(settings.provider, ready) : null;
    if (missing) say(missing, true);
    if (keyPresence.state === 'refused' && !savedVoice) say(`The Keychain would not say whether a key is saved: ${keyPresence.message}`, true);
    if (displayError) say(`The document would not display: ${displayError}`, true);
    if (status.resumeNeedsAttention && status.resume) say(status.resume, true);
    if (status.note) say(status.note, true);
    if (inventoryProblem) say(`Saved audio could not be checked: ${inventoryProblem}`, true);
    if (status.voiceError && !voicesOpen) say(status.voiceError, true);
    return said;
  }, [voiceNote, sayWhatIsMissing, ready, settings.provider, keyPresence, displayError, status, voicesOpen, savedVoice, inventoryProblem]);

  /**
   * Whether the player is shown in full, and with it the navigation bar (#67).
   *
   * The player's own rule, `collapsed && notes.length === 0`, made the screen's:
   * a note is a thing the owner has not been told, so it opens the player, and
   * the bar comes with it. The bar floats, so what it covers goes to the
   * centring while it is shown and nothing when it is not; the space the page
   * keeps for it stays either way, so the text does not move.
   */
  const chrome = !(collapsed && notes.length === 0);
  useEffect(() => { onChrome(chrome); }, [chrome, onChrome]);
  const setBar = reading.bridge.setBar;
  useEffect(() => { setBar(chrome ? barHeight : 0, barHeight); }, [chrome, barHeight, setBar]);
  /**
   * The player down to the Reading Button (#67), which is exactly when it draws
   * no note and the bar is hidden (`chrome` above), and then the page only
   * follows (#71, ADR 0050): the collapsed player has no M to bring a browsed
   * page back with, so no finger may take it away, and one already taken comes
   * back as it collapses. The Reading Button only opens the player, which ends
   * it.
   */
  const followOnly = !chrome;
  useEffect(() => {
    reading.bridge.setFollowOnly(followOnly);
  }, [reading.bridge, followOnly]);

  /**
   * The Voice in use as its own Provider describes it — the name it publishes and
   * the locale, when there is one — or null until a list holding it has been asked
   * for. See `player.tsx`'s `voiceLine` for why nothing is fetched to fill it.
   */
  const voiceInUse = useMemo(() => {
    const found = voiceInList(voices.voicesOf(settings.provider), settings.voice) ?? knownVoice(settings);
    return found ? { label: found.label, locale: found.locale === MULTILINGUAL ? '' : found.locale } : null;
  }, [voices, settings]);

  /**
   * Where the contents list marks: the section the **reading** is in, or the last
   * one the renderer put on the page when nothing has been read yet. The second is
   * coarser and is said to be — it is the page's answer, not the voice's — and it is
   * better than opening the list at the top of a two-thousand-chapter book.
   */
  const at = status.section ?? status.rendered?.index ?? null;
  useEffect(() => { onSection(at); }, [at, onSection]);

  const selectReadingVoice = reading.chooseVoice;
  const chooseVoice = useCallback(
    (provider: ProviderId, voice: string) => {
      selectReadingVoice(provider, voice, () => onVoice(provider, voice));
    },
    [onVoice, selectReadingVoice],
  );

  // WALKTHROUGH-HARNESS
  useHarnessCommands((command: HarnessCommand) => {
    const what = String(command.do);
    if (what === 'play') return reading.play();
    if (what === 'pause') return pause();
    if (what === 'seek') {
      hlog(`seek -> ${Number(command.utterance)} (status.known=${status.known})`);
      reading.seekTo(Number(command.utterance));
      hlog(`seek done, status.utterance=${status.utterance}`);
      return;
    }
    if (what === 'skip') return reading.skip(command.target as never);
    if (what === 'section') return reading.goToSection(Number(command.section));
    if (what === 'rate') return onRate(Number(command.rate));
    if (what === 'collapse') return setCollapsed(Boolean(command.on));
    if (what === 'contents') return setContentsOpen(Boolean(command.on));
    if (what === 'voicesheet') {
      setVoicesOpen(Boolean(command.on));
      if (command.on) voices.ask((command.provider ?? settings.provider) as ProviderId);
      return;
    }
    if (what === 'voice') return chooseVoice(command.provider as ProviderId, String(command.voice));
    if (what === 'ask') {
      voices.ask(command.provider as ProviderId);
      return;
    }
    if (what === 'voicelist') {
      const list = voices.voicesOf(command.provider as ProviderId);
      hlog(`voicelist ${String(command.provider)} n=${list === null ? 'null' : list.length} asking=${voices.asking(command.provider as ProviderId)} note=${JSON.stringify(voices.note)}`);
      const want = String(command.locale ?? '');
      for (const one of (list ?? []).filter((v) => !want || v.id.startsWith(want)).slice(0, Number(command.n ?? 8)))
        hlog(`  voice ${one.id} | ${one.label} | ${one.locale}`);
      return;
    }
    if (what === 'say') {
      hlog(
        `status playing=${status.playing} utterance=${status.utterance} known=${status.known} section=${status.section} ` +
          `rendered=${status.rendered?.index ?? null}/${status.rendered?.spine ?? null} level=${status.level} ` +
          `reportsWordTimings=${status.reportsWordTimings} seeking=${status.seeking} spine=${status.spineHrefs.length} ` +
          `lang=${JSON.stringify(status.language)} collapsed=${collapsed} at=${at} contents=${contents.rows.length}`,
      );
      hlog(`line=${JSON.stringify(readingLine(status, settings))} highlight=${JSON.stringify(highlightLine(status))}`);
      hlog(`voiceInUse=${JSON.stringify(voiceInUse)} provider=${settings.provider} voice=${settings.voice} rate=${settings.rate}`);
      hlog(`appearance=${JSON.stringify(settings.appearance)} theme=${settings.theme} ready=${ready.ready}`);
      for (const one of notes) hlog(`note attention=${one.attention} ${JSON.stringify(one.said)}`);
      return;
    }
    if (what === 'js') {
      injectJavascript(probeScript(String(command.code)));
      return;
    }
  });
  const watched = useRef({ line: '', ticks: 0 });
  useEffect(() => {
    const timer = setInterval(() => {
      const line = statusLine(status, AppState.currentState);
      watched.current.ticks += 1;
      if (line === watched.current.line && watched.current.ticks % 10 !== 0) return;
      watched.current.line = line;
      hlog(line);
    }, 500);
    return () => clearInterval(timer);
  }, [status]);


  return (
    <View style={styles.screen} onTouchEnd={reading.bridge.releaseSelection} onTouchCancel={reading.bridge.releaseSelection}>
      <View style={styles.document} onLayout={measure}>
        {size ? (
          <Reader
            key={page.generation}
            src={document.base64}
            fileSystem={fileSystem}
            width={size.width}
            height={size.height}
            onReady={onReady}
            initialLocation={(page.generation > 0 ? page.at : resumeAt) ?? undefined}
            onContentProcessDidTerminate={onPageGone}
            onDisplayError={setDisplayError}
            renderLoadingFileComponent={() => <Waiting words={`Reading ${document.title}…`} />}
            renderOpeningBookComponent={() => <Waiting words="Laying the document out…" />}
            // Safari's Web Inspector reaches the page in Debug Mode (ADR 0054).
            webviewDebuggingEnabled={DEBUG_MODE}
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

      {!lookup.selection ? <Player
        settings={settings}
        playing={status.playing}
        buffering={status.buffering}
        collapsed={collapsed}
        onCollapsed={setCollapsed}
        enabled={savedVoice || ready.ready || status.playing || !settings.enabledProviders.includes(settings.provider) || !settings.voice.trim()}
        voiceInUse={voiceInUse}
        notes={notes}
        onPlay={() => { if ((!settings.enabledProviders.includes(settings.provider) && inventoryReady(document.identity.id) && !savedVoice) || !settings.voice.trim()) setVoicesOpen(true); else play(); }}
        onPause={pause}
        onSkip={reading.skip}
        onRate={onRate}
        onContents={() => setContentsOpen(true)}
        onVoices={() => setVoicesOpen(true)}
        following={status.following}
        onReturn={reading.returnToReading}
        onHeight={reading.bridge.setInset}
        onOpenHeight={reading.bridge.setOpenPlayer}
      /> : null}

      <LookupDrawer lookup={lookup} service={settings.lookup.service}
        onService={(service) => setSettings((was) => ({ ...was, lookup: { ...was.lookup, service } }))} />

      <ContentsSheet
        visible={contentsOpen}
        onClose={closeContents}
        contents={contents}
        spineKnown={status.spineHrefs.length > 0}
        section={at}
        onGo={reading.goToSection}
      />

      <VoiceSheet
        visible={voicesOpen}
        onClose={closeVoices}
        settings={settings}
        lists={voices}
        pending={status.pendingVoice}
        error={status.voiceError}
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
  waitingWords: { ...TEXT.subhead, color: INK.quiet },
});
