/**
 * The playback engine: read-ahead, the queue, and the clock everything else
 * follows.
 *
 * Together with the segmenter this is the bulk of the project (ADR 0006). It
 * does not exist in the Zotero-TTS plugin — Zotero's own player and playback
 * engine are roughly 1,900 lines each — and `zotero/reader` is AGPLv3, so the
 * behaviour was learned and the code is written fresh. The behaviour is four
 * things: **three Utterances of read-ahead, two concurrent fetches, a
 * pitch-preserving time-stretch, a gap timer.** Each has its own file here, and
 * this one wires them to the graph.
 *
 * ## What this file is, and what it deliberately is not
 *
 * It is orchestration and nothing else. Every decision it makes has been moved
 * into a file that runs under Node and is tested — the fetch window
 * (`read-ahead.ts`), the cache key (`clip-cache.ts`), rate scaling
 * (`rate.ts`), the gap (`gap.ts`), the position arithmetic (`timeline.ts`).
 * What is left is the order things happen in, which needs a real audio device to
 * mean anything. `test/README.md` is explicit that React Native code and native
 * modules are not tested in this suite by design; a fake `AudioGraph` injected
 * here would produce coverage of a fiction, so there is no seam for one. This
 * file rests on the 60–90 minute backgrounded device session that
 * `notes/NOTES.md` item 4 still has open.
 *
 * ## The transport controls do not return promises
 *
 * `play`, `pause`, `seek` and `setRate` return `void`. Resolving them would mean
 * resolving when the first Clip has been synthesized, which is seconds away and
 * is not what a button press is waiting for. Failures arrive through `onError`,
 * which is the one place they can be shown to the owner (philosophy rule 1:
 * report, never hang).
 */

import type { Utterance } from '../core/segmenter';
import type { TTSProvider } from '../core/providers/types';
import { createMemoryCache } from '../core/memory-cache';
import { createAudioGraph, type AudioGraph, type DecodedClip } from './audio-graph';
import { createClipFetcher, DEFAULT_CACHE_BYTES, type PreparedClip } from './clips';
import type { ClipCache, StoredClip } from './clip-cache';
import { DEFAULT_GAP, gapContentSeconds, startsNewBlock, type GapSettings } from './gap';
import { atTheEar, clampRate, heardSeconds, NATURAL_PACE, scaleTimings } from './rate';
import { enqueueCeiling, fetchWindow, hasRunOut, type UtteranceState } from './read-ahead';
import type { ReaderClock } from './reader-clock';
import { createTimeline, type QueuedClip, type TimelinePosition } from './timeline';
import { wordHandoff } from './voice-boundary';

/**
 * What the engine knows about its own exhaustion, which is more than "it
 * happened".
 *
 * **Why the failures are in here rather than in a condition.** A Clip that was
 * refused leaves `inFlight`, `drain` steps over it and `nextToEnqueue` passes it,
 * so every one of `hasRunOut`'s four conditions holds exactly as it does for a
 * book that finished — and the app said "the reading has stopped at the end of
 * the book" to an owner whose Provider had dropped the last clips of a document
 * (notes/NOTES_2026-09-20.md, 07:48). Suppressing the announcement instead would
 * restore the silence the announcement exists to end, so the engine reports what
 * it already tracks and the app has a third sentence to say (ADR 0023).
 */
export interface OutOfTextReport {
  /** How many Utterances the engine had when it ran out. */
  known: number;
  /**
   * How many of them were **never spoken** — a synthesis that was refused, or a
   * Clip that would not decode — since the last `load` or `seek`.
   *
   * Since then and not ever, because that is what the owner just listened to: a
   * seek back to a failed Utterance is how a retry is asked for (`read-ahead.ts`),
   * and it clears this with the rest of the restart.
   */
  unspoken: number;
  /**
   * The last of those refusals, exactly as it arrived, or null when none did.
   *
   * Unconverted: `SynthesisError`'s message already names the address it tried and
   * asks the one question there is, and the app has one place that turns a problem
   * into a sentence (`describe` in `use-reading.ts`).
   */
  refusal: unknown;
}

export interface PlaybackEngineDeps {
  /** The Provider, already holding its key — which arrives as a setting and never as a side effect (ADR 0002). */
  provider: TTSProvider;
  /** Initial Voice. An explicit switch replaces it only at an audible boundary. */
  voice: string;
  /** Where the clock goes: the renderer's bridge (ADR 0005) and the lock screen (ADR 0016) are two readers of one clock. */
  clock: ReaderClock;
  /** Reported, never thrown. A synthesis that failed, a decode that failed, a session that would not activate. */
  onError(error: unknown): void;
  onState?(state: { playing: boolean; buffering: boolean }): void;
  /**
   * Everything the engine was given has been spoken and the queue is empty.
   *
   * The engine does not stop here and cannot: a drained buffer queue renders
   * silence, stays in the playing state and resumes on the next buffer
   * (notes/NOTES.md footgun 3), and a `stop()` to "reset" it is what breaks
   * resumption. So running out of text looks from the inside exactly like a
   * Provider being slow, and from the outside like nothing at all — which is how
   * a reading sat silent and `playing` for six minutes on the owner's book
   * (notes/NOTES_2026-09-20.md, 04:43) with nobody told.
   *
   * This is the engine saying it. Once per exhaustion: a longer list, a seek or a
   * load arms it again, so a reading that is fed more text and runs out again
   * says so again.
   */
  onOutOfText?(report: OutOfTextReport): void;
  /** Memory only (ADR 0002). Left out, the engine makes its own. */
  cache?: ClipCache;
  /** The owner's reading speed. Applied here and nowhere else (ADR 0009); a Provider is never asked for it. */
  rate?: number;
  gap?: GapSettings;
  /**
   * The output device's latency in heard seconds, subtracted from the position
   * the highlight follows — 150–200 ms over Bluetooth or AirPlay, and zero on
   * the speaker. See `rate.ts`'s `atTheEar` for why it is a parameter: this
   * library exposes neither the device's latency nor a usable figure for the
   * stretcher's, both are constant offsets rather than drift, and one number
   * measured in the device session settles them.
   */
  outputLatencySeconds?: number;
  synthesisTimeoutMs?: number;
}

/** Enough to draw a player and to tell a stall from a pause, which is the question a device session asks. */
export interface PlaybackSnapshot {
  playing: boolean;
  /** The Utterance being read. */
  utterance: number;
  rate: number;
  /** Buffers enqueued and not yet consumed. Zero while playing means the queue has drained and the reader is waiting on a Provider. */
  queued: number;
  /** Synthesis requests in flight, at most two (ADR 0006). */
  fetching: number;
}

export interface PlaybackEngine {
  /** A document's Utterances in reading order, and where to start. Does not begin playing. */
  load(utterances: readonly Utterance[], from?: number): void;
  /**
   * The same document, with more Utterances on the end of it — and **nothing
   * restarted**.
   *
   * The list grows while the reading is under way, because epub.js renders one
   * section at a time and the app segments the whole document again each time a
   * new one reports (`src/app/use-reading.ts`). `load` is the wrong call for
   * that: it clears the queue and re-anchors the clock, so it restarts the
   * sentence being spoken, and the app therefore used to hold the longer list
   * back until the next Clip boundary. That deferral is what turned a reading
   * that ran out of text into one that could not be rescued — the boundary it
   * waited for is itself a Clip starting, and no Clip starts when there is
   * nothing left to start one.
   *
   * Nothing here needs clearing. The caller has already established that the new
   * list continues the old one rather than renumbering it (`samePrefix`), so
   * every index the queue, the timeline and the WebView are holding still means
   * the sentence it meant before; the read-ahead simply has further to go. Safe
   * to call from inside a message handler for the same reason: `drain` may be
   * mid-await, and this takes nothing out from under it.
   */
  extend(utterances: readonly Utterance[]): void;
  play(): void;
  pause(): void;
  /** Jump to an Utterance: the queue is cleared, the clock re-anchored, and the reading resumes there if it was playing. */
  seek(utterance: number): void;
  setRate(rate: number): void;
  switchVoice(provider: TTSProvider, voice: string, selected: () => void, failed: (error: unknown) => void): void;
  cancelVoiceSwitch(): void;
  snapshot(): PlaybackSnapshot;
  /** Give back the audio session and close the context. After this the engine is done. */
  dispose(): Promise<void>;
}

export function createPlaybackEngine(deps: PlaybackEngineDeps): PlaybackEngine {
  const gap = deps.gap ?? DEFAULT_GAP;
  const latency = Math.max(0, deps.outputLatencySeconds ?? 0);
  const cache = deps.cache ?? createMemoryCache<StoredClip>({ maxBytes: DEFAULT_CACHE_BYTES });
  let fetcher = createClipFetcher({
    provider: deps.provider,
    voice: deps.voice,
    cache,
    timeoutMs: deps.synthesisTimeoutMs,
  });
  const timeline = createTimeline();

  let utterances: readonly Utterance[] = [];
  let rate = clampRate(deps.rate ?? NATURAL_PACE);
  let playing = false;
  let disposed = false;

  /** The Utterance being read. The read-ahead window slides with it. */
  let cursor = 0;
  /** The next Utterance to put on the queue. Buffers go on in reading order however the fetches finish. */
  let nextToEnqueue = 0;
  /** Bumped by `load`, so a fetch for the previous document cannot land in the new one's window. */
  let generation = 0;

  const prepared = new Map<number, PreparedClip>();
  const inFlight = new Set<number>();
  const failed = new Set<number>();
  /**
   * The last problem that left an Utterance unspoken, for `OutOfTextReport`.
   *
   * Not every problem: a session that would not activate is reported through
   * `onError` and is not a sentence that was skipped. This is set beside
   * `failed.add` and cleared beside `failed.clear`, so the two cannot disagree
   * about whether anything was lost.
   */
  let lastRefusal: unknown = null;

  let graph: AudioGraph | null = null;
  /** `drain` is the only thing that enqueues, and it must do so in order, so only one run of it exists at a time. */
  let draining = false;
  /** The Utterance the renderer has been given a cue for, so a cue is sent once per Clip. */
  let cued: number | null = null;
  /** The last position reported, kept so a rate change can re-cue from where the reading actually is. */
  let last: TimelinePosition | null = null;
  /** Whether running out of text has already been said. Cleared by anything that gives the engine somewhere else to go. */
  let announced = false;
  let voiceGeneration = 0;
  let switchSerial = 0;
  const audioByBuffer = new Map<string, DecodedClip>();
  type PendingSwitch = {
    id: number;
    fetcher: ReturnType<typeof createClipFetcher>;
    ready: Map<number, DecodedClip>;
    fetching: Set<number>;
    selected(): void;
    failed(error: unknown): void;
    armed: { cut: string | null; removed: { clip: QueuedClip; audio: DecodedClip }[] } | null;
    deadline: ReturnType<typeof setTimeout> | null;
  };
  let pending: PendingSwitch | null = null;
  let lastState = '';
  function publish() {
    const buffering = playing && timeline.pending() === 0;
    const state = `${playing}:${buffering}`;
    if (state === lastState || disposed) return;
    lastState = state;
    deps.onState?.({ playing, buffering });
  }

  function stateOf(index: number): UtteranceState {
    if (prepared.has(index)) return 'ready';
    if (inFlight.has(index)) return 'fetching';
    if (failed.has(index)) return 'failed';
    return 'absent';
  }

  function pump(): void {
    if (disposed) return;
    for (const index of pending?.armed ? [] : fetchWindow({ cursor, total: utterances.length, inFlight: inFlight.size, stateOf })) {
      startFetch(index);
    }
    void drain();
    prepareSwitch();
    publish();
    outOfText();
  }

  /** Say, once, that there is nothing left to play. `read-ahead.ts` holds the four conditions and why each one is there. */
  function outOfText(): void {
    if (announced || disposed) return;
    const state = {
      playing,
      nextToEnqueue,
      total: utterances.length,
      queued: timeline.pending(),
      fetching: inFlight.size,
    };
    if (!hasRunOut(state)) return;
    announced = true;
    deps.onOutOfText?.({ known: utterances.length, unspoken: failed.size, refusal: lastRefusal });
  }

  function startFetch(index: number): void {
    const utterance = utterances[index];
    if (!utterance) return;
    const mine = generation;
    inFlight.add(index);
    fetcher.fetch(index, utterance.text, utterance.speakable).then(
      (clip) => {
        // A Clip for a document that is no longer open, or one a seek has left
        // behind, is dropped rather than held: its bytes are in the cache, so
        // reaching it again costs nothing and nobody is billed twice.
        if (mine === generation && index >= cursor && index <= enqueueCeiling(cursor)) prepared.set(index, clip);
      },
      (error) => {
        if (mine === generation) {
          failed.add(index);
          lastRefusal = error;
        }
        if (mine === generation && !disposed) deps.onError(error);
      },
    ).finally(() => {
      if (mine === generation) inFlight.delete(index);
      pump();
    });
  }

  /**
   * Put prepared Clips on the queue, in reading order, up to the read-ahead
   * ceiling. Serialized because an encoded Clip has to be decoded first, which
   * is asynchronous, and two decodes racing would enqueue out of order — which
   * in a buffer queue is not a glitch but a permanently wrong timeline.
   */
  async function drain(): Promise<void> {
    if (draining || disposed) return;
    draining = true;
    try {
      while (!disposed && !pending?.armed && nextToEnqueue < utterances.length && nextToEnqueue <= enqueueCeiling(cursor)) {
        const clip = prepared.get(nextToEnqueue);
        if (!clip) {
          // Never skip missing content. Let already-queued audio finish, then
          // stop exactly at the missing utterance; Play explicitly retries it.
          if (failed.has(nextToEnqueue)) {
            if (timeline.pending() === 0 && playing) {
              cursor = nextToEnqueue;
              pauseNow();
              deps.clock.onClip({ utterance: cursor, words: null, duration: 0, rate });
              deps.onError(lastRefusal);
            }
            break;
          }
          break;
        }
        const index = nextToEnqueue;
        const mine = generation;
        try {
          await enqueue(clip, mine);
        } catch (error) {
          // A decode failure blocks here too; never claim unheard text was read.
          if (mine === generation && !disposed) {
            deps.onError(error);
            failed.add(nextToEnqueue);
            lastRefusal = error;
            prepared.delete(index);
            break;
          }
        }
        if (mine !== generation || pending?.armed) break;
        prepared.delete(index);
        nextToEnqueue = index + 1;
      }
    } catch (error) {
      deps.onError(error);
    } finally {
      draining = false;
      publish();
    }
  }

  function queueAudio(audio: DecodedClip, gapSeconds: number, from = 0, to = audio.duration, voice = voiceGeneration) {
    if (!graph) return;
    for (const enqueued of graph.enqueue(audio, gapSeconds, from, to)) {
      timeline.enqueued({ ...enqueued, utterance: audio.clip.utterance, words: audio.clip.words, voiceGeneration: voice });
      audioByBuffer.set(enqueued.bufferId, audio);
    }
  }

  async function enqueue(clip: PreparedClip, mine: number): Promise<void> {
    const current = utterances[clip.utterance];
    if (!current) return;
    const paragraphAhead = startsNewBlock(current, utterances[clip.utterance + 1]);
    const built = await ensureGraph(clip);
    if (!built || disposed) return;

    const audio = await built.prepare(clip);
    if (disposed || mine !== generation || pending?.armed) return;
    queueAudio(audio, gapContentSeconds(gap, paragraphAhead));

    // Starting the node is what activates the engine, so it happens after there
    // is something to play rather than at construction. Calling it again while
    // playing is a no-op (see `AudioGraph.resume`).
    if (playing) built.resume();

    // The first Clip after a load or a seek has no preceding `onBufferEnded` to
    // announce it, so its cue goes out here. Every later cue comes from the
    // boundary itself.
    const front = timeline.front();
    if (cued === null && front) cue(front);
    prepareSwitch();
    publish();
  }

  async function ensureGraph(first: PreparedClip): Promise<AudioGraph | null> {
    if (graph) return graph;
    const built = await createAudioGraph(first, {
      onPosition,
      onBufferEnded,
      onOutputLost,
      onError: deps.onError,
    });
    built.setRate(rate);
    if (disposed) {
      await built.dispose();
      return null;
    }
    graph = built;
    return built;
  }

  /** The only clock. `position` is the source node's content position, never `AudioContext.currentTime` (ADR 0012). */
  function onPosition(position: number): void {
    const at = timeline.advanceTo(position);
    if (!at) return;
    cursor = at.clip.utterance;
    landed(at.clip);
    last = at;
    // Belt and braces: if the boundary's own cue was missed, the correction
    // below would carry an Utterance the renderer is not showing. One comparison
    // closes that, and it costs nothing in the normal case.
    if (at.clip.utterance !== cued) cue(at.clip);
    correct(at);
    pump();
  }

  /**
   * A buffer has been consumed, so the next Clip has started — and this fires at
   * the boundary itself, which is why the cue is sent from here rather than from
   * the position stream, whose cadence is one second (ADR 0005).
   */
  function onBufferEnded(bufferId: string): void {
    audioByBuffer.delete(bufferId);
    timeline.ended(bufferId);
    const front = timeline.front();
    if (front) {
      cursor = front.utterance;
      landed(front);
      if (last?.clip.bufferId !== front.bufferId) {
        last = { clip: front, inClip: front.offset ?? 0, inGap: false, position: timeline.anchor() };
      }
      if (front.utterance !== cued) cue(front);
    }
    pump();
  }

  /**
   * The headphones came out (`OldDeviceUnavailable`). Pausing here is the whole
   * of footgun 2: the library dispatches this event and then rebuilds the engine
   * and keeps going, so without this line the book reads itself aloud through
   * the speaker.
   */
  function onOutputLost(): void {
    pauseNow();
  }

  function pauseNow(): void {
    playing = false;
    graph?.pause();
    publish();
  }

  function cue(clip: QueuedClip): void {
    cued = clip.utterance;
    deps.clock.onClip({
      utterance: clip.utterance,
      // Scaled here, once per Clip. ADR 0005 calls forgetting this the single
      // easiest way to reintroduce drift.
      words: scaleTimings(clip.words, rate),
      duration: heardSeconds(clip.duration ?? clip.speech, rate),
      rate,
    });
  }

  function correct(at: TimelinePosition): void {
    deps.clock.onPosition({
      utterance: at.clip.utterance,
      clipPosition: atTheEar(heardSeconds(at.inClip, rate), latency),
      // The node's own value, unchanged: the elapsed time ADR 0016 pushes to the
      // lock screen is the same clock the highlight follows, so the two cannot
      // disagree.
      contentPosition: at.position,
      inGap: at.inGap,
    });
  }

  function restart(from: number): void {
    cancelVoiceSwitch();
    generation++;
    inFlight.clear();
    cursor = Math.min(Math.max(0, from), Math.max(0, utterances.length - 1));
    nextToEnqueue = cursor;
    prepared.clear();
    failed.clear();
    lastRefusal = null;
    cued = null;
    last = null;
    announced = false;
    graph?.clear();
    timeline.reset();
    audioByBuffer.clear();
  }

  function cancelVoiceSwitch() {
    const previous = pending;
    pending = null;
    if (previous?.deadline) clearTimeout(previous.deadline);
    if (!previous?.armed || !graph) return;
    const { cut, removed } = previous.armed;
    const discarded = timeline.truncateAfter(cut);
    graph.remove(discarded.map((clip) => clip.bufferId));
    for (const clip of discarded) audioByBuffer.delete(clip.bufferId);
    for (const item of removed) queueAudio(item.audio, item.clip.gap, item.clip.offset ?? 0,
      (item.clip.offset ?? 0) + item.clip.speech, item.clip.voiceGeneration);
  }

  function landed(front: QueuedClip) {
    const target = pending;
    if (!target?.armed || front.voiceGeneration !== target.id) return;
    pending = null;
    if (target.deadline) clearTimeout(target.deadline);
    voiceGeneration = target.id;
    generation++;
    inFlight.clear();
    prepared.clear();
    failed.clear();
    lastRefusal = null;
    fetcher = target.fetcher;
    nextToEnqueue = front.utterance + 1;
    for (const [index, audio] of target.ready) if (index >= nextToEnqueue) prepared.set(index, audio.clip);
    cued = null;
    last = { clip: front, inClip: front.offset ?? 0, inGap: false, position: timeline.anchor() };
    cue(front);
    correct(last);
    // The native queue has crossed the boundary. Receipt of a network response
    // or merely queueing the replacement must never turn the spinner into a tick.
    target.selected();
  }

  function arm(target: PendingSwitch, audio: DecodedClip, cut: string | null, offset: number) {
    if (!graph || pending !== target || target.armed) return;
    const removed = timeline.truncateAfter(cut).map((clip) => ({ clip, audio: audioByBuffer.get(clip.bufferId)! }));
    graph.remove(removed.map(({ clip }) => clip.bufferId));
    for (const { clip } of removed) audioByBuffer.delete(clip.bufferId);
    target.armed = { cut, removed };
    queueAudio(audio, gapContentSeconds(gap, startsNewBlock(utterances[audio.clip.utterance]!, utterances[audio.clip.utterance + 1])), offset, audio.duration, target.id);
    // With an empty old queue, this is the first playable source. Wait for its
    // native position event before publishing selection.
    if (playing) graph.resume();
    publish();
  }

  function prepareSwitch() {
    const target = pending;
    if (!target || target.armed || !graph || disposed) return;
    const queue = timeline.clips();
    const front = queue[0];
    const index = front?.utterance ?? nextToEnqueue;
    const replacement = target.ready.get(index);
    if (replacement && !front) { arm(target, replacement, null, 0); return; }
    if (replacement && front) {
      // Preserve the currently playing native buffer. The cut is a subsequent
      // reported word end, so splicing never edits a buffer the audio thread reads.
      const boundary = wordHandoff(utterances[index]!.text, front.words, replacement.clip.words,
        (front.offset ?? 0) + front.speech, front.duration ?? front.speech, replacement.duration);
      const cut = boundary && queue.find((clip) => clip.utterance === index &&
        Math.abs((clip.offset ?? 0) + clip.speech - boundary.end) <= 1 / graph!.sampleRate);
      if (boundary && cut) { arm(target, replacement, cut.bufferId, boundary.offset); return; }
    }
    const following = target.ready.get(index + 1);
    const lastOfCurrent = queue.filter((clip) => clip.utterance === index).at(-1);
    if (following && lastOfCurrent) { arm(target, following, lastOfCurrent.bufferId, 0); return; }
    for (const at of [index, index + 1]) {
      const text = utterances[at];
      if (!text || target.ready.has(at) || target.fetching.has(at) || target.fetching.size >= 2) continue;
      target.fetching.add(at);
      const built = graph;
      void target.fetcher.fetch(at, text.text, text.speakable).then((clip) => {
        if (pending !== target || disposed) return null;
        return built.prepare(clip);
      }).then((audio) => {
        if (pending !== target || disposed || !audio) return;
        target.ready.set(at, audio);
        for (const key of target.ready.keys()) if (key < cursor) target.ready.delete(key);
        prepareSwitch();
      }).catch((error: unknown) => {
        if (pending !== target || disposed) return;
        cancelVoiceSwitch();
        target.failed(error);
      }).finally(() => target.fetching.delete(at));
    }
  }

  return {
    load(list, from = 0) {
      generation++;
      utterances = list;
      restart(from);
      pump();
    },

    extend(list) {
      if (disposed) return;
      // A longer list is somewhere else to go, so running out of text becomes a
      // thing that can be said again if it happens again further on.
      if (list.length > utterances.length) announced = false;
      utterances = list;
      // No `restart`, no `generation++`: nothing the queue, the timeline or the
      // in-flight fetches are holding has been renumbered, so the read-ahead
      // simply picks up where it stopped.
      pump();
    },

    play() {
      if (disposed) return;
      if (failed.has(cursor)) {
        failed.delete(cursor);
        nextToEnqueue = cursor;
      }
      playing = true;
      graph?.resume();
      const front = timeline.front();
      if (front) {
        cue(front);
        correct(last?.clip.bufferId === front.bufferId ? last :
          { clip: front, inClip: front.offset ?? 0, inGap: false, position: timeline.anchor() });
      }
      pump();
    },

    pause: pauseNow,

    seek(utterance) {
      if (disposed) return;
      restart(utterance);
      // No `resume()` here: `clearBuffers()` leaves the node in the playing
      // state and an empty queue renders silence until the next buffer arrives
      // (footgun 3). A stop to "reset" it is exactly what breaks resumption.
      pump();
    },

    setRate(next) {
      rate = clampRate(next);
      graph?.setRate(rate);
      // The renderer is holding timings divided by the old rate, so it gets the
      // array again and a correction to re-anchor its interpolation against.
      // Nothing about the queued audio changes: the Clips were synthesized at
      // Natural Pace and the stretch is a parameter (ADR 0009).
      if (last) {
        cue(last.clip);
        correct(last);
        return;
      }
      // Changed before the first position arrived — within the first second of a
      // Clip. There is nothing to correct against yet, so the array goes out
      // again and the correction that follows within the second anchors it.
      const front = timeline.front();
      if (front) cue(front);
    },

    switchVoice(provider, voice, selected, failed) {
      cancelVoiceSwitch();
      const target: PendingSwitch = { id: ++switchSerial, fetcher: createClipFetcher({ provider, voice, cache, timeoutMs: deps.synthesisTimeoutMs }),
        ready: new Map(), fetching: new Set(), selected, failed, armed: null, deadline: null };
      pending = target;
      // A slow target must not chase a fast reading forever. Pausing still keeps
      // downloads alive; this bounds preparation, not how long a pause may last.
      target.deadline = setTimeout(() => {
        if (pending !== target || target.armed) return;
        cancelVoiceSwitch();
        failed(new Error('The new voice could not catch up. The current voice is unchanged.'));
      }, 120_000);
      prepareSwitch();
    },

    cancelVoiceSwitch,

    snapshot() {
      return { playing, utterance: cursor, rate, queued: timeline.pending(), fetching: inFlight.size };
    },

    async dispose() {
      disposed = true;
      playing = false;
      if (pending?.deadline) clearTimeout(pending.deadline);
      pending = null;
      audioByBuffer.clear();
      prepared.clear();
      const built = graph;
      graph = null;
      await built?.dispose();
    },
  };
}
