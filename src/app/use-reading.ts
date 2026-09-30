/**
 * Where the six modules meet: Blocks in, Utterances out, a Provider built from
 * the owner's settings, and **one clock** feeding the highlight.
 *
 * The integration is that last part, and it is two lines: the renderer's bridge
 * implements `ReaderClock`, and that clock is what `createPlaybackEngine` is
 * given. Nothing interpolates a position on the React Native side, nothing reads
 * a wall clock, and nothing estimates a Word Timing — the engine scales the
 * Provider's timings once per Clip and the WebView interpolates against
 * `requestAnimationFrame` between corrections (ADR 0005, ADR 0012). That is the
 * whole of "the highlight does not drift".
 *
 * Almost nothing is decided here. The order things happen in is:
 *
 * 1. the renderer reports **Blocks** (`onBlocks`),
 * 2. `segment.ts` turns them into **Utterances**,
 * 3. `settings.ts` turns the owner's settings and the key into a **Provider**,
 * 4. the engine plays the Utterances and drives the clock the renderer reads.
 *
 * Each of those steps is a call into a module that owns it. What is left here —
 * and the only thing worth reading twice — is *when* the engine is given a new
 * Utterance list, because the list grows while the reading is under way. See
 * `adopt`.
 *
 * ## Two rules this file obeys and could quietly break
 *
 * - **No playback position in React state** (ADR 0005). `onPosition` touches no
 *   state at all; it hands the correction to the bridge and returns. The one
 *   thing the screen learns from the clock is which Utterance a Clip belongs to
 *   and at which Highlight Level it is drawn — once per sentence, which is
 *   seconds apart, not the once-a-second position and certainly not per word.
 * - **The key is a setting** (ADR 0002). It is read from the Keychain here and
 *   passed to `createProvider` through `providerSettings`. No Provider reaches
 *   for it, and it is never held in React state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useColorScheme } from 'react-native';

import { asDocumentId, createLocator, readLocator, readingPlaceAt, type ReadingPlace } from '../core/document';
import { hasSavedVoice, inventoryReady, offlineProvider } from '../offline/runtime';
import type { ProviderId } from '../core/providers/types';
import type { Utterance } from '../core/segmenter';
import { debugLog } from '../debug/debug-log';
import { consent, isDeclined } from './consent';
import { lockScreenPosition } from '../now-playing';
import {
  createPlaybackEngine,
  nextParagraph,
  nextSentence,
  previousParagraph,
  previousSentence,
  type OutOfTextReport,
  type PlaybackEngine,
  type ReaderClock,
} from '../playback';
import {
  awaitedSection,
  canonicalCfi,
  resolveResume,
  resumeSentence,
  spineIndexOf,
  useReaderBridge,
  type ProblemMessage,
  type ReaderBridge,
  type RenderedSection,
  type ReportedBlock,
  type ReportedDocument,
} from '../renderer';

import { readBodyTextSize, writeBodyTextSize } from './body-text-sizes';
import {
  carryUtterance,
  documentLanguage,
  firstUtteranceOfSection,
  outOfTextSentence,
  readingFromRow,
  samePrefix,
  segmentDocument,
  type Segmented,
} from './segment';
import {
  engineIdentity,
  readiness,
  readinessNote,
  resolveTheme,
  type AppSettings,
} from './settings';
import { samePlace } from './sync-items';

/** How much text is marked as it is spoken (CONTEXT.md). Which one is in use is the Provider's answer, never a preference. */
export type HighlightLevel = 'word' | 'utterance';

/**
 * The four skip buttons, by name.
 *
 * Names and not indices because the arithmetic belongs to `playback/navigation.ts`
 * — which is written, tested and has the one divergence from Zotero in it — and a
 * screen that computed its own target would be a second copy of that rule.
 */
export type SkipTarget = 'previous-paragraph' | 'previous-sentence' | 'next-sentence' | 'next-paragraph';

/** Everything the player bar and the status line show. Nothing in here changes more than once per Utterance. */
export interface ReadingStatus {
  playing: boolean;
  buffering: boolean;
  pendingVoice: { provider: ProviderId; voice: string } | null;
  voiceError: string | null;
  /** The Utterance the Clip now playing speaks, or null before the first one. */
  utterance: number | null;
  /** How many Utterances the renderer has reported text for so far. It grows as epub.js renders further sections. */
  known: number;
  /**
   * The section the renderer reported last, or null before any has rendered.
   *
   * Here because `known === 0` is two different states and the screen was saying
   * the wrong one of them for ever. Null is a document that has not started; a
   * section with `known === 0` is a section that rendered and holds no text — a
   * cover page, which is how most EPUBs begin.
   */
  rendered: RenderedSection | null;
  /** True while Play is walking the document forward to the first section that has text in it. */
  seeking: boolean;
  /** The Highlight Level of the Clip now playing, taken from whether it carried Word Timings. Null until one is playing. */
  level: HighlightLevel | null;
  /** What the Provider says of itself before any Clip has proved it (`capabilities.wordTimestamps`). Null until one is built. */
  reportsWordTimings: boolean | null;
  /** The language the Utterances were split with, and whether the document declared it. */
  language: { language: string; declared: boolean } | null;
  /**
   * The spine item the **reading** is in, or null before a Clip has played.
   *
   * Not `rendered.index`, which is the last section epub.js happened to render —
   * under a continuous layout that is routinely a section ahead of or behind the
   * one being spoken. This is the section of the Block the current Utterance's
   * first span came from, which is the number `contentsOf`'s `currentRow` takes
   * (ADR 0020), and it is the only granularity the contents can resolve at.
   */
  section: number | null;
  /**
   * Every spine item's href, in spine order, from the document message.
   *
   * Empty until it arrives. It is here rather than behind a callback of its own
   * because the contents list is built from it and a list cannot read a ref: it
   * crosses once per document, so the one re-render it costs is one.
   */
  spineHrefs: readonly string[];
  /** The last thing that went wrong or was refused, in the words whatever refused it used. Shown, never swallowed (philosophy rule 1). */
  note: string | null;
  /**
   * What became of the Document's stored Reading Position (ADR 0008), in one
   * sentence, or null for a Document that had none.
   *
   * Its own field rather than a second use of `note`, because `note` means
   * something went wrong and a resume that worked is the ordinary case. ADR 0011
   * records what widening a channel like that costs: "widening it to also mean
   * 'the page was rebuilt' is how a protocol starts lying."
   *
   * It changes at most twice in a Document's life — once when the position
   * resolves, once if it is given up on — so it costs the re-renders a Reading
   * Position itself is kept out of state to avoid (ADR 0005).
   */
  resume: string | null;
  /** A lost or changed resume needs attention even when routine status is hidden. */
  resumeNeedsAttention: boolean;
  /**
   * Whether the page follows the reading — the player's **A** — or the owner is
   * browsing — its **M** (#71). The renderer's answer, reported only when it
   * changes: a drag, a Contents row while paused, M, a revealed highlight.
   */
  following: boolean;
}

const NOTHING_YET: ReadingStatus = {
  playing: false,
  buffering: false,
  pendingVoice: null,
  voiceError: null,
  utterance: null,
  known: 0,
  rendered: null,
  seeking: false,
  level: null,
  reportsWordTimings: null,
  language: null,
  section: null,
  spineHrefs: [],
  note: null,
  resume: null,
  resumeNeedsAttention: false,
  following: true,
};

export interface Reading {
  /** Spread `bridge.readerProps` onto `<Reader>`; everything else the screen needs is here. */
  bridge: ReaderBridge;
  status: ReadingStatus;
  /** The document is open and epub.js has displayed it. `language` is the EPUB's own `dc:language`, which is never sniffed (ADR 0006). */
  opened(language: string | null | undefined): void;
  play(): void;
  pause(): void;
  chooseVoice(provider: ProviderId, voice: string, selected: () => void): void;
  /**
   * Read from this Utterance (ADR 0020).
   *
   * What tapping a word and tapping a contents row both end in, and what the four
   * skips below are: **six controls, one seek**, which is ADR 0020's whole
   * argument. All of it happens at the press: the highlight moves, the sound
   * stops and the sentence is asked for (#86).
   *
   * It does not resume a paused reading and it does not pause a playing one: the
   * engine's own `seek` is `restart(); pump()` with deliberately no `resume()`, so
   * navigating while paused moves the highlight and leaves the silence alone —
   * which is Zotero's behaviour, verified in its source (ADR 0020).
   *
   * This is a tapped word: the owner pointing the reading at a sentence, which
   * makes that sentence the Reading Position even before anything is spoken
   * (CONTEXT.md, #52).
   */
  seekTo(utterance: number): void;
  /** One of the four skips, computed by `playback/navigation.ts` from where the reading is. */
  skip(target: SkipTarget): void;
  /**
   * M on the player (#71, #53): the page goes back to the reading's sentence and
   * follows it again. It moves nothing else and starts nothing — a paused
   * reading stays paused, a playing one keeps its words.
   */
  returnToReading(): void;
  /**
   * A contents row: move the page to a spine item, and — while playing, or in a
   * book with no Reading Position yet — read from its first Utterance.
   *
   * **Paused, it is Browsing** (CONTEXT.md, #52): the page goes to the chapter,
   * and the reading, its highlight and the stored place stay on the sentence the
   * reading is on, which is where Play continues.
   *
   * Otherwise **two steps** (ADR 0020). The page moves; the Utterance to read
   * from does not exist until that section has rendered and reported its Blocks,
   * so the second step waits for them — unless the section has already rendered,
   * in which case it happens now.
   */
  goToSection(section: number): void;
  /**
   * Where speech has got to, as a **Reading Position** (ADR 0008), or null
   * before a Clip has played — and while a stored place is still pending, which
   * the stored position already is (#54).
   *
   * A function and not a field, and that is the whole of its design. A Reading
   * Position changes once per Utterance, which is often enough that putting it
   * in `ReadingStatus` would make the screen re-render for something it does not
   * draw — and ADR 0005's rule about playback position exists because that
   * re-render is what blows the frame budget. Nothing here touches state; the
   * caller asks when it is about to write the Library.
   */
  readingPosition(): ReadingPlace | null;
  /**
   * A place that arrived from another device while this book is open (issue
   * #20): move the reading there, unless it is playing.
   *
   * Paused or not yet started, the newest place wins — the highlight and the
   * page go to that sentence through the same seek a tapped word takes, and
   * pressing Play reads from it. Playing, nothing moves: the reading here is
   * newer than anything that could arrive, and being dragged somewhere else
   * mid-sentence is the failure design 0020 keeps out of the player. Returns
   * whether the place was taken; a place whose section has not rendered yet
   * is held and tried on every report, like the one the book opened with, and a
   * Play pressed meanwhile waits for it (#54). The place already held is taken
   * once, however many times it is passed.
   */
  resumeAt(place: ReadingPlace): boolean;
}

/** Whatever refused, in its own words. A `SynthesisError`'s message already names the address it tried and asks the one question there is. */
function describe(problem: unknown): string {
  return problem instanceof Error ? problem.message : String(problem);
}

/**
 * What the screen knows about the owner's credentials, which is deliberately not
 * the credentials.
 *
 * `hasKey` decides what `readiness` may claim; the value itself is read from the
 * Keychain in `build` and handed straight on (ADR 0002). `writtenAt` is the
 * shell's count of credential writes and is here for one reason: an engine built
 * around a key or a gateway token that has since been replaced would go on using
 * the old one, so pasting the right token and still being refused would look
 * exactly like pasting the wrong one.
 */
export interface KnownCredentials {
  hasKey: boolean;
  writtenAt: number;
}

/**
 * @param resume the Document's stored Reading Position, or null for one that has
 * not been read. Taken once, at mount: this hook is mounted per Document
 * (`reading-view.tsx` keys it by the Document Id) and the position is rewritten
 * every few sentences while the reading runs, so a value that kept arriving
 * would be the reading chasing its own tail.
 */
export function useReading(settings: AppSettings, credentials: KnownCredentials, resume: ReadingPlace | null, document: string): Reading {
  const { hasKey, writtenAt } = credentials;
  /**
   * The theme the page is painted in (ADR 0022), resolved the same way the shell
   * resolves the app's own — one function, so the chrome and the document cannot
   * end up in different themes with a white rectangle between them.
   */
  const scheme = resolveTheme(settings.theme, useColorScheme());
  const [status, setStatus] = useState<ReadingStatus>(NOTHING_YET);
  // The Reading's notes and errors, as the owner saw them, in the Debug Log (ADR 0054).
  const { note, voiceError } = status;
  useEffect(() => { if (note) debugLog('reading', `note: ${note}`); }, [note]);
  useEffect(() => { if (voiceError) debugLog('reading', `voice error: ${voiceError}`); }, [voiceError]);

  const engineRef = useRef<PlaybackEngine | null>(null);
  const playIntent = useRef(false);
  /**
   * Play has been pressed and its first cue has not yet gone to the renderer
   * (#71). That cue is the owner asking for the reading, and it is revealed: it
   * ends Browsing, wherever the page is. Every cue after it while the reading
   * plays on is the reading moving on, which follows but leaves a page the
   * owner took away where they put it (`RevealOptions.recover`).
   */
  const revealCue = useRef(false);
  const switchRequest = useRef(0);
  const pendingChoice = useRef<{ provider: ProviderId; voice: string } | null>(null);
  const retainedIdentity = useRef<string | null>(null);
  const bridgeRef = useRef<ReaderBridge | null>(null);
  /** Being built: a second press of play must not build a second engine and a second audio session. */
  const buildingRef = useRef<Promise<PlaybackEngine | null> | null>(null);
  /** The Utterances the engine holds. Its indices are what every cue and every correction is about. */
  const loadedRef = useRef<readonly Utterance[]>([]);
  /**
   * The Blocks `loadedRef`'s Utterances were segmented from: the array their
   * `UtteranceSpan.block` indexes into.
   *
   * Not `blocksRef`, which `handleBlocks` replaces before the list it segmented is
   * adopted, and which a report holding nothing to read replaces without one. A
   * renumbering names the sentence the reading is on by its Block (#46), and that
   * takes the Blocks of the list the reading is on.
   */
  const loadedBlocksRef = useRef<readonly ReportedBlock[]>([]);
  /** The Utterance being read, outside React state, so the callbacks below are never one render behind. */
  const atRef = useRef<number | null>(null);
  /** The section the renderer reported last, for the same reason: `play` reads it at the moment it is pressed. */
  const renderedRef = useRef<RenderedSection | null>(null);
  /**
   * The **furthest** spine item that has reported its Blocks, which is not
   * `renderedRef`: sections render out of order and the last one to report is
   * routinely behind the furthest one.
   *
   * It exists to tell the two ends of a reading apart. A reading that has run out
   * of Utterances at the last spine item has reached the end of the book, which is
   * an ordinary thing to say; one that has run out anywhere else has run out of
   * *rendered* text, which is the defect of 2026-09-20 04:43 and a different
   * sentence. Counting Block `sectionIndex`es would miss a section that rendered
   * and held no text, and the end of a book is exactly where those live.
   */
  const furthestSectionRef = useRef(-1);
  /**
   * Every spine item that has reported, including one that held no Block — which
   * `blocksRef` cannot say, and which is what a stored place asks before it looks
   * for its words anywhere (`resolveResume`, #51). Only ever grows: a section's
   * Blocks are kept once reported (`blocks.ts`).
   */
  const reportedSectionsRef = useRef(new Set<number>());
  /**
   * The Blocks the Utterances were segmented from — the very array the renderer
   * sent, because `UtteranceSpan.block` is an index into it.
   *
   * Kept only so that a Reading Position can be built: ADR 0008 needs the
   * Block's CFI, the Block's own verbatim text and the Utterance's span within
   * it, and this is the only place all three are in one hand.
   */
  const blocksRef = useRef<readonly ReportedBlock[]>([]);
  /**
   * Play was pressed with nothing to read.
   *
   * It stays true while the document is walked forward to the first section that
   * has text, and is cleared by the effect that starts the reading there.
   */
  const seekingRef = useRef(false);
  const languageRef = useRef('en');
  /**
   * The spine item a contents tap is waiting on, or null.
   *
   * The second half of that tap: the page has been moved and the reading cannot
   * follow until the section reports its Blocks, because until then it has no
   * Utterance to seek to (`readingFromRow`). `onward` is a row pressed while
   * playing: the engine is silenced for the wait, and a section that reports with
   * no text is read past (#86).
   */
  const pendingSectionRef = useRef<{ section: number; onward: boolean } | null>(null);
  /**
   * The stored Reading Position, until an Utterance has been found for it.
   *
   * It cannot be resolved at mount: the anchor is matched against **Blocks**, and
   * no section has reported any yet. So it waits here and every `onBlocks` tries
   * again. The first sections to report are **not** the ones around the stored
   * CFI: the highlighter installs, and reports what is on the page, before epub.js
   * runs the display `<Reader initialLocation>` asked for, so they are the start
   * of the book (#51, measured 2026-09-23). The place waits for its own section
   * rather than looking for its words in those (`resolveResume`).
   */
  const resumeRef = useRef<ReadingPlace | null>(resume);
  /**
   * The Utterance a resume landed on, while the cursor is still there.
   *
   * The stored Reading Position already **is** that place, with its true Stamp —
   * the desktop's, when the place came from there. Writing it again would put
   * this device's name and a newer time on a sentence nobody has read here
   * (measured 2026-09-21: +200 ms and +473 ms after the desktop's stamp), the
   * upload would carry it, and the desktop would then take its own place back
   * under the phone's name. ADR 0031: a position's Stamp moves only when speech
   * stops somewhere new. So `readingPosition()` answers null while the cursor is
   * exactly here, and this is cleared the moment it moves for any other reason.
   */
  const resumedAtRef = useRef<number | null>(null);
  /**
   * Nothing in this Document is a Reading Position yet: it opened with no stored
   * place, no place has arrived from another device, and nothing has been
   * played, tapped or skipped to.
   *
   * While that holds, a Contents row still chooses where the first Play starts —
   * the most recent choice winning — and the choice is not a Reading Position, so
   * nothing is written for it (#52). A Contents row cannot end this: only the
   * reading being played or pointed at does, and after that a row while paused
   * is Browsing. Without the exception, Play in a book opened for the first time
   * and taken to chapter 5 would read the book's first line and pull the page
   * back there, which is the failure #46 fixed.
   */
  const unreadRef = useRef(resume === null);
  /**
   * A place taken from another device is pending and may name a section that
   * has not rendered. The place a book *opens* with is displayed by
   * `<Reader initialLocation>`; an adopted one arrives after that and nothing
   * displays its section for it — measured 2026-09-21: a fixture handed over
   * while nothing was open opened at chapter 1 and the adopted place, three
   * sections on, sat pending for sixteen minutes until the owner swiped there.
   * So `revealPendingPlace` asks the renderer for that section, from `resumeAt`
   * and again on each report that fails while this is set.
   */
  const adoptedPendingRef = useRef(false);
  /**
   * Play was pressed while the stored place is still on its way (#54): its
   * section has not reported, so there is no Utterance to start from yet.
   *
   * The place is waited for rather than given up. Giving it up — ADR 0019's
   * claim rule, as it stood — started the engine at the cursor, which for a place
   * taken from another device is this device's own older sentence: the owner
   * heard that, and the next Clip boundary stamped it above the newer place and
   * sent it back to the desktop. For the place the book opened with it was the
   * book's first line. Nothing is built or started meanwhile, and the player
   * shows the press as starting. The wait ends when the place lands, when its
   * section reports without it, or when the owner pauses or points the reading
   * somewhere else; the effect after `play` then starts the reading.
   *
   * Not `playIntent`: the engine's own state reports set that, and a paused
   * engine saying it is paused is not the owner taking the press back.
   */
  const awaitingPlaceRef = useRef(false);
  /**
   * The sentence to show if the resume is given up on, from the last attempt
   * that failed.
   *
   * Held rather than shown at once, because a failure is not final while the
   * document is still rendering: saying "that sentence is not in this book" of a
   * book that has rendered its cover and nothing else would be false, and would
   * be replaced a second later by the resume working. It is only true at the
   * moment the owner asks for something else.
   */
  const resumeLostRef = useRef<string | null>(null);

  const report = useCallback((problem: unknown) => {
    // A Provider the owner just refused (#109): the engine has stopped where it
    // was, which is all there is to show.
    if (isDeclined(problem)) return;
    setStatus((was) => ({ ...was, note: describe(problem) }));
  }, []);

  /**
   * Something else has decided where to read, so the stored Reading Position
   * stops competing for it.
   *
   * A tapped word, a skip, a contents row — and a press of Play once the place's
   * own section has reported without it. Without this, a position that resolved
   * late — the section it names rendering thirty seconds into a 2,077-section
   * book — would take the reading away from wherever the owner had just put it,
   * which is the "silent landing three paragraphs away" ADR 0008 exists to
   * prevent, arriving by the back door.
   *
   * Play no longer gives up a place that is still on its way: it waits for it
   * (`awaitingPlaceRef`, #54). So the sentence for a place that had not rendered
   * yet is about the reading being moved, which is what still gives one up.
   */
  const abandonResume = useCallback(() => {
    if (!resumeRef.current) return;
    resumeRef.current = null;
    adoptedPendingRef.current = false;
    const lost = resumeLostRef.current;
    setStatus((was) => ({
      ...was,
      resumeNeedsAttention: true,
      resume:
        lost ??
        'The place this book was left at had not rendered yet when the reading was moved, so it starts there instead.',
    }));
  }, []);

  /**
   * The spine item an Utterance is in, or null.
   *
   * The Block its first span came from, and that Block's `sectionIndex` — which is
   * the number the renderer already sends beside every Block, so nothing here
   * decodes a CFI or picks a spine index out of a Block id. ADR 0020 records why
   * both of those were refused.
   */
  const sectionOf = useCallback((utterance: number): number | null => {
    const span = loadedRef.current[utterance]?.spans[0];
    if (!span) return null;
    return blocksRef.current[span.block]?.sectionIndex ?? null;
  }, []);

  /**
   * The clock, and there is one.
   *
   * Stable for the engine's whole life, and it reads `bridgeRef` at call time
   * rather than closing over a bridge: the engine outlives any one render, and a
   * captured bridge would be the one from the render that built it.
   *
   * ADR 0016's lock screen is the second reader of this same clock, which is why
   * the elapsed time and the highlight cannot disagree. It is one line in
   * `onPosition` and not another clock — everything else about it is
   * `src/now-playing/` and `reading-view.tsx`, which knows the Document's title.
   */
  const clock = useMemo<ReaderClock>(
    () => ({
      onClip(cue) {
        // The page goes to a cue only while the owner is listening. A cue while
        // paused is a paused seek's Clip arriving, or a speed change re-cueing the
        // Clip it re-scales, and the owner may be browsing by then (#52). Playing,
        // the first cue after Play is revealed and every later one recovers
        // (#71): the reading moving on does not take back a page the owner took.
        const asked = playIntent.current && revealCue.current;
        if (playIntent.current) revealCue.current = false;
        bridgeRef.current?.clock.onClip(cue, !playIntent.current ? { reveal: false } : asked ? { reveal: true } : { reveal: false, recover: true });
        if (!playIntent.current) bridgeRef.current?.hold();
        atRef.current = cue.utterance;
        // Speech has moved on from the resumed sentence; the next place is new.
        if (cue.utterance !== resumedAtRef.current) resumedAtRef.current = null;
        // Once per Clip. `cue.words === null` is the Provider reporting no Word
        // Timings, which is the whole of the Highlight Level (ADR 0005): the
        // Utterance is highlighted, nothing is estimated, and the screen says
        // which of the two is on the page rather than leaving the owner to
        // wonder.
        setStatus((was) => ({
          ...was,
          utterance: cue.utterance,
          level: cue.words ? 'word' : 'utterance',
          section: sectionOf(cue.utterance),
        }));
      },
      onPosition(correction) {
        if (playIntent.current) bridgeRef.current?.clock.onPosition(correction);
        // The second reader of the one clock (ADR 0016). `contentPosition` is the
        // source node's own value, unchanged — the same number the highlight is
        // corrected against, so the lock screen's elapsed time and the highlight
        // cannot be two answers to "where are we". A wall clock here would be
        // exactly that: the reading advances at 1.4999x against a requested 1.5.
        lockScreenPosition(correction.contentPosition);
      },
    }),
    [sectionOf],
  );

  /**
   * Give the engine a longer Utterance list.
   *
   * The list grows because epub.js renders one section at a time and the renderer
   * reports every Block it has, in full, each time that changes — so the book is
   * segmented again and the result is longer than what the engine holds.
   *
   * **Handed over the moment it exists, through `extend`.** It used to be held
   * back until the next Clip boundary, because the only way to give the engine a
   * new list was `load`, which clears the queue and re-anchors the clock and so
   * would restart the sentence being spoken. The price of that deferral was the
   * defect of 2026-09-20 04:43: the boundary it waited for is a Clip *starting*,
   * and no Clip starts when the engine has run out of text — so the one moment
   * the longer list was most needed was the one moment it could never arrive.
   * `extend` takes nothing out from under the engine, which is also why calling
   * it from inside the renderer's own message handler is safe where `load` was
   * not: `drain` may be mid-await, and there is nothing here for it to lose.
   *
   * **If the prefix changed, the list was renumbered** (see `samePrefix`): a
   * section reported above the ones already reported, and every index held here,
   * in the engine and in the WebView now means another sentence. It is ordinary,
   * not rare: epub.js's continuous manager renders the section above whatever it
   * displays near the top of its scroll, so a Contents jump and a return to a
   * book both do it (#46, measured 2026-09-23). Dropping the reading there cost
   * the owner their place at exactly those two moments, and the next Play read
   * the book's first line and wrote it over the stored place.
   *
   * So every index that names a sentence of the old list — the cursor, the
   * sentence a resume landed on — is
   * carried to the same sentence in the new one (`carryUtterance`: its first
   * Block, where it starts there, and its text, which is an exact match and not
   * an estimate), and the engine is loaded again there. `load` is still the one
   * destructive call here, because the queue and the clock hold old numbers that
   * cannot be renumbered in place; but a playing reading goes on playing, from
   * the start of the same sentence, a paused one keeps its highlight on it, and
   * nothing is said, because for the owner nothing has moved. With no cursor the
   * engine is loaded at the top, which is where such a reading starts anyway.
   *
   * Only a sentence that is no longer in the document at all — its own section
   * reported different text — cannot be carried. There the reading stops and
   * says so: guessing which sentence was meant would be an estimate
   * (philosophy rule 1), and a highlight three paragraphs from the voice is what
   * this project exists to prevent.
   *
   * @param reported the Blocks `next` was segmented from.
   * @param pointed the caller has already pointed `atRef` at an index of `next` —
   * a resume that landed, a Contents row whose section has reported — so the
   * cursor is not carried a second time.
   */
  const adopt = useCallback((next: readonly Utterance[], reported: readonly ReportedBlock[], pointed = false) => {
    const engine = engineRef.current;
    const held: Segmented = { utterances: loadedRef.current, blocks: loadedBlocksRef.current };
    const incoming: Segmented = { utterances: next, blocks: reported };
    loadedRef.current = next;
    loadedBlocksRef.current = reported;

    if (samePrefix(held.utterances, next)) {
      engine?.extend(next);
      return;
    }

    const carry = (index: number | null) => (index === null ? null : carryUtterance(index, held, incoming));
    const cursor = atRef.current;
    const at = pointed ? cursor : carry(cursor);
    resumedAtRef.current = carry(resumedAtRef.current);

    // `load` cancels a voice switch the engine was preparing (`restart`), so the
    // choice is let go here as a seek lets it go, rather than left spinning.
    if (engine && pendingChoice.current) {
      switchRequest.current++;
      pendingChoice.current = null;
      setStatus((was) => ({ ...was, pendingVoice: null }));
    }

    if (cursor !== null && at === null) {
      engine?.pause();
      bridgeRef.current?.clear();
      // Quiet, as every paused reload here is: a cue of the top of the document
      // would move the page there, under a note saying the reading stopped here.
      engine?.load(next, 0, { quiet: true });
      atRef.current = null;
      resumedAtRef.current = null;
      setStatus((was) => ({
        ...was,
        playing: false,
        utterance: null,
        level: null,
        note:
          'The document rendered its sections out of reading order, so the Utterances were renumbered. ' +
          'The reading stopped here rather than carry on from a number that now means a different sentence.',
      }));
      return;
    }

    atRef.current = at;
    // Playing, the reload's first Clip is the reading's own cue, and the page
    // follows the voice as it always does. Paused, the reload is quiet and nothing
    // is shown: a renumbering while paused is what scrolling up does — epub.js
    // renders a section above that has not reported — and a `show`, or the
    // reload's first cue, would centre the page on the reading while the owner
    // scrolls away from it. The bridge keeps the old number until Play, and
    // nothing reads it before then: its `cued` is matched only by position
    // corrections, which arrive only while the node renders
    // (react-native-audio-api 0.13.5 advances its position dispatcher only while
    // `isPlaying()`), and `play()` cues the front before it corrects.
    engine?.load(next, at ?? 0, { quiet: !playIntent.current });
    if (at === null) return;
    setStatus((was) => ({ ...was, utterance: at, section: sectionOf(at) }));
  }, [sectionOf]);

  /**
   * One spine item on, or the end of the document.
   *
   * Only ever called for a Play that is looking for text (see `play`). Moving the
   * page is something the owner asks for: a document is opened on its cover
   * because that is where it begins, and being taken off it unasked is not a
   * feature.
   */
  const walkForward = useCallback((from: RenderedSection) => {
    const next = from.index + 1;
    if (next < from.spine) {
      bridgeRef.current?.goToSection(next);
      return;
    }
    seekingRef.current = false;
    playIntent.current = false;
    setStatus((was) => ({
      ...was,
      playing: false,
      buffering: false,
      seeking: false,
      note:
        'Play reached the last section of this document without finding one with text in it. ' +
        'There is nothing here that can be read aloud.',
    }));
  }, []);

  /**
   * Read from an Utterance: the one call every control in the player ends in
   * (ADR 0020).
   *
   * Two things happen, both at once (#86). The **highlight moves**, through
   * `bridge.show`, which paints the Utterance whole and scrolls the page to it
   * without knowing anything about a Clip. And the **engine seeks**, which stops
   * the sentence being spoken (`restart` stops the source node and retires its
   * callbacks, so the old queue cannot cue the highlight back) and asks for the new
   * one.
   *
   * There is deliberately no debounce. It used to wait 600 ms, Zotero's
   * `SKIP_DEBOUNCE_DELAY`, so that a burst of presses was one synthesis request;
   * the old sentence played on through the wait, and Zotero itself stops the sound
   * before its wait (notes/NOTES_2026-09-29.md, 19:04). The owner chose no wait at
   * all over gathering a burst: five quick presses are five seeks, and the
   * Utterances skipped past are fetched and cached for nothing (ADR 0020).
   *
   * `atRef` is moved at once as well, and that is not bookkeeping: it is where the
   * engine is told to start when it is built (`build`) and where `adopt` re-anchors
   * a longer list, so tapping a word before ever pressing Play and then pressing it
   * reads from the word rather than from the top of the document.
   *
   * Nothing here resumes or pauses. `engine.seek` is `restart(); pump()` with no
   * `resume()` in it, so a paused reading stays paused with its highlight moved,
   * which is what Zotero does and what ADR 0020 requires.
   */
  const seekTo = useCallback((utterance: number) => {
    const list = loadedRef.current;
    // Nothing loaded is not a position to clamp into: `navigation.ts` throws on it
    // rather than fabricate one, and there is nothing here to seek either.
    if (list.length === 0) return;
    switchRequest.current++;
    pendingChoice.current = null;
    engineRef.current?.cancelVoiceSwitch();
    setStatus((was) => ({ ...was, pendingVoice: null, voiceError: null }));
    // A word tapped, a skip, a contents row: the owner has pointed somewhere, so
    // the bookmark is done asking. The resume's own call clears the ref first, so
    // this is a no-op on that path.
    abandonResume();
    const at = Math.min(list.length - 1, Math.max(0, Math.trunc(utterance)));
    atRef.current = at;
    // Pointed somewhere, so wherever the cursor is next is a place to write —
    // the resume's own seek sets this again right after, which is the exception.
    resumedAtRef.current = null;
    bridgeRef.current?.show(at);
    // The Utterance, but not the Highlight Level: whether the Clip that is about to
    // be fetched carries Word Timings is not known yet, and the last Clip's answer
    // is the honest thing to keep showing until it is.
    setStatus((was) => ({ ...was, utterance: at, section: sectionOf(at) }));
    // No engine is not a failure to report: the owner has pointed at a sentence
    // without having pressed Play, `atRef` holds it, and the engine that gets
    // built will be loaded there.
    engineRef.current?.seek(at);
  }, [sectionOf, abandonResume]);

  /**
   * A tapped word or a skip: the owner pointing the reading at a sentence.
   *
   * `seekTo`, and the sentence is the Reading Position from now on, spoken or not
   * (CONTEXT.md, #52): it is written, and a Contents row after it only browses. A
   * Contents row's own seek, in a book with no place yet, and a stored place
   * landing go through `seekTo` alone.
   */
  const pointAt = useCallback(
    (utterance: number) => {
      debugLog('reading', `seek to utterance ${utterance}`);
      unreadRef.current = false;
      // A Contents row still waiting for its chapter is given up: the owner has
      // pointed somewhere since, and the chapter reporting later must not take the
      // reading away from it.
      pendingSectionRef.current = null;
      seekTo(utterance);
    },
    [seekTo],
  );

  /**
   * One of the four skips.
   *
   * The arithmetic is `playback/navigation.ts`'s and none of it is repeated here —
   * including the one divergence from Zotero, that previous-paragraph restarts the
   * paragraph you are in before stepping back to the one before it.
   *
   * It counts from `atRef`, which the previous press has already moved, so five
   * presses of previous-sentence go back five sentences. Nothing moves it back in
   * between: the seek retired the old queue's callbacks, and the next cue is the
   * new sentence's own.
   */
  const skip = useCallback(
    (target: SkipTarget) => {
      const list = loadedRef.current;
      if (list.length === 0) return;
      const from = atRef.current ?? 0;
      debugLog('reading', `skip ${target} from utterance ${from}`);
      if (target === 'previous-sentence') pointAt(previousSentence(list, from));
      else if (target === 'next-sentence') pointAt(nextSentence(list, from));
      else if (target === 'previous-paragraph') pointAt(previousParagraph(list, from));
      else pointAt(nextParagraph(list, from));
    },
    [pointAt],
  );

  /**
   * Take the reading where a Contents row points, as far as the sections reported
   * so far can say (`readingFromRow`), and remember the section still to wait for.
   *
   * `onward` is a row pressed while playing (#86). The voice stops at the tap
   * rather than read on in the chapter being left: the engine is silenced while
   * the section is waited for, and the player shows the wait. A page with no text,
   * which is a volume's title page, is read past to the first section after it
   * that has some, as the owner chose; the section waited for is then asked for,
   * because nothing else displays a section no sentence has reached. When nothing
   * after the row has text, the reading stops where it was, since nothing has
   * moved it, and says why.
   */
  const followRow = useCallback((section: number, onward: boolean) => {
    const target = readingFromRow(
      loadedRef.current,
      blocksRef.current,
      { spine: renderedRef.current?.spine ?? 0, reported: reportedSectionsRef.current },
      section,
      onward,
    );
    debugLog('reading', `contents row ${section}${onward ? ' while playing' : ''}: ${target.kind === 'utterance' ? `utterance ${target.utterance}` : target.kind === 'wait' ? `wait for section ${target.section}` : target.kind}`);
    if (target.kind === 'utterance') {
      pendingSectionRef.current = null;
      seekTo(target.utterance);
      return;
    }
    if (target.kind === 'wait') {
      pendingSectionRef.current = { section: target.section, onward };
      if (target.section !== section) bridgeRef.current?.goToSection(target.section);
      if (onward) engineRef.current?.silence();
      return;
    }
    pendingSectionRef.current = null;
    if (target.kind === 'nothing') return;
    playIntent.current = false;
    const engine = engineRef.current;
    engine?.pause();
    // Ends the silence, paused: Play reads on from the sentence the reading is on.
    if (atRef.current !== null) engine?.seek(atRef.current);
    bridgeRef.current?.hold({ stop: true });
    setStatus((was) => ({
      ...was,
      playing: false,
      buffering: false,
      note: 'Nothing after this point of the document can be read aloud.',
    }));
  }, [seekTo]);

  /**
   * A contents row: **Browsing** wherever the reading is on a sentence it keeps
   * (#52, #107), and otherwise **two steps** (ADR 0020).
   *
   * The page moves first and always, because that is what a contents tap most
   * obviously means and it works for a row whose spine item has no text on it at
   * all — a volume's title page, which the owner's book has thirteen of.
   *
   * The reading follows if it can. When the section has already rendered, its
   * Utterances are in hand and the seek happens now. When it has not, there is no
   * index to seek to yet — the section contributes no Utterance until it reports its
   * Blocks — so the target is remembered and `handleBlocks` finishes the job. That
   * second case is the common one and is why this is two steps rather than one.
   * Playing with no sentence yet, the voice stops at the tap and a row with no
   * text reads on past it (`followRow`, #86).
   */
  const goToSection = useCallback(
    (section: number) => {
      /**
       * Browsing (#52, #107): with the reading on a sentence that is its Reading
       * Position, the row moves the page and nothing else, playing or paused. No
       * seek, so the highlight stays, a playing voice goes on with its sentence,
       * and nothing is synthesized for a chapter the owner only looked at; no
       * status, so the marked Contents row is still the reading's; no stored place
       * given up; and nothing written. Measured on the owner's book on 2026-09-23
       * at 23:19 before #52: a row to section 14 moved a reading paused on
       * Utterance 176 to 423, that chapter's heading, and wrote the heading over
       * the stored place.
       *
       * Playing, the page stays on the chapter as it does after a finger drag
       * (#71): each later cue recovers, and gives the page back only at a sentence
       * that begins on the visible page. Play reveals through its first cue, so a
       * row pressed before that cue arrives takes the reveal back, or the cue would
       * take the page straight back from the chapter the owner chose.
       *
       * Not in a book with no place yet, where the row chooses where to start —
       * the cursor is not a Reading Position until Play, and while playing there is
       * no sentence until the first cue, or while Play walks past a cover. And not
       * while a stored place is still waiting for its section, with no highlighted
       * sentence to keep: there the row gives the place up, as it did before (#51).
       */
      if (atRef.current !== null && !unreadRef.current) {
        // A row pressed while playing may still be waiting, with the engine
        // silenced for it; that wait is given up, and the engine goes back to the
        // sentence the reading is on.
        const waited = pendingSectionRef.current;
        pendingSectionRef.current = null;
        if (waited?.onward) engineRef.current?.seek(atRef.current);
        revealCue.current = false;
        bridgeRef.current?.browse(section);
        return;
      }
      bridgeRef.current?.goToSection(section);
      followRow(section, playIntent.current);
    },
    [followRow],
  );

  /**
   * One attempt at the stored place against the Blocks reported so far.
   *
   * Landed: the place is done asking, the cursor moves, `before` runs (the
   * engine takes the new list, when there is one), the seek moves the highlight
   * and the page, and the screen learns how sure the landing was. Not landed:
   * the sentence that would explain it is kept for `abandonResume`, and the
   * place stays pending for the next report. Still waiting for its own section:
   * pending as well, with no sentence kept — `abandonResume`'s own, that the place
   * had not rendered yet, is then the true one (#51).
   */
  const tryResume = useCallback(
    (next: readonly Utterance[], reported: readonly ReportedBlock[], before?: () => void): boolean => {
      const stored = resumeRef.current;
      if (!stored) return false;
      const rendered = { spine: renderedRef.current?.spine ?? 0, reported: reportedSectionsRef.current };
      const found = resolveResume(stored, next, reported, rendered);
      if (found.outcome === 'waiting') {
        resumeLostRef.current = null;
        return false;
      }
      if (found.outcome !== 'resumed') {
        resumeLostRef.current = resumeSentence(found);
        return false;
      }
      resumeRef.current = null;
      resumeLostRef.current = null;
      adoptedPendingRef.current = false;
      const sentence = resumeSentence(found);
      atRef.current = found.utterance;
      before?.();
      seekTo(found.utterance);
      resumedAtRef.current = found.utterance;
      setStatus((was) => ({ ...was, resume: sentence, resumeNeedsAttention: found.moved !== null || found.agreement === 'aligned' }));
      return true;
    },
    [seekTo],
  );

  /**
   * Ask the renderer to display the section a pending place names, when that
   * section has reported no Block yet — the one thing `<Reader initialLocation>`
   * does for the place a book opens with and nothing did for an adopted one.
   *
   * The spine index is read off the locator (`/6/N` → N/2 − 1, the rule both
   * readers share, spec 6.4) only to know whether the section has reported —
   * the same question `resolveResume` asks before it looks anywhere else;
   * what is handed to the renderer is the whole CFI, through the same `goTo`
   * a contents row goes through. A section that has reported and does not
   * hold the anchor is not a case a display can fix, and is left pending as
   * before. Returns whether a display was asked for.
   *
   * **Not for the place the book opened with**, whose section `<Reader
   * initialLocation>` has already asked for. A second display of it is not free:
   * while the first is loading it clears the half-built view and starts again
   * (epub.js's `Views.find` sees only displayed views), and once the section is
   * there it scrolls the Block back to the top, under the resume's own centring.
   */
  const revealPendingPlace = useCallback((place: ReadingPlace): boolean => {
    const cfi = readLocator(place.locator, 'epub');
    if (!cfi) return false;
    const section = spineIndexOf(cfi);
    if (section !== null && reportedSectionsRef.current.has(section)) return false;
    bridgeRef.current?.goTo(cfi);
    return true;
  }, []);

  /**
   * A Play waiting for a place (#54), after something that did not land it.
   *
   * Once the place's own section has reported, the place is not on its way any
   * more, and waiting on would be waiting for ever: it is given up with the
   * sentence the last attempt kept, which says why, and the reading starts from
   * this device's own place — design 0031's rule for a place the phone cannot
   * find — through the effect after `play`.
   */
  const stopWaitingIfArrived = useCallback(() => {
    const pending = resumeRef.current;
    if (!awaitingPlaceRef.current || !pending) return;
    if (awaitedSection(pending, { spine: renderedRef.current?.spine ?? 0, reported: reportedSectionsRef.current }) !== null) return;
    abandonResume();
  }, [abandonResume]);

  const resumeAt = useCallback(
    (place: ReadingPlace): boolean => {
      if (playIntent.current) return false;
      // Already held: one arrival is passed twice — Play passes on what its own
      // sync adopted, and the adopted-place effect passes the same arrival on the
      // next render (#54). Its section has been asked for already, or is being
      // displayed for the place the book opened with (#55), and a second display
      // of a section still loading starts it over.
      const held = resumeRef.current;
      if (held && samePlace(held, place, 'epub')) return true;
      resumeRef.current = place;
      resumeLostRef.current = null;
      adoptedPendingRef.current = true;
      // A place the owner reached on another device is a Reading Position here too.
      unreadRef.current = false;
      setStatus((was) => ({ ...was, resume: null, resumeNeedsAttention: false }));
      if (loadedRef.current.length > 0 && tryResume(loadedRef.current, blocksRef.current)) return true;
      // Pending, the way the place a book opens with is — and, unlike that one,
      // with its section asked for, since nothing else will ask.
      revealPendingPlace(place);
      // Arriving while Play waits, in a section that has already reported without it.
      stopWaitingIfArrived();
      return true;
    },
    [tryResume, revealPendingPlace, stopWaitingIfArrived],
  );

  /** The Blocks of every section rendered so far, as Utterances — for the renderer, which draws them, and for the engine, which speaks them. */
  const handleBlocks = useCallback(
    (reported: readonly ReportedBlock[], section: RenderedSection) => {
      const next = segmentDocument(reported, languageRef.current);
      // Both, and the very array `onBlocks` gave us: `UtteranceSpan.block` is an
      // index into it, and passing a copy is how the two get out of step.
      bridgeRef.current?.setUtterances(next, reported);
      blocksRef.current = reported;
      renderedRef.current = section;
      reportedSectionsRef.current.add(section.index);
      furthestSectionRef.current = Math.max(furthestSectionRef.current, section.index);
      setStatus((was) => ({ ...was, known: next.length, rendered: section }));

      /**
       * A section that rendered and holds nothing to read. A cover page is a
       * `<svg><image/></svg>` and no text at all, which is how most EPUBs begin,
       * so this is ordinary rather than a failure — there is nothing to segment
       * and nothing to hand the engine. The screen says which of the two "no
       * Utterances" states this is (`ReadingStatus.rendered`), and the page moves
       * on only if Play asked it to.
       */
      if (next.length === 0) {
        if (seekingRef.current) walkForward(section);
        const waited = pendingSectionRef.current;
        if (waited?.section === section.index) {
          if (waited.onward) followRow(section.index, true);
          else pendingSectionRef.current = null;
        }
        // Play is waiting for a place, and this may be its section, holding nothing
        // to read: the attempt keeps the sentence that says so, and the wait ends.
        if (awaitingPlaceRef.current && resumeRef.current) {
          tryResume(next, reported);
          stopWaitingIfArrived();
        }
        return;
      }

      /**
       * **Coming back to a book.** The stored Reading Position is a CFI and a
       * quotation (ADR 0008); the Utterance it names cannot exist until the
       * Blocks it quotes have been reported, which is now.
       *
       * Tried on every report until it lands, because the first sections to
       * report are the start of the book, and the section `initialLocation`
       * asked for arrives when epub.js has displayed it. Until then the place
       * waits for it rather than looking for its words in what came first — a
       * contents page lists the heading a chapter starts with (#51). A report
       * that fails leaves the position pending and keeps its sentence for
       * `abandonResume`.
       *
       * The same order as the contents tap below and for the same reason: the
       * Utterance being seeked to exists only in the new list, so the engine has
       * to be holding it before anything asks to be taken there.
       */
      if (resumeRef.current && tryResume(next, reported, () => adopt(next, reported, true))) return;
      // An adopted place still pending after this report: the section it names
      // may be one nobody has asked for yet, or the ask went out before the page
      // could hear it. Asked once per report, never for a section that reported.
      if (resumeRef.current && adoptedPendingRef.current) revealPendingPlace(resumeRef.current);
      // Play is waiting for the place, and its section may just have reported without it.
      stopWaitingIfArrived();

      /**
       * The second step of a contents tap: the section the owner asked for has
       * rendered, so the reading can follow the page to it.
       */
      const wanted = pendingSectionRef.current;
      if (wanted?.section === section.index) {
        const first = firstUtteranceOfSection(next, reported, wanted.section);
        if (first !== null) {
          pendingSectionRef.current = null;
          atRef.current = first;
          adopt(next, reported, true);
          seekTo(first);
          return;
        }
        // Reported with no text. Pressed while playing, the reading goes on past it
        // (#86); otherwise the row is finished with, as the page has moved there.
        adopt(next, reported);
        if (wanted.onward) followRow(wanted.section, true);
        else pendingSectionRef.current = null;
        return;
      }

      adopt(next, reported);
    },
    [adopt, walkForward, tryResume, seekTo, followRow, revealPendingPlace, stopWaitingIfArrived],
  );

  const handleProblem = useCallback((problem: ProblemMessage) => {
    setStatus((was) => ({ ...was, note: `The highlight could not be drawn: ${problem.detail}` }));
  }, []);

  /** A or M (#71). Rare — a drag, a Contents row, M — so it can be state. */
  const handleFollowing = useCallback((following: boolean) => {
    setStatus((was) => (was.following === following ? was : { ...was, following }));
  }, []);

  /**
   * M (#71, #53): the page back to the reading, and nothing else. `atRef` is the
   * sentence the reading is on — moved at once by a skip or a tap, so a return
   * straight after one goes where the highlight already is.
   */
  const returnToReading = useCallback(() => {
    bridgeRef.current?.returnToReading(atRef.current);
  }, []);

  /**
   * The shape of the document, once. The hrefs are what the contents list is built
   * from and without them every row of it is unreachable (ADR 0020).
   */
  const handleDocument = useCallback((document: ReportedDocument) => {
    setStatus((was) => ({ ...was, spineHrefs: document.hrefs }));
  }, []);

  /**
   * The Document's own body text size from an earlier open, which the owner's
   * Font Size is measured against (ADR 0030). Read once, at mount, because the
   * bridge bakes it into the program; null makes the program measure it, and
   * `handleBodyTextSize` keeps the answer for next time.
   */
  const [bodyTextSize] = useState(() => {
    const id = asDocumentId(document);
    return id ? readBodyTextSize(id) : null;
  });
  const handleBodyTextSize = useCallback((px: number) => {
    const id = asDocumentId(document);
    if (id) writeBodyTextSize(id, px);
  }, [document]);

  const bridge = useReaderBridge({
    // Fixed at mount, because the program is installed once: the owner's current
    // choice is what a book opens laid out in, and every change after that is a
    // message (`setAppearance`).
    appearance: settings.appearance,
    bodyTextSize,
    onBodyTextSize: handleBodyTextSize,
    // Fixed at mount for the same reason, and it buys the same thing: a book
    // opened under a dark theme is dark on the frame it appears rather than
    // flashing white until the first message lands.
    scheme,
    onBlocks: handleBlocks,
    onDocument: handleDocument,
    // A tap on a word is a seek and nothing else. The bridge has already turned the
    // tapped place into an Utterance (`cursor.ts`'s `utteranceAt`) and calls this
    // only when there was one, so a tap on blank space arrives as no call at all.
    onTap: pointAt,
    onProblem: handleProblem,
    // A or M (#71): the renderer's answer, only when it changes.
    onFollowing: handleFollowing,
  });

  useEffect(() => {
    bridgeRef.current = bridge;
  }, [bridge]);

  /**
   * The engine has spoken every Utterance it holds and its queue is empty.
   *
   * It is the silent state of footgun 3 made audible: the node goes on rendering
   * silence in the playing state, and before this the owner was shown nothing at
   * all for as long as it lasted — six minutes, on the reading that found it
   * (notes/NOTES_2026-09-20.md, 04:43).
   *
   * **Three states, and they are not the same thing to say.** At the last spine
   * item the book is simply finished, and the reading stops: nothing more is
   * coming, and a Play that sat silent would be the same defect wearing the
   * honest sentence. Anywhere else the document has more in it than the reading
   * was given, which after `renderAhead` should not happen — so this is the guard
   * rather than the mechanism, and it says so without stopping, because the
   * engine resumes by itself the moment a section reports (footgun 3, and
   * `extend`). And an exhaustion with Utterances the Provider refused is neither:
   * `outOfTextSentence` says the reading stopped because synthesis failed, and
   * names the refusal, because none of the four conditions could see a Clip that
   * was skipped (ADR 0023, and notes/NOTES_2026-09-20.md, 07:48). Since ADR 0027 a
   * refused Clip stops the reading instead of being skipped, so that third state is
   * kept as a guard.
   */
  const ranOutOfText = useCallback((report: OutOfTextReport) => {
    const { ended, sentence } = outOfTextSentence(furthestSectionRef.current, renderedRef.current?.spine ?? 0, {
      count: report.unspoken,
      // The engine hands the problem over unconverted, so that the one place a
      // problem becomes a sentence is the one place it is done anywhere here.
      reason: report.refusal === null ? null : describe(report.refusal),
    });
    if (ended) {
      playIntent.current = false;
      switchRequest.current++;
      pendingChoice.current = null;
      engineRef.current?.cancelVoiceSwitch();
      engineRef.current?.pause();
      bridgeRef.current?.hold({ stop: true });
    }
    setStatus((was) => ({ ...was, playing: ended ? false : was.playing,
      buffering: ended ? false : was.buffering, pendingVoice: ended ? null : was.pendingVoice, note: sentence }));
  }, []);

  /**
   * Build the Provider and the engine, reading the key at the moment it is
   * needed.
   *
   * Returns null having said why. `readiness` covers everything the owner can
   * see; the Keychain refusing is the one thing it cannot, and that is reported
   * as a refusal rather than flattened into "no key" (`src/keys/refusal.ts`
   * exists for exactly that distinction).
   */
  const engineGeneration = useRef(0);
  const build = useCallback(async (): Promise<PlaybackEngine | null> => {
    const generation = engineGeneration.current;
    // Register buildingRef before engine.load can publish its initial paused
    // state. Offline construction no longer awaits a credential lookup.
    await Promise.resolve();
    const ready = readiness(settings, hasKey);
    if (!ready.ready && inventoryReady(document) && !hasSavedVoice(document, settings.provider, settings.voice)) {
      setStatus((was) => ({ ...was, note: readinessNote(settings.provider, ready) }));
      return null;
    }

    if (generation !== engineGeneration.current) return null;
    const provider = offlineProvider(document, settings);
    const engine = createPlaybackEngine({
      provider,
      // Initial voice; successful live handovers retain this engine (ADR 0026).
      voice: settings.voice,
      clock,
      onError: report,
      onState: (state) => {
        if (generation !== engineGeneration.current) return;
        if (!buildingRef.current) playIntent.current = state.playing;
        // Building for a press of Play, or waiting for its place (#54): a paused
        // engine saying it is paused — after a quiet reload — is not the press undone.
        setStatus((was) => ({ ...was, ...((awaitingPlaceRef.current || (buildingRef.current && playIntent.current)) && !state.playing
          ? { playing: true, buffering: true } : state) }));
      },
      onOutOfText: ranOutOfText,
      sectionOf,
      rate: settings.rate,
      // Read once, here: the pauses change only in General, where no reader is
      // mounted, so every engine is built after the owner's latest choice (#60).
      gap: settings.pauses,
      brackets: { strip: settings.stripBrackets, pairs: settings.bracketPairs },
    });
    engineRef.current = engine;
    // Where the reading has been pointed, not the top of the document: a word tapped
    // or a chapter chosen before Play was ever pressed has already moved `atRef`, and
    // loading at 0 would silently read the book from its beginning instead (ADR 0020).
    // `?? 0` is reachable only for a cursor that has never existed — a document opened
    // with no stored place and not yet pointed anywhere, where the top *is* where the
    // reading starts. It survives an engine rebuild (ADR 0025), so it is no longer the
    // fallback a Voice change fell through.
    engine.load(loadedRef.current, atRef.current ?? 0);
    setStatus((was) => ({ ...was, reportsWordTimings: provider.capabilities.wordTimestamps, note: null }));
    return engine;
  }, [settings, hasKey, clock, report, ranOutOfText, document, sectionOf]);

  const play = useCallback(() => {
    debugLog('reading', `play at utterance ${atRef.current ?? 'none'}, ${settings.provider} ${settings.voice}`);
    // A press of Play is the owner asking again: a Provider refused earlier is
    // asked about again rather than refused in silence (#109).
    consent.again();
    bridgeRef.current?.resumeFollowing();
    if (!settings.enabledProviders.includes(settings.provider) && inventoryReady(document) && !hasSavedVoice(document, settings.provider, settings.voice)) {
      playIntent.current = false;
      engineRef.current?.pause();
      // What `readiness` says, not `enabling` alone: with nothing enabled that
      // would name a Provider the owner never chose (#103).
      const note = readinessNote(settings.provider, readiness(settings, hasKey));
      setStatus((was) => ({ ...was, playing: false, note }));
      return;
    }
    /**
     * A place still on its way is waited for (#54). Its section has not reported,
     * so it names no Utterance yet, and the cursor names an older one: this
     * device's own sentence under a place taken from another device, nothing at
     * all under the place the book opened with. Starting there read that aloud
     * and then wrote it over the newer place, on every device. So nothing starts
     * yet: the player shows the press as starting, and an effect below starts the
     * reading when the wait ends. Asked before the cover-page walk, which would
     * take the page away from the section being displayed for the place.
     */
    const pending = resumeRef.current;
    if (pending && awaitedSection(pending, { spine: renderedRef.current?.spine ?? 0, reported: reportedSectionsRef.current }) !== null) {
      awaitingPlaceRef.current = true;
      setStatus((was) => ({ ...was, playing: true, buffering: true, note: null }));
      return;
    }
    // Play is the owner saying "read from here", and here is wherever the reading
    // is now. A bookmark whose own section has reported without it has lost its claim.
    abandonResume();
    // And here is the Reading Position from now on, a Contents row's choice in a
    // book with no place yet included (#52).
    unreadRef.current = false;
    playIntent.current = true;
    revealCue.current = true;
    setStatus((was) => ({ ...was, playing: true, buffering: true, note: null }));
    /**
     * Play, pressed with nothing to read.
     *
     * A cover page carries no Utterance, so there is nothing to build an engine
     * for and nothing to speak — and a Play that does nothing at all is the dead
     * end this exists to remove. What the owner meant by pressing it is "read
     * this book", so the document is walked forward, a spine item at a time, to
     * the first section that has text, and the reading starts there (the effect
     * below). Nothing moves the page before this press: the cover may be exactly
     * what the owner wanted to look at.
     */
    if (loadedRef.current.length === 0) {
      seekingRef.current = true;
      setStatus((was) => ({ ...was, seeking: true, note: null }));
      const rendered = renderedRef.current;
      // Nothing has rendered yet, so there is nothing to move on from. The first
      // section to report finds the flag set and carries on from there.
      if (rendered) walkForward(rendered);
      return;
    }

    // No seek here: every one has already reached the engine at its press (#86),
    // so the queue it paused on is the sentence the highlight is on — a place just
    // landed from another device included (#54).
    if (engineRef.current) {
      engineRef.current.play();
      setStatus((was) => ({ ...was, playing: true, buffering: engineRef.current!.snapshot().queued === 0, note: null }));
      return;
    }
    if (!buildingRef.current) {
      const job = build();
      buildingRef.current = job;
      const settled = () => { if (buildingRef.current === job) buildingRef.current = null; };
      void job.then(settled, settled);
    }
    const generation = engineGeneration.current;
    void buildingRef.current.then((engine) => {
      if (generation !== engineGeneration.current) return;
      if (!engine) {
        playIntent.current = false;
        setStatus((was) => ({ ...was, playing: false, buffering: false }));
        return;
      }
      if (engine !== engineRef.current || !playIntent.current) return;
      engine.play();
    }, (error: unknown) => {
      if (generation !== engineGeneration.current) return;
      playIntent.current = false;
      setStatus((was) => ({ ...was, playing: false, buffering: false }));
      report(error);
    });
  }, [settings, build, report, walkForward, abandonResume, document, hasKey]);

  /**
   * The section Play was looking for has arrived with text in it, so the reading
   * starts there.
   *
   * From an effect for the same reason as the Clip-boundary one above: the
   * Utterances arrive inside the renderer's own message handler, and building a
   * Provider and an audio session is not work to do from inside it.
   */
  useEffect(() => {
    if (!seekingRef.current || loadedRef.current.length === 0) return;
    seekingRef.current = false;
    setStatus((was) => ({ ...was, seeking: false }));
    play();
  }, [status.known, play]);

  /**
   * The place Play was waiting for has landed, or its section reported without
   * it, or the owner pointed the reading somewhere else (#54): the reading starts
   * from wherever the cursor now is.
   *
   * From an effect for the reason the one above gives: a place lands inside the
   * renderer's own message handler. On every change of status, because each way
   * the wait ends changes it — a landing, a place given up, a tapped word — and
   * the check is two refs.
   */
  useEffect(() => {
    if (!awaitingPlaceRef.current || resumeRef.current) return;
    awaitingPlaceRef.current = false;
    play();
  }, [status, play]);

  const pause = useCallback(() => {
    debugLog('reading', `pause at utterance ${atRef.current ?? 'none'}`);
    playIntent.current = false;
    revealCue.current = false;
    seekingRef.current = false;
    // A wait for a place ends here and the place stays pending, so it lands on
    // the paused book when its section reports, as any place taken while paused does.
    awaitingPlaceRef.current = false;
    engineRef.current?.pause();
    // Not a third clock message: a pause stops the position stream, and a WebView
    // still interpolating against `requestAnimationFrame` would run the highlight
    // ahead of silence (`reader-bridge.ts`). And the page stops with the voice (#71).
    bridgeRef.current?.hold({ stop: true });
    setStatus((was) => ({ ...was, playing: false, buffering: false, seeking: false }));
  }, []);

  const chooseVoice = useCallback((provider: ProviderId, voice: string, selected: () => void) => {
    if (playIntent.current && pendingChoice.current?.provider === provider && pendingChoice.current.voice === voice) return;
    // Choosing a Voice is asking for it: a Provider refused earlier is asked about again (#109).
    consent.again();
    const request = ++switchRequest.current;
    pendingChoice.current = null;
    let engine = engineRef.current;
    engine?.cancelVoiceSwitch();
    setStatus((was) => ({ ...was, pendingVoice: null, voiceError: null }));
    if (!settings.enabledProviders.includes(provider)) return;
    if (provider === settings.provider && voice === settings.voice) return;
    if (!playIntent.current) {
      // A paused selection is a preference, not a request to start synthesizing.
      selected();
      return;
    }
    const next = { ...settings, provider, voice };
    pendingChoice.current = { provider, voice };
    setStatus((was) => ({ ...was, pendingVoice: { provider, voice } }));
    const failed = (error: unknown) => {
      if (request !== switchRequest.current) return;
      pendingChoice.current = null;
      // Refused (#109): the reading goes on in the old Voice, and there is nothing to explain.
      setStatus((was) => ({ ...was, pendingVoice: null, voiceError: isDeclined(error) ? null : describe(error) }));
    };
    void (async () => {
      engine ??= await buildingRef.current;
      if (request !== switchRequest.current) return;
      if (!engine) {
        pendingChoice.current = null;
        setStatus((was) => ({ ...was, pendingVoice: null }));
        selected();
        return;
      }
      if (request !== switchRequest.current || engine !== engineRef.current) return;
      const target = offlineProvider(document, next);
      engine.switchVoice(target, voice, () => {
        if (request !== switchRequest.current || engine !== engineRef.current) return;
        pendingChoice.current = null;
        retainedIdentity.current = engineIdentity(next);
        setStatus((was) => ({ ...was, pendingVoice: null, voiceError: null,
          reportsWordTimings: target.capabilities.wordTimestamps }));
        selected();
      }, failed);
    })().catch(failed);
  }, [settings, document]);

  const opened = useCallback((declared: string | null | undefined) => {
    const language = documentLanguage(declared);
    languageRef.current = language.language;
    setStatus((was) => ({ ...was, language }));
  }, []);

  /**
   * The speed, live. This is the whole of the 1.5–3×: one parameter on the source
   * node, applied at playback and never asked of a Provider (ADR 0009). The
   * engine re-sends the Word Timing array scaled by the new rate, which is the
   * step ADR 0005 calls the single easiest way to reintroduce drift.
   */
  useEffect(() => {
    engineRef.current?.setRate(settings.rate);
  }, [settings.rate]);

  /**
   * How the text is set, live (ADR 0019).
   *
   * Beside the rate and shaped like it, and they are the two settings that reach
   * the open document without rebuilding anything. The difference is where they
   * land: the rate is a parameter of the audio graph, this is a stylesheet in the
   * WebView. Neither is in `engineIdentity`, so neither costs a Clip.
   *
   * It fires on mount as well, into a WebView whose program is very likely not
   * installed yet. That message is lost and nothing is wrong: the same value is
   * baked into the program's own source, and `reader-bridge.ts` re-sends only an
   * Appearance that has since been changed.
   */
  useEffect(() => {
    bridgeRef.current?.setAppearance(settings.appearance);
  }, [settings.appearance]);

  /**
   * The theme, live (ADR 0022). The third of the settings that reach an open
   * document without rebuilding anything, beside the rate and the Appearance.
   *
   * Shaped like the Appearance effect and different in one way that the WebView
   * half acts on: a colour change moves not one character, so nothing is
   * re-centred afterwards. It fires on mount as well, into a program that is very
   * likely not installed yet; that message is lost and nothing is wrong, because
   * the same value was baked into the program's own source above and
   * `reader-bridge.ts` re-sends only a theme that has since been changed.
   */
  useEffect(() => {
    bridgeRef.current?.setTheme(scheme);
  }, [scheme]);

  /**
   * The Line Position, live (#71, ADR 0050): the fourth setting that reaches an
   * open document without rebuilding anything. A page following the reading is
   * brought to the new position when it arrives. It fires on mount as well, into
   * a program that is very likely not installed yet, and `reader-bridge.ts`
   * re-sends it at install when it is not the middle the program is built with.
   */
  useEffect(() => {
    bridgeRef.current?.setLinePosition(settings.following.linePosition);
  }, [settings.following.linePosition]);

  /** And how the page moves to it, the same way (#71): re-sent at install when it is not By line. */
  useEffect(() => {
    bridgeRef.current?.setScrolling(settings.following.scrolling);
  }, [settings.following.scrolling]);

  /**
   * A different Provider, Voice or address is a different engine — and so is the
   * same one with a credential that has since been written.
   *
   * The credential is not in `engineIdentity`, and cannot be: it is not in
   * `AppSettings`, because it is in the Keychain (ADR 0002, ADR 0019). So the
   * count of writes stands in for it. It is coarser than comparing the values —
   * a save that changes nothing still rebuilds — and that is the right way
   * round, because the cost is one rebuild of an engine whose Clips are already
   * in the memory cache, and the alternative is a 403 the owner has just fixed
   * and cannot clear.
   *
   * The work is all in the cleanup, which is the point: it runs when the identity
   * changes and when the Reading ends (#68: not when the Reader goes while it
   * plays, since the view is then held behind the navigator), and it is the only
   * place the audio session is given back.
   *
   * **`atRef` is not the engine's, so it is not cleared here** (ADR 0025). The
   * cursor is where the *reading* is pointed, and an engine rebuild changes who
   * is speaking rather than where. Clearing it left `play()` looking at a loaded
   * list with no cursor, which means "this document has never been pointed
   * anywhere" and reads from the top — so changing the Voice at chapter 100 of a
   * 2,000-chapter novel started it again at chapter one and dragged the page back
   * with it (notes/NOTES_2026-09-20.md, 07:45). The same cleanup runs for a
   * Provider change and for saving a credential, so it did that to an owner who
   * pasted a key while reading. docs/design/0020 keeps "anything that rewrites
   * your place without you asking" out of the player; this was it, arriving from
   * underneath.
   */
  const identity = `${engineIdentity(settings)}@${writtenAt}`;
  const disposeEngine = useCallback(() => {
      engineGeneration.current += 1;
      switchRequest.current += 1;
      pendingChoice.current = null;
      playIntent.current = false;
      const engine = engineRef.current;
      engineRef.current = null;
      buildingRef.current = null;
      seekingRef.current = false;
      awaitingPlaceRef.current = false;
      pendingSectionRef.current = null;
      void engine?.dispose();
      /**
       * The highlight follows the cursor rather than the engine, for the same
       * reason. `show` paints the Utterance whole, which is the Highlight Level of
       * a Clip nobody has fetched yet (ADR 0005) — and it replaces the words the
       * *previous* Voice was cued with, which is the one thing here that would have
       * been a lie left on the page. `clear` is right only where there is no
       * cursor: a document nothing has pointed at has no sentence to leave lit.
       *
       * Repainted where the page is, not revealed: the reading has not moved, and
       * a Voice chosen while paused may be chosen while the owner is looking at
       * another chapter (#52).
       */
      const at = atRef.current;
      if (at === null) bridgeRef.current?.clear();
      else bridgeRef.current?.show(at, { reveal: false });
      setStatus((was) => ({
        ...was,
        playing: false,
        buffering: false,
        pendingVoice: null,
        voiceError: null,
        // `utterance` and `section` stay, because the cursor stays. `level` and
        // `reportsWordTimings` go, because both are claims about a Provider that
        // is no longer the one that will speak (`reading-view.tsx`'s
        // `highlightLine` is the sentence they produce).
        level: null,
        reportsWordTimings: null,
        seeking: false,
      }));
    }, []);
  const previousIdentity = useRef(identity);
  useEffect(() => {
    if (previousIdentity.current === identity) return;
    previousIdentity.current = identity;
    if (retainedIdentity.current === engineIdentity(settings)) {
      retainedIdentity.current = null;
      return;
    }
    retainedIdentity.current = null;
    disposeEngine();
  }, [identity, settings, disposeEngine]);
  useEffect(() => disposeEngine, [disposeEngine]);

  /**
   * The Utterance being spoken, written down as a place in the document.
   *
   * The locator is the **Block's** CFI, which is an element CFI with no text
   * step — `messages.ts` says why, and ADR 0008 says why that is the half of the
   * dialect both readers agree on. The anchor is the Utterance's own characters
   * quoted out of the Block's verbatim text, with context, which is what finds
   * it again when the CFI does not resolve where it claims.
   *
   * The first span, when an Utterance has more than one: the repair layer joins
   * a sentence the document's markup cut in two (`rejoin.ts`), and where speech
   * *starts* is the place to come back to.
   *
   * `'epub'` is not an assumption. The CFI came out of the epub.js renderer, so
   * it is an EPUB locator by construction; the day a second renderer exists,
   * this reads the format from whatever produced the Block rather than from a
   * screen that would have to be told.
   */
  const readingPosition = useCallback((): ReadingPlace | null => {
    // A place still pending (#54): the stored position already is that place,
    // with its true Stamp, and the cursor is what it is on its way to replace —
    // this device's older sentence, under a place from another device. Written
    // now, that would be stamped above the newer place and carried to every
    // device, by a pause, a Clip boundary after a renumbering, or leaving.
    if (resumeRef.current) return null;
    const at = atRef.current;
    if (at === null) return null;
    // Still on the sentence a resume landed on: the stored position is already
    // this place, with its true Stamp, and nothing is written (`resumedAtRef`).
    if (at === resumedAtRef.current) return null;
    // A Contents row's choice in a book with no place yet is where the first Play
    // starts, not a place to keep (#52).
    if (unreadRef.current) return null;
    const utterance = loadedRef.current[at];
    const span = utterance?.spans[0];
    if (!span) return null;
    const block = blocksRef.current[span.block];
    if (!block) return null;
    // Assertion-stripped: the one spelling the Positions File allows, and the
    // one the renderer compares by (`canonicalCfi`). The Block keeps epub.js's
    // own spelling for its own `display`.
    return readingPlaceAt(createLocator('epub', canonicalCfi(block.cfi)), block.text, span.start, span.end);
  }, []);

  return { bridge, status, opened, play, pause, chooseVoice, seekTo: pointAt, skip, returnToReading, goToSection, readingPosition, resumeAt };
}
