import { describe, expect, it } from 'vitest';

import {
  atTheEar,
  clampRate,
  contentSeconds,
  heardSeconds,
  MAX_PLAYBACK_RATE,
  MAX_STEPPER_RATE,
  MIN_PLAYBACK_RATE,
  MIN_STEPPER_RATE,
  NATURAL_PACE,
  RATE_STEP,
  scaleTimings,
  snapRate,
  stepRate,
} from '../../src/playback/rate';
import type { Timestamp } from '../../src/core/providers/types';

/**
 * ADR 0005: "provider timings are reported at 1.0× and must be scaled by the
 * playback rate", and it calls forgetting that the single easiest way to
 * reintroduce drift. These are the tests for the one place that arithmetic
 * lives.
 */

const words: Timestamp[] = [
  { start: 0, end: 0.5, charStart: 0, charEnd: 5 },
  { start: 0.5, end: 1.5, charStart: 6, charEnd: 11 },
];

describe('clampRate', () => {
  it('holds the native ceiling, because the audio thread clamps to the same number', () => {
    // WsolaTimeStretcher::MAX_PLAYBACK_RATE is 4. A rate above it would play at
    // 4× while the timings were divided by the larger number — drift, growing.
    expect(MAX_PLAYBACK_RATE).toBe(4);
    expect(clampRate(9)).toBe(4);
  });

  it('holds a floor', () => {
    expect(clampRate(0)).toBe(MIN_PLAYBACK_RATE);
    expect(clampRate(-3)).toBe(MIN_PLAYBACK_RATE);
  });

  it('reads a missing or broken setting as Natural Pace rather than as an error', () => {
    // A setting that failed to load must not stop the reading.
    expect(clampRate(Number.NaN)).toBe(NATURAL_PACE);
    expect(clampRate(Number.POSITIVE_INFINITY)).toBe(NATURAL_PACE);
  });

  it('passes the app’s own range through untouched', () => {
    expect(clampRate(1.5)).toBe(1.5);
    expect(clampRate(3)).toBe(3);
  });
});

describe('heardSeconds and contentSeconds', () => {
  it('halves content at 2× and doubles it back', () => {
    expect(heardSeconds(3, 2)).toBe(1.5);
    expect(contentSeconds(1.5, 2)).toBe(3);
  });

  it('clamps the rate it divides by, so the two units cannot disagree with the audio', () => {
    // The node plays at 4 and so must the arithmetic.
    expect(heardSeconds(8, 100)).toBe(heardSeconds(8, MAX_PLAYBACK_RATE));
  });
});

describe('scaleTimings', () => {
  it('divides the times by the rate and leaves the character offsets alone', () => {
    const scaled = scaleTimings(words, 2);
    expect(scaled).toEqual([
      { start: 0, end: 0.25, charStart: 0, charEnd: 5 },
      { start: 0.25, end: 0.75, charStart: 6, charEnd: 11 },
    ]);
  });

  it('is the identity at Natural Pace', () => {
    expect(scaleTimings(words, NATURAL_PACE)).toEqual(words);
  });

  it('copies rather than scaling in place, so a Clip can be re-cued after a rate change', () => {
    const first = scaleTimings(words, 2)!;
    const second = scaleTimings(words, 3)!;
    expect(words[1]!.start).toBe(0.5);
    expect(first[1]!.start).toBe(0.25);
    expect(second[1]!.start).toBeCloseTo(0.5 / 3, 12);
  });

  it('answers null where a Provider reported no Word Timings', () => {
    // ADR 0005: no timings means the Utterance is highlighted whole. Nothing is
    // estimated or interpolated to fill the gap.
    expect(scaleTimings(undefined, 2)).toBeNull();
    expect(scaleTimings(null, 2)).toBeNull();
  });

  it('treats an empty array as no timings, because it says the same thing', () => {
    expect(scaleTimings([], 2)).toBeNull();
  });

  /**
   * Two numbers out of the first real Word Timings this file has ever been run
   * against (notes/NOTES_2026-09-19.md, 23:24). Both are in the tests because
   * both are things a later reader would otherwise "fix".
   */
  it('passes a negative start through rather than moving it to zero, because the number is the Provider’s', () => {
    // Kokoro-FastAPI, af_bella, "The room was quiet, …": the first word starts at
    // −0.006792 s. Philosophy rule 1 forbids estimating a timing and nudging one
    // to 0 is a small estimate; a word already under way when a Clip starts is
    // highlighted from the start, which needs no help here.
    const real: Timestamp[] = [{ start: -0.006791666666666696, end: 0.068, charStart: 0, charEnd: 3 }];
    expect(scaleTimings(real, 2)![0]!.start).toBeCloseTo(-0.003395833333333348, 15);
  });

  it('divides a timing by the same clamped rate heardSeconds divides a duration by', () => {
    // Which is why one measurement settles every rate: Kokoro's last word ends
    // 0.1562 s past the end of its own audio, and that overshoot is 0.1041 s at
    // 1.50× and 0.0521 s at 3.00× — the sign cannot change with the rate, only
    // the magnitude. Measured: 70,511 frames at 24 kHz = 2.93796 s of audio for
    // "She read the letter twice before folding it away.", whose last word ends
    // at 3.0942 s.
    const speech = 70511 / 24000;
    const overshoot = 3.0942 - speech;
    const last: Timestamp[] = [{ start: 2.157, end: 3.0942, charStart: 44, charEnd: 48 }];
    // 9 is above the ceiling both sides clamp to, so a clamp missing from either
    // one shows up as the two disagreeing.
    for (const rate of [1, 1.5, 3, 9]) {
      const over = scaleTimings(last, rate)![0]!.end - heardSeconds(speech, rate);
      expect(over).toBeGreaterThan(0);
      expect(over * clampRate(rate)).toBeCloseTo(overshoot, 12);
    }
  });
});

/**
 * The stepper of ADR 0020: 0.50 to 4.00 in steps of 0.05, held to repeat. The
 * repeat is the caller's timer; what is tested here is that seventy presses
 * produce seventy numbers a decimal literal could have written, because the
 * alternative is `1.7500000000000002` reaching `scaleTimings`.
 */
describe('the rate stepper', () => {
  /** Every rate the stepper can reach, walked the way a held button walks it. */
  const offered = (): number[] => {
    const out = [MIN_STEPPER_RATE];
    for (let at = MIN_STEPPER_RATE; at !== MAX_STEPPER_RATE; ) {
      const next = stepRate(at, 1);
      expect(next).toBeGreaterThan(at);
      out.push(next);
      at = next;
    }
    return out;
  };

  it('is the range ADR 0020 names, and the ceiling is the engine’s own number', () => {
    expect(MIN_STEPPER_RATE).toBe(0.5);
    expect(MAX_STEPPER_RATE).toBe(4);
    expect(MAX_STEPPER_RATE).toBe(MAX_PLAYBACK_RATE);
    expect(RATE_STEP).toBe(0.05);
  });

  it('reaches 4.00 in exactly seventy presses and stops there', () => {
    const walk = offered();
    expect(walk).toHaveLength(71);
    expect(walk[70]).toBe(4);
    expect(stepRate(4, 1)).toBe(4);
    expect(stepRate(MIN_STEPPER_RATE, -1)).toBe(0.5);
  });

  it('never produces a number a two-decimal literal could not write', () => {
    // The assertion that fails on floating-point accumulation:
    // Number((1.7500000000000002).toFixed(2)) is 1.75 and 1.75 !== 1.7500000000000002.
    for (const rate of offered()) {
      expect(Number(rate.toFixed(2))).toBe(rate);
    }
  });

  it('is the same grid walked from either end', () => {
    // A held button down from 4.00 must retrace the values a held button up from
    // 0.50 produced, or the displayed speed depends on which way the owner came.
    const up = offered();
    const down: number[] = [MAX_STEPPER_RATE];
    for (let at = MAX_STEPPER_RATE; at !== MIN_STEPPER_RATE; ) {
      at = stepRate(at, -1);
      down.push(at);
    }
    expect(down.reverse()).toEqual(up);
  });

  it('holds the app’s familiar speeds exactly, so a synced setting is not nudged', () => {
    // The desktop plugin's own list, which is what the Sync Folder can hand over.
    for (const rate of [1, 1.5, 2, 2.5, 3]) {
      expect(snapRate(rate)).toBe(rate);
      expect(stepRate(rate, 0)).toBe(rate);
    }
    expect(stepRate(1.7, 1)).toBe(1.75);
    expect(stepRate(1.75, -1)).toBe(1.7);
  });

  it('puts a rate from somewhere else on the grid before stepping it', () => {
    // 1.23 is not offered; one press must move one step from the nearest offered
    // value rather than correcting by 0.02 and calling that a press.
    expect(snapRate(1.23)).toBe(1.25);
    expect(stepRate(1.23, 1)).toBe(1.3);
  });

  it('cannot produce a rate the engine would then clamp, which would show one speed and play another', () => {
    for (const rate of offered()) {
      expect(clampRate(rate)).toBe(rate);
    }
    expect(snapRate(9)).toBe(MAX_STEPPER_RATE);
    expect(snapRate(0.1)).toBe(MIN_STEPPER_RATE);
  });

  it('coalesces a burst of presses into one call', () => {
    expect(stepRate(1, 4)).toBe(1.2);
    expect(stepRate(1.2, -4)).toBe(1);
    expect(stepRate(1, 1000)).toBe(MAX_STEPPER_RATE);
  });

  it('reads a broken setting as Natural Pace rather than as an error, the way clampRate does', () => {
    expect(snapRate(Number.NaN)).toBe(NATURAL_PACE);
    expect(stepRate(Number.NaN, 1)).toBe(1.05);
    expect(stepRate(1, Number.NaN)).toBe(1);
  });
});

describe('atTheEar', () => {
  it('takes the output latency off the position the highlight follows', () => {
    expect(atTheEar(1, 0.2)).toBeCloseTo(0.8, 12);
  });

  it('never reports a negative position at the start of a Clip', () => {
    expect(atTheEar(0.05, 0.2)).toBe(0);
  });

  it('is the identity on the speaker, where there is nothing to subtract', () => {
    expect(atTheEar(1.25, 0)).toBe(1.25);
  });

  it('ignores a nonsensical latency rather than adding it', () => {
    expect(atTheEar(1, -5)).toBe(1);
  });
});
