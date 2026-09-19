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

import { createLocator, readingPositionAt, type ReadingPosition } from '../core/document';
import { createProvider } from '../core/providers/factory';
import type { Utterance } from '../core/segmenter';
import { readGatewayHeaders, readProviderKey } from '../keys/store';
import {
  createPlaybackEngine,
  nextParagraph,
  nextSentence,
  previousParagraph,
  previousSentence,
  type PlaybackEngine,
  type ReaderClock,
} from '../playback';
import {
  resolveResume,
  resumeSentence,
  useReaderBridge,
  type ProblemMessage,
  type ReaderBridge,
  type RenderedSection,
  type ReportedBlock,
  type ReportedDocument,
} from '../renderer';

import { documentLanguage, firstUtteranceOfSection, samePrefix, segmentDocument } from './segment';
import {
  engineIdentity,
  headersAreOffered,
  keyIsOffered,
  keyIsRequired,
  providerDeps,
  providerSettings,
  readiness,
  readinessSentence,
  type AppSettings,
} from './settings';

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

/**
 * How long a burst of skip presses is gathered before one seek goes out.
 *
 * **600 ms, which is Zotero's own number** (`SKIP_DEBOUNCE_DELAY`,
 * `reader.js:39904`, applied at `:40222`), and it is here for the reason ADR 0020
 * gives: five taps must not be five synthesis requests. The highlight moves on
 * every press — `bridge.show` paints it at once — and only the synthesis waits, so
 * the debounce costs nothing a reader can see.
 */
const SKIP_DEBOUNCE_MS = 600;

/** Everything the player bar and the status line show. Nothing in here changes more than once per Utterance. */
export interface ReadingStatus {
  playing: boolean;
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
}

const NOTHING_YET: ReadingStatus = {
  playing: false,
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
};

export interface Reading {
  /** Spread `bridge.readerProps` onto `<Reader>`; everything else the screen needs is here. */
  bridge: ReaderBridge;
  status: ReadingStatus;
  /** The document is open and epub.js has displayed it. `language` is the EPUB's own `dc:language`, which is never sniffed (ADR 0006). */
  opened(language: string | null | undefined): void;
  play(): void;
  pause(): void;
  /**
   * Read from this Utterance (ADR 0020).
   *
   * What tapping a word and tapping a contents row both end in, and what the four
   * skips below are: **six controls, one seek**, which is ADR 0020's whole
   * argument. The highlight moves at once and the synthesis is debounced by
   * `SKIP_DEBOUNCE_MS`.
   *
   * It does not resume a paused reading and it does not pause a playing one: the
   * engine's own `seek` is `restart(); pump()` with deliberately no `resume()`, so
   * navigating while paused moves the highlight and leaves the silence alone —
   * which is Zotero's behaviour, verified in its source (ADR 0020).
   */
  seekTo(utterance: number): void;
  /** One of the four skips, computed by `playback/navigation.ts` from where the reading is. */
  skip(target: SkipTarget): void;
  /**
   * A contents row: move the page to a spine item, and read from its first
   * Utterance.
   *
   * **Two steps** (ADR 0020). `goToSection` moves the page only; the Utterance to
   * read from does not exist until that section has rendered and reported its
   * Blocks, so the second step waits for them — unless the section has already
   * rendered, in which case it happens now.
   */
  goToSection(section: number): void;
  /**
   * Where speech has got to, as a **Reading Position** (ADR 0008), or null
   * before a Clip has played.
   *
   * A function and not a field, and that is the whole of its design. A Reading
   * Position changes once per Utterance, which is often enough that putting it
   * in `ReadingStatus` would make the screen re-render for something it does not
   * draw — and ADR 0005's rule about playback position exists because that
   * re-render is what blows the frame budget. Nothing here touches state; the
   * caller asks when it is about to write the Library.
   */
  readingPosition(): ReadingPosition | null;
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
export function useReading(settings: AppSettings, credentials: KnownCredentials, resume: ReadingPosition | null): Reading {
  const { hasKey, writtenAt } = credentials;
  const [status, setStatus] = useState<ReadingStatus>(NOTHING_YET);

  const engineRef = useRef<PlaybackEngine | null>(null);
  const bridgeRef = useRef<ReaderBridge | null>(null);
  /** Being built: a second press of play must not build a second engine and a second audio session. */
  const buildingRef = useRef<Promise<PlaybackEngine | null> | null>(null);
  /** The Utterances the engine holds. Its indices are what every cue and every correction is about. */
  const loadedRef = useRef<readonly Utterance[]>([]);
  /** Utterances a new section produced while the reading was under way. Applied at the next Clip boundary; see `adopt`. */
  const pendingRef = useRef<readonly Utterance[] | null>(null);
  /** The Utterance being read, outside React state, so the callbacks below are never one render behind. */
  const atRef = useRef<number | null>(null);
  /** The section the renderer reported last, for the same reason: `play` reads it at the moment it is pressed. */
  const renderedRef = useRef<RenderedSection | null>(null);
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
   * The Utterance a burst of presses has arrived at, waiting for
   * `SKIP_DEBOUNCE_MS` to run out.
   *
   * The **base** the next press counts from as well as the payload of the pending
   * seek, which is what makes five presses of previous-sentence go back five
   * sentences rather than one. It cannot be `atRef`: a Clip boundary inside the
   * 600 ms would move that, and the timer would then seek to wherever the engine
   * had got to instead of where the owner pointed.
   */
  const pendingSeekRef = useRef<number | null>(null);
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The spine item a contents tap is waiting on, or null.
   *
   * The second half of that tap: the page has been moved and the reading cannot
   * follow until the section reports its Blocks, because until then it has no
   * Utterance to seek to (`firstUtteranceOfSection`).
   */
  const pendingSectionRef = useRef<number | null>(null);
  /**
   * The stored Reading Position, until an Utterance has been found for it.
   *
   * It cannot be resolved at mount: the anchor is matched against **Blocks**, and
   * no section has reported any yet. So it waits here and every `onBlocks` tries
   * again — the first sections to render are the ones around the stored CFI,
   * because `<Reader initialLocation>` was given that CFI, but a cover page and a
   * chapter epub.js renders on the way can arrive first.
   */
  const resumeRef = useRef<ReadingPosition | null>(resume);
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
    setStatus((was) => ({ ...was, note: describe(problem) }));
  }, []);

  /**
   * Something else has decided where to read, so the stored Reading Position
   * stops competing for it.
   *
   * A press of Play, a tapped word, a skip, a contents row. Without this, a
   * position that resolved late — the section it names rendering thirty seconds
   * into a 2,077-section book — would take the reading away from wherever the
   * owner had just put it, which is the "silent landing three paragraphs away"
   * ADR 0008 exists to prevent, arriving by the back door.
   */
  const abandonResume = useCallback(() => {
    if (!resumeRef.current) return;
    resumeRef.current = null;
    const lost = resumeLostRef.current;
    setStatus((was) => ({
      ...was,
      resume:
        lost ??
        'The place this book was left at had not rendered yet when the reading was asked to start, so it starts here instead.',
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
   * the elapsed time and the highlight cannot disagree. It is not built yet; when
   * it is, it is another line in `onPosition` and not another clock.
   */
  const clock = useMemo<ReaderClock>(
    () => ({
      onClip(cue) {
        bridgeRef.current?.clock.onClip(cue);
        atRef.current = cue.utterance;
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
        bridgeRef.current?.clock.onPosition(correction);
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
   * `load` is destructive: it clears the queue and re-anchors the clock. That is
   * why this is called at a **Clip boundary** and from an effect rather than from
   * the cue itself — at the boundary the Clip's own offset is zero, so restarting
   * it costs a fraction of a second and nothing in quota, because the Clip is in
   * the memory cache (ADR 0002, philosophy rule 4). Calling it from inside
   * `onClip` would re-enter the engine while its own `drain` is mid-await.
   *
   * If the prefix changed, the indices the engine and the WebView are holding
   * mean other sentences (see `samePrefix`), and the reading stops and says so.
   * A highlight three paragraphs from the voice is precisely what this project
   * exists to prevent, and guessing which sentence was meant would be an
   * estimate (philosophy rule 1).
   */
  const adopt = useCallback((next: readonly Utterance[]) => {
    const engine = engineRef.current;
    const renumbered = !samePrefix(loadedRef.current, next);
    loadedRef.current = next;

    if (renumbered) {
      engine?.pause();
      bridgeRef.current?.clear();
      engine?.load(next, 0);
      atRef.current = null;
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

    engine?.load(next, atRef.current ?? 0);
  }, []);

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
    setStatus((was) => ({
      ...was,
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
   * Two things happen, and the split between them is the whole of this function.
   * The **highlight moves now**, through `bridge.show`, which paints the Utterance
   * whole and scrolls the page to it without knowing anything about a Clip. The
   * **seek waits** `SKIP_DEBOUNCE_MS`, so that a burst of presses is one synthesis
   * request rather than five (ADR 0020, and Zotero's own 600 ms).
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
    // A word tapped, a skip, a contents row: the owner has pointed somewhere, so
    // the bookmark is done asking. The resume's own call clears the ref first, so
    // this is a no-op on that path.
    abandonResume();
    const at = Math.min(list.length - 1, Math.max(0, Math.trunc(utterance)));
    pendingSeekRef.current = at;
    atRef.current = at;
    bridgeRef.current?.show(at);
    // The Utterance, but not the Highlight Level: whether the Clip that is about to
    // be fetched carries Word Timings is not known yet, and the last Clip's answer
    // is the honest thing to keep showing until it is.
    setStatus((was) => ({ ...was, utterance: at, section: sectionOf(at) }));

    if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
    seekTimerRef.current = setTimeout(() => {
      seekTimerRef.current = null;
      const target = pendingSeekRef.current;
      pendingSeekRef.current = null;
      if (target === null) return;
      // No engine is not a failure to report: the owner has pointed at a sentence
      // without having pressed Play, `atRef` holds it, and the engine that gets
      // built will be loaded there.
      engineRef.current?.seek(target);
    }, SKIP_DEBOUNCE_MS);
  }, [sectionOf, abandonResume]);

  /**
   * One of the four skips.
   *
   * The arithmetic is `playback/navigation.ts`'s and none of it is repeated here —
   * including the one divergence from Zotero, that previous-paragraph restarts the
   * paragraph you are in before stepping back to the one before it.
   *
   * It counts from the **pending** position rather than from the engine's, which is
   * what makes five presses of previous-sentence go back five sentences: the seek
   * has not happened yet, and the position the owner is aiming from is the one the
   * previous press moved the highlight to.
   */
  const skip = useCallback(
    (target: SkipTarget) => {
      const list = loadedRef.current;
      if (list.length === 0) return;
      const from = pendingSeekRef.current ?? atRef.current ?? 0;
      if (target === 'previous-sentence') seekTo(previousSentence(list, from));
      else if (target === 'next-sentence') seekTo(nextSentence(list, from));
      else if (target === 'previous-paragraph') seekTo(previousParagraph(list, from));
      else seekTo(nextParagraph(list, from));
    },
    [seekTo],
  );

  /**
   * A contents row, which is **two steps** (ADR 0020).
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
   */
  const goToSection = useCallback(
    (section: number) => {
      bridgeRef.current?.goToSection(section);
      const already = firstUtteranceOfSection(loadedRef.current, blocksRef.current, section);
      if (already !== null) {
        pendingSectionRef.current = null;
        seekTo(already);
        return;
      }
      /**
       * A section that has already reported its Blocks and yielded no Utterance is
       * finished with, not waited for: the page has moved to it and there is nothing
       * on it to read. Waiting would be waiting for ever — the renderer reports a
       * section again only when its text has changed (`blocks.ts`), so a title page
       * that rendered empty will never report a second time.
       */
      const reported = blocksRef.current.some((block) => block.sectionIndex === section);
      pendingSectionRef.current = reported ? null : section;
    },
    [seekTo],
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
        if (pendingSectionRef.current === section.index) pendingSectionRef.current = null;
        return;
      }

      /**
       * **Coming back to a book.** The stored Reading Position is a CFI and a
       * quotation (ADR 0008); the Utterance it names cannot exist until the
       * Blocks it quotes have been reported, which is now.
       *
       * Tried on every report until it lands, because the first section to render
       * is not always the one the position names — a cover renders first and
       * yields nothing, and the section `initialLocation` asked for arrives when
       * epub.js has displayed it. A report that fails leaves the position
       * pending and keeps its sentence for `abandonResume`.
       *
       * The same order as the contents tap below and for the same two reasons:
       * `adopt` re-anchors the engine at `atRef`, and the Utterance being seeked
       * to exists only in the new list.
       */
      const stored = resumeRef.current;
      if (stored) {
        const found = resolveResume(stored, next, reported);
        if (found.outcome === 'resumed') {
          resumeRef.current = null;
          resumeLostRef.current = null;
          const sentence = resumeSentence(found);
          atRef.current = found.utterance;
          pendingRef.current = null;
          adopt(next);
          seekTo(found.utterance);
          setStatus((was) => ({ ...was, resume: sentence }));
          return;
        }
        resumeLostRef.current = resumeSentence(found);
      }

      /**
       * The second step of a contents tap: the section the owner asked for has
       * rendered, so the reading can follow the page to it.
       *
       * The longer list is adopted **now** rather than at the next Clip boundary,
       * which is the deferral below and the exception to it. That deferral exists so
       * that a section arriving mid-reading does not restart the sentence being
       * spoken; here the owner has asked to leave that sentence, so there is nothing
       * to protect. And the Utterance being seeked to exists only in the new list —
       * deferring would seek into the old one and land somewhere else entirely.
       */
      const wanted = pendingSectionRef.current;
      if (wanted === section.index) {
        pendingSectionRef.current = null;
        const first = firstUtteranceOfSection(next, reported, wanted);
        if (first !== null) {
          // Before `adopt`, because `adopt` re-anchors the engine at `atRef` and
          // anchoring it at the old position would fetch a Clip nobody is waiting for.
          atRef.current = first;
          pendingRef.current = null;
          adopt(next);
          seekTo(first);
          return;
        }
      }

      if (engineRef.current?.snapshot().playing) {
        pendingRef.current = next;
        return;
      }
      adopt(next);
    },
    [adopt, walkForward, seekTo],
  );

  const handleProblem = useCallback((problem: ProblemMessage) => {
    setStatus((was) => ({ ...was, note: `The highlight could not be drawn: ${problem.detail}` }));
  }, []);

  /**
   * The shape of the document, once. The hrefs are what the contents list is built
   * from and without them every row of it is unreachable (ADR 0020).
   */
  const handleDocument = useCallback((document: ReportedDocument) => {
    setStatus((was) => ({ ...was, spineHrefs: document.hrefs }));
  }, []);

  const bridge = useReaderBridge({
    // Fixed at mount, because the program is installed once: the owner's current
    // choice is what a book opens laid out in, and every change after that is a
    // message (`setAppearance`).
    appearance: settings.appearance,
    onBlocks: handleBlocks,
    onDocument: handleDocument,
    // A tap on a word is a seek and nothing else. The bridge has already turned the
    // tapped place into an Utterance (`cursor.ts`'s `utteranceAt`) and calls this
    // only when there was one, so a tap on blank space arrives as no call at all.
    onTap: seekTo,
    onProblem: handleProblem,
  });

  useEffect(() => {
    bridgeRef.current = bridge;
  }, [bridge]);

  /**
   * The Utterances a section produced mid-reading, applied now that a Clip has
   * just started. `status.utterance` changing is the boundary, and an effect is
   * the one place that is outside the engine's own call stack.
   */
  useEffect(() => {
    const next = pendingRef.current;
    if (!next) return;
    pendingRef.current = null;
    adopt(next);
  }, [status.utterance, adopt]);

  /**
   * Build the Provider and the engine, reading the key at the moment it is
   * needed.
   *
   * Returns null having said why. `readiness` covers everything the owner can
   * see; the Keychain refusing is the one thing it cannot, and that is reported
   * as a refusal rather than flattened into "no key" (`src/keys/refusal.ts`
   * exists for exactly that distinction).
   */
  const build = useCallback(async (): Promise<PlaybackEngine | null> => {
    const ready = readiness(settings, hasKey);
    if (!ready.ready) {
      setStatus((was) => ({ ...was, note: readinessSentence(settings.provider, ready.missing) }));
      return null;
    }

    let key = '';
    if (keyIsOffered(settings.provider)) {
      const lookup = await readProviderKey(settings.provider);
      if (lookup.outcome === 'refused') {
        setStatus((was) => ({
          ...was,
          note: `The Keychain would not hand over the key: ${lookup.refusal.message}`,
        }));
        return null;
      }
      if (lookup.outcome === 'found') key = lookup.secret;
      else if (keyIsRequired(settings.provider)) {
        setStatus((was) => ({ ...was, note: readinessSentence(settings.provider, ['an API key']) }));
        return null;
      }
    }

    /**
     * The gateway headers, read the same way and at the same moment as the key
     * (ADR 0019). Absent is not a failure and never can be: a server that is
     * behind nothing wants none, and one that is behind something answers for
     * itself — a 403 from the gateway rather than a guess from here.
     */
    let gatewayHeaders = '';
    if (headersAreOffered(settings.provider)) {
      const lookup = await readGatewayHeaders(settings.provider);
      if (lookup.outcome === 'refused') {
        setStatus((was) => ({
          ...was,
          note: `The Keychain would not hand over the gateway headers: ${lookup.refusal.message}`,
        }));
        return null;
      }
      if (lookup.outcome === 'found') gatewayHeaders = lookup.secret;
    }

    const provider = createProvider(
      settings.provider,
      providerSettings(settings, { key, headers: gatewayHeaders }),
      providerDeps,
    );
    const engine = createPlaybackEngine({
      provider,
      // Fixed for the engine's lifetime, because a Voice belongs to a document
      // (ADR 0010) and a Clip's cache identity includes it.
      voice: settings.voice,
      clock,
      onError: report,
      rate: settings.rate,
    });
    engineRef.current = engine;
    // Where the reading has been pointed, not the top of the document: a word tapped
    // or a chapter chosen before Play was ever pressed has already moved `atRef`, and
    // loading at 0 would silently read the book from its beginning instead (ADR 0020).
    engine.load(loadedRef.current, atRef.current ?? 0);
    setStatus((was) => ({ ...was, reportsWordTimings: provider.capabilities.wordTimestamps, note: null }));
    return engine;
  }, [settings, hasKey, clock, report]);

  const play = useCallback(() => {
    // Play is the owner saying "read from here", and here is wherever the reading
    // is now. A bookmark that has not resolved by this point has lost its claim.
    abandonResume();
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

    if (engineRef.current) {
      engineRef.current.play();
      setStatus((was) => ({ ...was, playing: true, note: null }));
      return;
    }
    buildingRef.current ??= build().finally(() => {
      buildingRef.current = null;
    });
    void buildingRef.current.then((engine) => {
      if (!engine) return;
      engine.play();
      setStatus((was) => ({ ...was, playing: true }));
    }, report);
  }, [build, report, walkForward, abandonResume]);

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

  const pause = useCallback(() => {
    engineRef.current?.pause();
    // Not a third clock message: a pause stops the position stream, and a WebView
    // still interpolating against `requestAnimationFrame` would run the highlight
    // ahead of silence (`reader-bridge.ts`).
    bridgeRef.current?.hold();
    setStatus((was) => ({ ...was, playing: false }));
  }, []);

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
   * changes and when the screen goes away, and it is the only place the audio
   * session is given back.
   */
  const identity = `${engineIdentity(settings)}@${writtenAt}`;
  useEffect(
    () => () => {
      const engine = engineRef.current;
      engineRef.current = null;
      buildingRef.current = null;
      atRef.current = null;
      seekingRef.current = false;
      // A skip's 600 ms could otherwise fire into an engine that has been disposed,
      // or into the next one built around a different Provider.
      if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
      seekTimerRef.current = null;
      pendingSeekRef.current = null;
      pendingSectionRef.current = null;
      void engine?.dispose();
      bridgeRef.current?.clear();
      setStatus((was) => ({
        ...was,
        playing: false,
        utterance: null,
        level: null,
        reportsWordTimings: null,
        seeking: false,
      }));
    },
    [identity],
  );

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
  const readingPosition = useCallback((): ReadingPosition | null => {
    const at = atRef.current;
    if (at === null) return null;
    const utterance = loadedRef.current[at];
    const span = utterance?.spans[0];
    if (!span) return null;
    const block = blocksRef.current[span.block];
    if (!block) return null;
    return readingPositionAt(createLocator('epub', block.cfi), block.text, span.start, span.end);
  }, []);

  return { bridge, status, opened, play, pause, seekTo, skip, goToSection, readingPosition };
}
