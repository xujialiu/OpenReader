import { describe, expect, it, vi } from 'vitest';

// The animation objects are driven by hand here, frame by frame, as the UI thread would.
vi.mock('react-native-reanimated', () => ({ defineAnimation: (_to: number, factory: () => unknown) => factory() }));
const { FRAME_MS, withHeldDelay, withHeldSpring } = await import('../../src/app/held-spring');

type Driven = {
  current: number; velocity: number; reduceMotion?: boolean; callback?: (finished?: boolean) => void;
  onStart(animation: Driven, value: number, now: number, previous: Driven | null): void;
  onFrame(animation: Driven, now: number): boolean;
};
const start = (animation: unknown, from: number, now = 1000, previous: Driven | null = null) => {
  const driven = animation as Driven;
  driven.onStart(driven, from, now, previous);
  return driven;
};
/** Runs frames at the given gaps and returns the value after each. */
const frames = (animation: Driven, gaps: number[], now = 1000) => gaps.map((gap) => {
  now += gap;
  animation.onFrame(animation, now);
  return animation.current;
});

describe('a spring that a held UI thread delays rather than skips (#341)', () => {
  it('moves one frame\'s worth after a hold, where a 64 ms step jumped about a third of the way', () => {
    const held = frames(start(withHeldSpring(1), 0), [300, FRAME_MS]);
    const plain = frames(start(withHeldSpring(1), 0), [FRAME_MS, FRAME_MS]);
    expect(held[0]).toBeCloseTo(plain[0], 10);
    expect(held[1]).toBeCloseTo(plain[1], 10);
    // A spring from rest: a few hundredths after one frame, a little over a tenth after two.
    expect(plain[0]).toBeGreaterThan(0.02);
    expect(plain[0]).toBeLessThan(0.1);
    expect(plain[1]).toBeLessThan(0.25);
  });
  it('keeps every frame of a faster display, so a 120 Hz phone is not slowed', () => {
    const fast = frames(start(withHeldSpring(1), 0), [FRAME_MS / 2, FRAME_MS / 2]);
    const slow = frames(start(withHeldSpring(1), 0), [FRAME_MS]);
    expect(fast[1]).toBeCloseTo(slow[0], 10);
  });
  it('is the phone\'s fitted spring: mass 1, stiffness 350, damping 30, with its small overshoot, at rest in about half a second', () => {
    const spring = start(withHeldSpring(1), 0);
    const values = frames(spring, Array.from({ length: 60 }, () => FRAME_MS));
    const half = values.findIndex((value) => value >= 0.5);
    const ninety = values.findIndex((value) => value >= 0.9);
    // The phone's: 50% at about 84 ms and 90% at about 168 ms of motion (notes 2026-11-02).
    expect((half + 1) * FRAME_MS).toBeGreaterThan(70);
    expect((half + 1) * FRAME_MS).toBeLessThan(100);
    expect((ninety + 1) * FRAME_MS).toBeGreaterThan(150);
    expect((ninety + 1) * FRAME_MS).toBeLessThan(190);
    const peak = Math.max(...values);
    expect(peak).toBeGreaterThan(1.01);
    expect(peak).toBeLessThan(1.02);
    const rest = values.findIndex((value, index) => index > ninety && value === 1);
    expect(rest).toBeGreaterThan(0);
    expect((rest + 1) * FRAME_MS).toBeLessThan(700);
    expect(spring.onFrame(spring, 1000 + 61 * FRAME_MS)).toBe(true);
    expect(spring.velocity).toBe(0);
  });
  it('turns back from where it is, keeping the speed of the motion it takes over', () => {
    const opening = start(withHeldSpring(1), 0);
    frames(opening, [FRAME_MS, FRAME_MS, FRAME_MS]);
    const back = start(withHeldSpring(0), opening.current, 1000, opening);
    expect(back.current).toBe(opening.current);
    expect(back.velocity).toBe(opening.velocity);
    expect(back.velocity).toBeGreaterThan(0);
  });
  it('ignores Reduce Motion, as the phone does', () => {
    expect((withHeldSpring(1) as unknown as Driven).reduceMotion).toBe(false);
    expect((withHeldDelay(350, 1) as unknown as Driven).reduceMotion).toBe(false);
  });
  it('hands its callback the end of the motion', () => {
    const done = vi.fn();
    expect((withHeldSpring(0, done) as unknown as Driven).callback).toBe(done);
  });
});

describe('a step after so much of the motion, timed on the motion\'s own clock (#341)', () => {
  it('arrives after 350 ms of frames, where a hold counts as one frame', () => {
    const close = start(withHeldDelay(350, 1), 0);
    const wall = frames(close, [300, ...Array.from({ length: 20 }, () => FRAME_MS)]);
    // 300 ms of wall time held the thread: it counts one frame, so Close comes 21 frames in, at the 21st.
    expect(wall.slice(0, 20).every((value) => value === 0)).toBe(true);
    expect(wall[20]).toBe(1);
  });
});
