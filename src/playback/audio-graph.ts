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

export interface AudioGraphHandlers {
  /** The source node's content position, straight from `onPositionChanged`. The only clock this app has. */
  onPosition(position: number): void;
  /** A buffer has been fully consumed. Fires at the boundary, which is why the Clip cue is sent from here rather than from the position stream. */
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
}

export interface AudioGraph {
  /** The context's sample rate. Every buffer enqueued is at this rate; see `enqueue`. */
  readonly sampleRate: number;
  enqueue(clip: PreparedClip, gapSeconds: number): Promise<EnqueuedBuffer>;
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
  const node: AudioBufferQueueSourceNode = context.createBufferQueueSource({ pitchCorrection: true });
  node.connect(context.destination);

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
  node.onPositionChangedInterval = POSITION_INTERVAL_MS;
  node.onPositionChanged = (event) => {
    try {
      handlers.onPosition(event.value);
    } catch (error) {
      handlers.onError(error);
    }
  };

  node.onBufferEnded = (event) => {
    try {
      handlers.onBufferEnded(event.bufferId);
    } catch (error) {
      handlers.onError(error);
    }
  };

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

    async enqueue(clip, gapSeconds) {
      // Named `hz` rather than `rate`, which in this directory means the playback
      // rate and is a different number entirely.
      const hz = context.sampleRate;
      const samples = await samplesOf(clip, context, hz);
      const gapFrames = framesFor(gapSeconds, hz);
      const frames = Math.max(1, samples.length + gapFrames);

      // One buffer per Utterance: the speech, then the gap as silence. The gap is
      // part of the content, so the time-stretch shrinks it with the speech and
      // the position keeps advancing across it instead of stalling (gap.ts).
      // `createBuffer` zeroes, so the gap needs nothing written into it.
      const buffer = context.createBuffer(1, frames, hz);
      // `samples` must cover its whole `ArrayBuffer` exactly. The native
      // `copyToChannel` takes the length from `arrayBuffer.size(runtime) /
      // sizeof(float)` — the buffer, not the view — so a subarray would copy
      // whatever follows it in memory. Every producer in `pcm.ts` and in
      // `samplesOf` allocates its own exact array, which is what the
      // `Float32Array<ArrayBuffer>` in their signatures is there to keep true.
      if (samples.length > 0) buffer.copyToChannel(samples, 0, 0);

      return {
        bufferId: node.enqueueBuffer(buffer),
        // Derived from the frames actually written, because that is what the
        // native side divides by the sample rate. A duration the timeline
        // believes and the node does not is drift by another name.
        speech: samples.length / hz,
        gap: gapFrames / hz,
      };
    },

    setRate(rate) {
      node.playbackRate.value = rate;
    },

    resume() {
      // `AudioBufferQueueSourceNode.start` overrides the base class's
      // once-only guard and its default offset of -1 means "do not move the read
      // index", so this both starts and resumes. Native `start` sets the state to
      // SCHEDULED with `startTime_ = 0`, which the next render quantum turns
      // into PLAYING, so calling it while already playing is a no-op.
      node.start();
    },

    pause() {
      // The library's own pause, which sets `isPaused_` so that `disable()` does
      // not clear the queue. This is the owner asking; footgun 3's prohibition is
      // on pausing *because the queue drained* — a drained queue renders silence,
      // stays in the playing state and resumes on the next buffer, and adding a
      // defensive stop is what breaks that resumption.
      node.pause();
    },

    clear() {
      node.clearBuffers();
    },

    async dispose() {
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
      // `context.suspend()` is never called — not here and not on going to the
      // background. A stopped engine under an active playback session is what
      // puts the app at risk of being suspended by iOS (footgun 3). Teardown
      // closes the context and hands the session back, which is a different
      // thing: it happens when the owner has stopped reading.
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
