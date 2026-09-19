/**
 * The playback rate, and everything that has to be scaled by it.
 *
 * Speed is applied here and nowhere else (ADR 0009). A Provider is never asked
 * to speak faster — `SynthesisOptions` has no speed parameter — so every Clip
 * arrives at Natural Pace and the owner's 1.5–3× is a pitch-preserving
 * time-stretch on the source node. The cache key is provider, voice and text
 * and deliberately not speed, which is the decisive reason: put speed in the
 * key and nudging 1.5× to 1.6× throws away every Clip the owner has paid for.
 *
 * Everything in this file exists because of one sentence in ADR 0005: "provider
 * timings are reported at 1.0× and must be scaled by the playback rate", which
 * it also calls the single easiest way to reintroduce drift. So the arithmetic
 * lives in exactly one place, it is pure, and it is tested.
 *
 * Two units appear throughout this directory and mixing them is the bug this
 * naming exists to prevent:
 *
 * - **content seconds** — position inside the synthesized audio, as the
 *   Provider produced it at 1.0×. The source node's own position is in these,
 *   because it counts the content it has read.
 * - **heard seconds** — wall time as the owner experiences it. `content / rate`.
 *   Word Timings pushed to the renderer are in these, because the renderer
 *   interpolates against `requestAnimationFrame`, which is wall time.
 */

import type { Timestamp } from '../core/providers/types';

/**
 * The native ceiling, not a product decision: `WsolaTimeStretcher::MAX_PLAYBACK_RATE`
 * is 4 and the audio thread clamps to it (`std::clamp(..., -MAX_PLAYBACK_RATE,
 * MAX_PLAYBACK_RATE)` in `AudioBufferBaseSourceNode::processWithPitchCorrection`).
 *
 * Clamping here as well is load-bearing rather than tidy. If a rate above 4
 * reached `scaleTimings` the audio would play at 4× while the timings were
 * divided by the larger number, and the highlight would drift — by a constantly
 * growing amount, which is exactly the defect this directory exists to prevent.
 * One clamp, applied before either the node or the timings see the number.
 */
export const MAX_PLAYBACK_RATE = 4;

/**
 * Below this, `heardSeconds` divides by something small enough to turn a
 * rounding error into a visible offset, and nothing in the app asks for it: the
 * app's range is 1.5–3× and the slowest a reader plausibly wants is half speed.
 */
export const MIN_PLAYBACK_RATE = 0.25;

/** 1.0× is Natural Pace — what a Clip is synthesized at, and what its Word Timings are reported against. */
export const NATURAL_PACE = 1;

/** A rate the node and the timings can both be given. Anything that is not a finite number reads as Natural Pace rather than as an error, because a missing setting must not stop the reading. */
export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return NATURAL_PACE;
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, rate));
}

/** Content seconds as they will be heard at `rate`. A 3-second Clip lasts 1.5 seconds at 2×. */
export function heardSeconds(content: number, rate: number): number {
  return content / clampRate(rate);
}

/** The inverse: heard seconds as content seconds. Used where a duration is known in wall time — a gap the owner set in milliseconds — and has to become samples. */
export function contentSeconds(heard: number, rate: number): number {
  return heard * clampRate(rate);
}

/**
 * Word Timings as they will be heard: `start` and `end` divided by the playback
 * rate, `charStart` and `charEnd` untouched because characters do not move.
 *
 * Returns `null` where the Provider reported nothing — including an empty array,
 * which says the same thing — so the caller has one value to test for and the
 * renderer highlights the whole Utterance instead (ADR 0005, philosophy rule 1).
 * Nothing here estimates or interpolates a missing timing.
 */
export function scaleTimings(timings: readonly Timestamp[] | null | undefined, rate: number): Timestamp[] | null {
  if (!timings || timings.length === 0) return null;
  const factor = clampRate(rate);
  return timings.map((t) => ({ start: t.start / factor, end: t.end / factor, charStart: t.charStart, charEnd: t.charEnd }));
}

/**
 * Where the ear is, given where the graph says it is.
 *
 * The source node reports the position of the content it is *rendering*; the
 * sound reaches the ear later. ADR 0012 names two contributions and neither is
 * reachable from JavaScript on this library:
 *
 * - the WSOLA stretcher holds 20 ms of input and 10 ms of output
 *   (`WsolaTimeStretcher::INPUT_LATENCY_MS`, `OUTPUT_LATENCY_MS`). The node's
 *   `getLatency()` reports `output + input × rate`, which matches neither
 *   derivation of the two units — the input term is content time and the output
 *   term is wall time — so it is deliberately not used;
 * - the output device's own latency, 150–200 ms over Bluetooth or AirPlay,
 *   which this library does not expose at all (`AVAudioSession.outputLatency`
 *   is not bridged).
 *
 * Both are **constant offsets, not drift**, and that distinction is the whole
 * of ADR 0012: a constant lead is one number, measured once and subtracted; an
 * accumulating error is not correctable at all. So there is one number, it is a
 * parameter, and it defaults to zero until the 60–90 minute device session of
 * notes/NOTES.md item 4 measures it.
 */
export function atTheEar(heard: number, latencySeconds: number): number {
  return Math.max(0, heard - Math.max(0, latencySeconds));
}
