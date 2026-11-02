import { defineAnimation, type Animation, type AnimationCallback } from 'react-native-reanimated';

/**
 * The phone's stacked search field moves on one spring, fitted from its frames
 * (iOS 27.0, notes 2026-11-02): natural frequency about 18.7 rad/s, damping
 * ratio about 0.8, so a small overshoot.
 */
const MASS = 1;
const STIFFNESS = 350;
const DAMPING = 30;
const OMEGA = Math.sqrt(STIFFNESS / MASS);
const DECAY = DAMPING / (2 * MASS);
const RINGING = Math.sqrt(OMEGA * OMEGA - DECAY * DECAY);
/** At rest: within 0.03 of 60 points of its target, and slower than 0.3 points a second. */
const REST = 5e-4;
const REST_SPEED = 5e-3;

/** One frame of a 60 Hz display: the most of the motion one UI frame may take. */
export const FRAME_MS = 1000 / 60;

/**
 * The time a frame moves the motion by: the time since the last frame, but never
 * more than one frame (#341). Taking the keyboard holds the UI thread for a few
 * hundred milliseconds; Reanimated's own springs take up to 64 ms of it in the
 * next frame, a jump of a third of the way. Here a hold only delays the motion.
 * A faster display's frames are shorter and pass through whole.
 */
function frameStep(elapsed: number) {
  'worklet';
  return Math.min(Math.max(elapsed, 0), FRAME_MS);
}

type HeldSpring = Animation<HeldSpring> & { current: number; toValue: number; velocity: number; lastTimestamp: number };

/**
 * A spring to `toValue` on the phone's fitted spring, one frame at a time. It
 * starts from the value where it is and, when it takes over a running motion of
 * its own kind, from that motion's speed, so a reversal turns back from where it
 * is. Reduce Motion changes nothing on the phone, so it changes nothing here.
 */
export function withHeldSpring(toValue: number, callback?: AnimationCallback): number {
  'worklet';
  return defineAnimation<HeldSpring>(toValue, () => {
    'worklet';
    const onFrame = (animation: HeldSpring, now: number) => {
      const seconds = frameStep(now - animation.lastTimestamp) / 1000;
      animation.lastTimestamp = now;
      // The damped spring's exact solution over the step, from where it is and how fast it moves.
      const offset = animation.current - animation.toValue;
      const sine = (animation.velocity + DECAY * offset) / RINGING;
      const fade = Math.exp(-DECAY * seconds);
      const cos = Math.cos(RINGING * seconds);
      const sin = Math.sin(RINGING * seconds);
      const next = fade * (offset * cos + sine * sin);
      const speed = fade * ((sine * RINGING - DECAY * offset) * cos - (offset * RINGING + DECAY * sine) * sin);
      if (Math.abs(next) < REST && Math.abs(speed) < REST_SPEED) {
        animation.current = animation.toValue;
        animation.velocity = 0;
        return true;
      }
      animation.current = animation.toValue + next;
      animation.velocity = speed;
      return false;
    };
    const onStart = (animation: HeldSpring, value: unknown, now: number, previous: unknown) => {
      animation.current = value as number;
      animation.lastTimestamp = now;
      const before = previous as Partial<HeldSpring> | null;
      animation.velocity = typeof before?.velocity === 'number' ? before.velocity : 0;
    };
    return { onFrame, onStart, toValue, current: toValue, velocity: 0, lastTimestamp: 0, callback, reduceMotion: false } as HeldSpring;
  }) as unknown as number;
}

type HeldDelay = Animation<HeldDelay> & { current: number; toValue: number; elapsed: number; lastTimestamp: number };

/**
 * `toValue` at once after `ms` of the motion's own time, counted as the springs
 * count it: a hold of the UI thread is one frame, so what waits on the motion
 * stays in step with it. Close appears this way, when the field has settled.
 */
export function withHeldDelay(ms: number, toValue: number): number {
  'worklet';
  return defineAnimation<HeldDelay>(toValue, () => {
    'worklet';
    const onFrame = (animation: HeldDelay, now: number) => {
      animation.elapsed += frameStep(now - animation.lastTimestamp);
      animation.lastTimestamp = now;
      // A thousandth of a millisecond's grace: 21 frames of a sixtieth of a second are 350 ms, not a hair less.
      if (animation.elapsed + 1e-3 < ms) return false;
      animation.current = animation.toValue;
      return true;
    };
    const onStart = (animation: HeldDelay, value: unknown, now: number) => {
      animation.current = value as number;
      animation.elapsed = 0;
      animation.lastTimestamp = now;
    };
    return { onFrame, onStart, toValue, current: toValue, elapsed: 0, lastTimestamp: 0, reduceMotion: false } as HeldDelay;
  }) as unknown as number;
}

