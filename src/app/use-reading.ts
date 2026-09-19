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
import { createPlaybackEngine, type PlaybackEngine, type ReaderClock } from '../playback';
import {
  useReaderBridge,
  type ProblemMessage,
  type ReaderBridge,
  type RenderedSection,
  type ReportedBlock,
} from '../renderer';

import { documentLanguage, samePrefix, segmentDocument } from './segment';
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
  /** The last thing that went wrong or was refused, in the words whatever refused it used. Shown, never swallowed (philosophy rule 1). */
  note: string | null;
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
  note: null,
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

export function useReading(settings: AppSettings, credentials: KnownCredentials): Reading {
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

  const report = useCallback((problem: unknown) => {
    setStatus((was) => ({ ...was, note: describe(problem) }));
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
        setStatus((was) => ({ ...was, utterance: cue.utterance, level: cue.words ? 'word' : 'utterance' }));
      },
      onPosition(correction) {
        bridgeRef.current?.clock.onPosition(correction);
      },
    }),
    [],
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
  const seek = useCallback((from: RenderedSection) => {
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
        if (seekingRef.current) seek(section);
        return;
      }

      if (engineRef.current?.snapshot().playing) {
        pendingRef.current = next;
        return;
      }
      adopt(next);
    },
    [adopt, seek],
  );

  const handleProblem = useCallback((problem: ProblemMessage) => {
    setStatus((was) => ({ ...was, note: `The highlight could not be drawn: ${problem.detail}` }));
  }, []);

  const bridge = useReaderBridge({ onBlocks: handleBlocks, onProblem: handleProblem });

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
    engine.load(loadedRef.current, 0);
    setStatus((was) => ({ ...was, reportsWordTimings: provider.capabilities.wordTimestamps, note: null }));
    return engine;
  }, [settings, hasKey, clock, report]);

  const play = useCallback(() => {
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
      if (rendered) seek(rendered);
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
  }, [build, report, seek]);

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

  return { bridge, status, opened, play, pause, readingPosition };
}
