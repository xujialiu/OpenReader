/**
 * The playback rate, and everything that has to be scaled by it.
 *
 * Speed is applied here and nowhere else (ADR 0009). A Provider is never asked
 * to speak faster — `SynthesisOptions` has no speed parameter — so every Clip
 * arrives at Natural Pace and the owner's speed, which the stepper below
 * exposes as 0.50 to 4.00 (ADR 0020), is a pitch-preserving
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
 * rounding error into a visible offset.
 *
 * It is the floor on what the engine will accept, not on what is offered: the
 * stepper stops at `MIN_STEPPER_RATE`, which is half speed, because that is the
 * slowest a reader plausibly wants. The two differ on purpose — a setting
 * restored from a file, or synced from the desktop plugin, is clamped by this
 * and not by what a button can reach.
 */
export const MIN_PLAYBACK_RATE = 0.25;

/** 1.0× is Natural Pace — what a Clip is synthesized at, and what its Word Timings are reported against. */
export const NATURAL_PACE = 1;

/** A rate the node and the timings can both be given. Anything that is not a finite number reads as Natural Pace rather than as an error, because a missing setting must not stop the reading. */
export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return NATURAL_PACE;
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, rate));
}

/**
 * The stepper's grid, in **hundredths of a rate**, which is the whole of how
 * floating point is kept out of it.
 *
 * 0.05 is not representable in binary, so walking the range by repeated addition
 * accumulates: `1.7 + 0.05` is `1.7500000000000002`, and from there every value
 * is a number no decimal literal denotes — displayed as `1.7500000000000002×`,
 * unequal to the `1.75` a settings file holds, and multiplied into every Word
 * Timing by `scaleTimings`. So the position on the grid is an integer, arithmetic
 * happens on the integer, and the rate is one division at the end. `n / 100` is a
 * single correctly-rounded operation on two exactly-representable integers, so it
 * yields the identical double to writing the two-decimal literal — 0.05 is still
 * not representable, but no value the stepper produces is ever the sum of two of
 * them.
 *
 * The ceiling is `MAX_PLAYBACK_RATE` rather than a copy of 4: ADR 0020 is
 * explicit that the stepper does not invent a narrower product limit, "because a
 * second limit that disagrees with `rate.ts` is a second thing to keep true". It
 * is rounded *down* onto the grid so that every reachable value is on it and none
 * is above the native ceiling.
 */
const PER_RATE = 100;
const STEP = 5;
const FLOOR = 50;
const CEILING = Math.floor((MAX_PLAYBACK_RATE * PER_RATE) / STEP) * STEP;

/** 0.05, the step ADR 0020 settles on: fine enough that holding the button is a slider and coarse enough that one press is audible. */
export const RATE_STEP = STEP / PER_RATE;

/** Half speed. A product floor, above `MIN_PLAYBACK_RATE` on purpose — see there. */
export const MIN_STEPPER_RATE = FLOOR / PER_RATE;

/** 4.00 — the native time-stretcher's own ceiling, not a second opinion about it. */
export const MAX_STEPPER_RATE = CEILING / PER_RATE;

/** Where a rate sits on the grid: the nearest step, inside the offered range, with a broken setting reading as Natural Pace the way `clampRate` does. */
function stepsOf(rate: number): number {
  const from = Number.isFinite(rate) ? rate : NATURAL_PACE;
  const grid = Math.round((from * PER_RATE) / STEP) * STEP;
  return Math.min(CEILING, Math.max(FLOOR, grid));
}

/**
 * The nearest offered rate to `rate`.
 *
 * A rate arriving from anywhere else — a settings file, the desktop plugin's own
 * `[1, 1.5, 2, 2.5, 3]`, a value stepped by an older build — is put on the grid
 * before it is stepped, so that one press moves by exactly one step instead of
 * first correcting by 0.02 and then moving.
 */
export function snapRate(rate: number): number {
  return stepsOf(rate) / PER_RATE;
}

/**
 * `steps` steps from `rate`, clamped to the offered range.
 *
 * ±1 is one press; the holding-to-repeat of ADR 0020 is the caller's timer, and a
 * caller that coalesces a burst of presses passes the count. At either end this
 * returns that end rather than nothing, which is what lets a held button settle
 * rather than needing to know when to stop.
 *
 * Every value it can return satisfies `clampRate(v) === v`: the offered range is
 * inside the engine's, so the number the owner is shown is the number the node
 * and the Word Timings are both given. A stepper that could exceed the clamp
 * would show one speed and play another, which is drift with a straight face.
 */
export function stepRate(rate: number, steps: number): number {
  const by = Number.isFinite(steps) ? Math.trunc(steps) : 0;
  return Math.min(CEILING, Math.max(FLOOR, stepsOf(rate) + by * STEP)) / PER_RATE;
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
