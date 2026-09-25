/**
 * The audio graph itself: the audio session, one long-lived
 * `AudioBufferQueueSourceNode`, and the buffers fed into it.
 *
 * **Not a file player.** ADR 0012's reason is first-hand product experience, not
 * technical taste: the author used ElevenReader and abandoned it for Speechify
 * because its word highlighting drifted. A file player can only report where it
 * thinks it is, sampled at intervals, with the position between samples
 * interpolated from the wall clock; an audio graph has nothing to interpolate.
 *
 * This is the only file in `playback/` that imports `react-native-audio-api`, and
 * it is deliberately thin: the session options, the node, and turning samples
 * into an `AudioBuffer`. Everything that can be decided without a device is
 * decided elsewhere, because this file cannot be tested here (`test/README.md` —
 * React Native code and native modules are not tested in this suite by design,
 * and a mock of the audio library would only prove that the mock was called).
 *
 * Four of the five footguns in `notes/NOTES.md` are lines in this file. Each was
 * read out of the library's source, and each fails as something else.
 */

import { AudioContext, AudioManager, type AudioBufferQueueSourceNode, type AudioEventSubscription } from 'react-native-audio-api';

import type { PreparedClip } from './clips';
import { framesFor } from './gap';
import { resampleLinear } from './pcm';
import { POSITION_INTERVAL_MS } from './reader-clock';
import { bufferParts } from './buffer-parts';

/**
 * The offset that tells the native queue node to leave its read index where it
 * is: `AudioBufferQueueSourceNode::start(when, offset)` returns early for any
 * `offset < 0`. It is the wrapper's own default and the wrapper rejects it; see
 * `resume` below.
 */
const KEEP_READ_INDEX = -1;

export interface AudioGraphHandlers {
  /** Source coordinates carried with rendered PCM, from `onPositionChanged` (#63). */
  onPosition(position: number): void;
  /** A buffer has reached output; the native patch defers this until its audio is rendered, including the final tail. */
  onBufferEnded(bufferId: string): void;
  /**
   * The output the owner was listening on has gone away —
   * `OldDeviceUnavailable`, which in practice means the headphones came out.
   *
   * The caller must pause. It is not optional and the library will not do it:
   * `SystemNotificationManager.handleRouteChange` dispatches this event and then
   * calls `handleEngineConfigurationChange`, which rebuilds the engine and keeps
   * playing — so the book reads itself aloud through the speaker
   * (notes/NOTES.md footgun 2).
   */
  onOutputLost(): void;
  onError(error: unknown): void;
}

export interface EnqueuedBuffer {
  bufferId: string;
  /** Content seconds of speech in the buffer, as `frames / sampleRate` of what was written — not as what was asked for. */
  speech: number;
  /** Content seconds of silence after it. */
  gap: number;
  offset: number;
  duration: number;
}

export interface DecodedClip {
  clip: PreparedClip;
  samples: Float32Array<ArrayBuffer>;
  duration: number;
}

export interface AudioGraph {
  /** The context's sample rate. Every buffer enqueued is at this rate; see `enqueue`. */
  readonly sampleRate: number;
  prepare(clip: PreparedClip): Promise<DecodedClip>;
  enqueue(audio: DecodedClip, gapSeconds: number, from?: number, to?: number): EnqueuedBuffer[];
  remove(bufferIds: readonly string[]): void;
  /** The pitch-preserving time-stretch, live. ADR 0009's 1.5–3× is this line and nothing else. */
  setRate(rate: number): void;
  /** Start, or resume after `pause()`. Safe to call when already playing. */
  resume(): void;
  pause(): void;
  /** Throw away every queued buffer, for a seek. */
  clear(): void;
  dispose(): Promise<void>;
}

/**
 * Build the graph around the first Clip.
 *
 * Around the *first Clip* because of the sample rate, which is the one thing the
 * context cannot change afterwards and the one thing the clock depends on:
 * `AudioBufferQueueSourceNode::getCurrentPosition()` divides the read index by
 * the **context's** sample rate while accumulating each buffer's duration from
 * that buffer's **own** rate, and `QueueBufferProcessor` applies no resampling
 * factor at all. A buffer at any other rate therefore plays at the wrong speed
 * and corrupts the position. So the context is created at the rate the Provider
 * actually sent — every Provider on ADR 0013's list sends 24 kHz — and
 * `pcm.ts`'s resampler catches the Clip that later disagrees.
 *
 * An encoded first Clip has no rate to read, so the context takes the device's
 * preferred rate and `decodeAudioData` resamples into it, which it does anyway.
 */
export async function createAudioGraph(first: PreparedClip, handlers: AudioGraphHandlers): Promise<AudioGraph> {
  /**
   * Footgun 1. `AudioManager.setAudioSessionOptions` substitutes an empty string
   * for whichever of `iosCategory` and `iosMode` is omitted
   * (`options.iosCategory ?? ''`), the empty string matches no case in
   * `AudioSessionManager.categoryFromString`, the result is a nil category,
   * `setCategory:mode:options:error:` fails, the session never activates, and
   * **playback is silent with no error at all**. Passing `{ iosMode:
   * 'spokenAudio' }` alone is enough to do it. The library's documented warning
   * covers incompatible combinations, not omission.
   *
   * `spokenAudio` is the correct `AVAudioSession` mode for a reader and is
   * unreachable through `expo-audio`, which never sets a mode; ADR 0012 lists it
   * as part of what the audio graph buys.
   */
  AudioManager.setAudioSessionOptions({ iosCategory: 'playback', iosMode: 'spokenAudio' });

  /**
   * Activating explicitly, and awaiting it, is what turns footgun 1 from silence
   * into a reported error: `activateSessionIfNeeded` runs `configureAudioSession`
   * first and `setAudioSessionActivity` rejects with the native error when that
   * fails. The node's own `start()` would activate the session too, but it
   * returns nothing and swallows the failure.
   */
  await AudioManager.setAudioSessionActivity(true);

  /**
   * Interruptions are deliberately **not** observed. When nothing is listening,
   * `SystemNotificationManager.handleInterruption` calls the engine's own
   * `onInterruptionEnd(shouldResume)`, so a phone call pauses the engine and the
   * book resumes by itself afterwards — which is what a reader wants. Observing
   * them from JavaScript moves that responsibility here and the library then
   * does nothing, and footgun 3 is explicit that a defensive `pause()` around a
   * silent stretch is what breaks resumption.
   */

  const sampleRate = first.audio === 'samples' ? first.sampleRate : AudioManager.getDevicePreferredSampleRate();
  const context = new AudioContext({ sampleRate });

  /**
   * Footgun 6, and the loudest one. `pitchCorrection` is opt-in **per node**:
   * `AudioBufferBaseSourceNode` stores `pitchCorrection_(options.pitchCorrection)`
   * and only then runs the WSOLA stretcher, whose own comment says "late init to
   * avoid unnecessary allocation when pitch correction is not used". Without this
   * flag `playbackRate` is a plain resampler, so at 1.5–3× the book is read in a
   * rising voice — no error, no API difference, and it sounds like a bad Provider
   * or a wrong sample rate rather than like a missing option.
   *
   * ADR 0009 requires the pitch-preserving stretch, and this is the whole of it:
   * `WsolaTimeStretcher` is native on both platforms and its `MAX_PLAYBACK_RATE`
   * is 4, so the app's range is in bounds (`rate.ts` clamps to the same number).
   */
  let node: AudioBufferQueueSourceNode = context.createBufferQueueSource({ pitchCorrection: true });
  let sourceGeneration = 0;
  let playbackRate = 1;
  node.connect(context.destination);

  /**
   * The same node, as the JSI object the wrapper holds, for the one call the
   * wrapper cannot make (see `resume`).
   *
   * `node` is `protected` on `AudioNode`, which is a TypeScript keyword and not
   * a runtime one, so this is a cast and not a trick — and it is written here,
   * once, rather than at the call site, so that there is one place to look when
   * `react-native-audio-api` is upgraded past the 0.13.5 this was read from.
   */
  const nativeNode = () => (node as unknown as { node: { start(when: number, offset: number): void } }).node;

  /**
   * Whether the engine should be running, and the one queue its changes go
   * through (#66).
   *
   * A real iPhone decides whether the lock screen shows the reading as playing
   * from whether the app is still sending audio out, not from what the Now
   * Playing module writes: with the engine left running after a pause, it went
   * on rendering silence and iOS 27.0 kept the card on Pause for as long as
   * the reading stayed paused, with a playback rate of 0 already published. So
   * the owner's pause stops the engine and Play starts it again.
   *
   * Queued because the library runs each `suspend()` and `resume()` on its own
   * thread pool (`PromiseVendor::createAsyncPromise`), so a pause and a Play
   * pressed back to back could land in either order and leave a playing reading
   * with a stopped engine. `closed` keeps a queued change from reaching a
   * context `dispose` has already closed, which would refuse it as an error.
   */
  let running = true;
  let driving: Promise<void> = Promise.resolve();
  let closed = false;
  function drive(next: boolean): void {
    if (running === next) return;
    running = next;
    driving = driving
      .then(() => {
        if (closed) return;
        return next ? context.resume() : context.suspend();
      })
      .catch(handlers.onError);
  }

  /**
   * THE CLOCK. The position comes from the **source node**, never from
   * `AudioContext.currentTime` — which counts rendered frames over the sample
   * rate, making it a wall clock that is *not* scaled by the playback rate, so
   * at 1.5–3× it reintroduces exactly the drift ADR 0012 exists to prevent. The
   * node's content position already advances at the playback rate.
   *
   * `context.currentTime` is read nowhere in this directory. The native
   * `PositionChangedDispatcher` does the throttling, counting rendered frames,
   * so the interval below is the cadence and there is no JavaScript throttle.
   */
  function observe(node: AudioBufferQueueSourceNode) {
    const generation = sourceGeneration;
    node.onPositionChangedInterval = POSITION_INTERVAL_MS;
    node.onPositionChanged = (event) => {
      if (generation !== sourceGeneration) return;
      try { handlers.onPosition(event.value); } catch (error) { handlers.onError(error); }
    };
    node.onBufferEnded = (event) => {
      if (generation !== sourceGeneration) return;
      try { handlers.onBufferEnded(event.bufferId); } catch (error) { handlers.onError(error); }
    };
  }
  observe(node);

  /** Footgun 2. See `AudioGraphHandlers.onOutputLost`. */
  const routeChange: AudioEventSubscription | undefined = AudioManager.addSystemEventListener('routeChange', (event) => {
    if (event.reason !== 'OldDeviceUnavailable') return;
    try {
      handlers.onOutputLost();
    } catch (error) {
      handlers.onError(error);
    }
  });

  /**
   * Nothing here calls the library's `PlaybackNotificationManager`, and it is not
   * imported. ADR 0016 gives the lock screen to our own native module; the
   * library touches `MediaPlayer` from exactly one file, instantiated lazily on
   * the first `show()`, so **as long as `show()` is never called the library
   * never claims the command centre** and there is no contest over either
   * singleton (footgun 4).
   */

  return {
    sampleRate: context.sampleRate,

    async prepare(clip) {
      const samples = await samplesOf(clip, context, context.sampleRate);
      return { clip, samples, duration: samples.length / context.sampleRate };
    },

    enqueue(audio, gapSeconds, from = 0, to = audio.duration) {
      // Named `hz` rather than `rate`, which in this directory means the playback
      // rate and is a different number entirely.
      const hz = context.sampleRate;
      // Native queue boundaries make a prepared voice handover independent of
      // JavaScript timer latency. Split only at reported word ends; never guess.
      const result: EnqueuedBuffer[] = [];
      for (const { start, end, final } of bufferParts(audio.samples.length, hz, audio.clip.words, from, to)) {
      const samples = audio.samples.slice(start, end);
      const gapFrames = final ? framesFor(gapSeconds, hz) : 0;
      const frames = Math.max(1, samples.length + gapFrames);

      // A Clip is split at reported word ends. Only its final piece has a gap;
      // all pieces share the same continuous pitch-corrected source.
      // `createBuffer` zeroes, so the gap needs nothing written into it.
      const buffer = context.createBuffer(1, frames, hz);
      // `samples` must cover its whole `ArrayBuffer` exactly. The native
      // `copyToChannel` takes the length from `arrayBuffer.size(runtime) /
      // sizeof(float)` — the buffer, not the view — so a subarray would copy
      // whatever follows it in memory. Every producer in `pcm.ts` and in
      // `samplesOf` allocates its own exact array, which is what the
      // `Float32Array<ArrayBuffer>` in their signatures is there to keep true.
      if (samples.length > 0) buffer.copyToChannel(samples, 0, 0);

      result.push({
        bufferId: node.enqueueBuffer(buffer),
        // Derived from the frames actually written, because that is what the
        // native side divides by the sample rate. A duration the timeline
        // believes and the node does not is drift by another name.
        speech: samples.length / hz,
        gap: gapFrames / hz,
        offset: start / hz,
        duration: audio.duration,
      });
      }
      return result;
    },

    remove(bufferIds) { for (const id of bufferIds) node.dequeueBuffer(id); },

    setRate(rate) {
      playbackRate = rate;
      node.playbackRate.value = rate;
    },

    resume() {
      // `AudioBufferQueueSourceNode.start` overrides the base class's
      // once-only guard and its default offset of -1 means "do not move the read
      // index", so this both starts and resumes. Native `start` sets the state to
      // SCHEDULED with `startTime_ = 0`, which the next render quantum turns
      // into PLAYING, so calling it while already playing is a no-op.
      //
      // It cannot be called through the wrapper, which is why this reaches past
      // it. The wrapper is, verbatim from
      // node_modules/react-native-audio-api/lib/module/core/AudioBufferQueueSourceNode.js
      // (0.13.5):
      //
      //   start(when = 0, offset = -1) {
      //     if (when < 0) throw new RangeError(...);
      //     if (offset && offset < 0) throw new RangeError(`offset must be a finite non-negative number: ${offset}`);
      //     this.node.start(when, offset);
      //   }
      //
      // — so its own default is the one value its own guard rejects, and
      // `node.start()` throws every time. It is reported (`onError`) rather than
      // silent, which is how the first device run found it: "offset must be a
      // finite non-negative number: -1" and not one Clip played.
      //
      // Every offset the guard admits is >= 0, and the native node reads those
      // as "move the read index there" — `AudioBufferQueueSourceNode::start`
      // returns early only when `offset < 0` and otherwise assigns
      // `vReadIndex_ = sampleRate * offset`. The engine calls `resume()` again on
      // every enqueue while playing, so an offset of 0 would restart the Clip
      // being spoken each time a new one arrived. There is no third value.
      //
      // The engine first, if a pause stopped it: once the driver has started,
      // the node's `start` no longer starts it (`AudioContext::start` returns
      // early), so without this Play after a pause would be silent.
      drive(true);
      nativeNode().start(0, KEEP_READ_INDEX);
    },

    pause() {
      // The library's own pause, which sets `isPaused_` so that `disable()` does
      // not clear the queue. This is the owner asking; footgun 3's prohibition is
      // on pausing *because the queue drained* — a drained queue renders silence,
      // stays in the playing state and resumes on the next buffer, and adding a
      // defensive stop is what breaks that resumption.
      node.pause();
      // And the engine, because the owner asking is also the one time footgun 3's
      // other half does not apply: a stopped engine lets iOS suspend the app,
      // which is the risk while a reading waits for its next Clip and the point
      // once the owner has stopped it. The lock screen goes to Play only when
      // the audio does (#66).
      drive(false);
    },

    clear() {
      // A seek has a new content origin. Scope callbacks as well as DSP state:
      // events already dispatched by the old source cannot move the new reading.
      sourceGeneration++;
      node.onPositionChanged = null;
      node.onBufferEnded = null;
      node.stop();
      node.disconnect(context.destination);
      node = context.createBufferQueueSource({ pitchCorrection: true });
      node.playbackRate.value = playbackRate;
      node.connect(context.destination);
      observe(node);
    },

    async dispose() {
      sourceGeneration++;
      closed = true;
      routeChange?.remove();
      node.onPositionChanged = null;
      node.onBufferEnded = null;
      try {
        node.stop();
        node.disconnect(context.destination);
        await context.close();
      } catch (error) {
        handlers.onError(error);
      }
      // `context.suspend()` is called by `pause()` alone — not here, not on going
      // to the background and not when the queue drains. A stopped engine under
      // an active playback session is what puts the app at risk of being
      // suspended by iOS (footgun 3). Teardown closes the context and hands the
      // session back, which is a different thing: it happens when the owner has
      // stopped reading.
      try {
        await AudioManager.setAudioSessionActivity(false);
      } catch (error) {
        handlers.onError(error);
      }
    },
  };
}

/** A Clip's samples at the context's rate: converted, decoded or synthesized as silence, whichever it needs. */
async function samplesOf(clip: PreparedClip, context: AudioContext, rate: number): Promise<Float32Array<ArrayBuffer>> {
  if (clip.audio === 'silence') return new Float32Array(framesFor(clip.seconds, rate));
  if (clip.audio === 'samples') return resampleLinear(clip.samples, clip.sampleRate, rate);

  /**
   * The decode path of ADR 0013, which is why `disableFFmpeg: false` is in
   * `app.config.ts`. `BaseAudioContext.decodeAudioData` takes a `number`
   * (a bundled asset), a `string` (a path or url) or an `ArrayBuffer` — not a
   * `Uint8Array`, and not a web-style `(bytes, success, error)` signature — and
   * it resamples to the context's rate on the way, which is exactly what the
   * clock needs.
   *
   * The bytes are copied when the view does not cover its whole buffer:
   * `decodeFromArrayBuffer` wraps the argument in `new Uint8Array(arrayBuffer)`,
   * which would otherwise read the rest of the provider layer's buffer as audio.
   */
  const bytes = clip.bytes;
  const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
  const decoded = await context.decodeAudioData(whole ? bytes.buffer : bytes.slice().buffer);
  const channel = decoded.getChannelData(0);
  // Already at the context's rate; the copy is because `getChannelData` hands
  // back a view into a native buffer whose lifetime is the decoded AudioBuffer's.
  const samples = new Float32Array(channel.length);
  samples.set(channel);
  return samples;
}
