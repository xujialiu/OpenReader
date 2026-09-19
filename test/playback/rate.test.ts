import { describe, expect, it } from 'vitest';

import {
  atTheEar,
  clampRate,
  contentSeconds,
  heardSeconds,
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  NATURAL_PACE,
  scaleTimings,
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
