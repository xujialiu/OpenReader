/**
 * The **Sleep Timer**'s state (CONTEXT.md, #326, design and ADR 0088): what
 * the owner chose, how much of a length is left, and what the Reading is asked
 * for because of it.
 *
 * Held by the reader's view, which lives exactly as long as the Reading: it
 * goes on while the Reading plays behind the Library (ADR 0049) and ends with
 * it, and nothing of it is written anywhere.
 *
 * A length counts only while the Reading plays (owner's Q7): `since` is when
 * the present stretch of playing began, and `left` what was left then. When it
 * runs out, the Reading is asked to stop after the sentence being spoken
 * (owner's Q8), and the button reads `0:00` until it has. The chapter is asked
 * for at once, and asked again when the Contents arrive or change. The request
 * is one value derived from the state, handed to `stopAt` by one effect.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ContentsRow } from '../core/document/contents';
import type { SleepChoice } from './sleep-timer';
import type { StopRequest } from './use-reading';

/** What the Player draws the button from. */
export interface SleepTimerState {
  /** The choice in force, or null while the Sleep Timer is off. */
  choice: SleepChoice | null;
  /** For a length: what was left, in milliseconds, at `since`, or now while not counting. */
  left: number;
  /** For a length: when the present stretch of playing began, or null while it is not counting. */
  since: number | null;
  /** The length has run out, and the Reading is finishing its sentence. */
  expired: boolean;
}

export interface SleepTimer extends SleepTimerState {
  /** A choice from the menu, or null for `Turn Off Timer`. A length chosen again starts again. */
  choose(choice: SleepChoice | null): void;
  /** The Reading has paused at the line (`useReading`'s `onSlept`): the Sleep Timer is done. */
  slept(): void;
}

const OFF: SleepTimerState = { choice: null, left: 0, since: null, expired: false };

/** What is left of a length at `now`. */
export function leftAt(state: SleepTimerState, now: number): number {
  return state.since === null ? state.left : Math.max(0, state.left - (now - state.since));
}

/**
 * The state once the Reading has started or stopped playing at `now`: a
 * length starts or stops counting, and a stop once it has run out is the end
 * of the Sleep Timer, the Reading having stopped as the owner asked. The same
 * object when nothing changes.
 */
export function playingChanged(state: SleepTimerState, playing: boolean, now: number): SleepTimerState {
  if (!playing && state.expired) return OFF;
  if (typeof state.choice !== 'number' || state.expired) return state;
  if (playing && state.since === null) return { ...state, since: now };
  if (!playing && state.since !== null) return { ...state, left: leftAt(state, now), since: null };
  return state;
}

/**
 * @param playing whether the Reading plays, waiting for a sentence included.
 * @param rows the Document's Contents rows, which the chapter is measured against.
 * @param stopAt the Reading's `stopAt`.
 */
export function useSleepTimer(playing: boolean, rows: readonly ContentsRow[], stopAt: (request: StopRequest) => void): SleepTimer {
  const [state, setState] = useState<SleepTimerState>(OFF);

  // Counting starts and stops with the Reading. Only here is the moment it
  // changed known: the Reading's playing arrives as a prop, and the time it
  // changed is the time this runs.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((was) => playingChanged(was, playing, Date.now()));
  }, [playing]);

  useEffect(() => {
    if (state.since === null || state.expired) return undefined;
    const timer = setTimeout(() => {
      setState((was) => (was === state ? { ...was, left: 0, since: null, expired: true } : was));
    }, leftAt(state, Date.now()));
    return () => clearTimeout(timer);
  }, [state]);

  const request = useMemo<StopRequest>(
    () => (state.choice === 'chapter' ? { kind: 'chapter', rows } : state.expired ? { kind: 'sentence' } : null),
    [state.choice, state.expired, rows],
  );
  useEffect(() => { stopAt(request); }, [request, stopAt]);

  const choose = useCallback((choice: SleepChoice | null) => {
    if (choice === null || choice === 'chapter') {
      setState(choice === null ? OFF : { ...OFF, choice });
      return;
    }
    setState({ choice, left: choice * 60_000, since: playing ? Date.now() : null, expired: false });
  }, [playing]);
  const slept = useCallback(() => setState(OFF), []);

  return { ...state, choose, slept };
}
