import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';

/** Hold cadence, not step size, accelerates. Ordinary presses commit on release,
 * so a gesture cancelled before the hold threshold changes nothing. */
export function useStepRepeat<T extends number>(value: T, step: (value: T, direction: 1 | -1) => T | null,
  onStep: (next: T) => void, repeat: boolean, active: boolean) {
  const latest = useRef({ value, step, onStep, active });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeated = useRef(false);
  const stop = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useLayoutEffect(() => {
    latest.current = { value, step, onStep, active };
    if (!active) stop();
  }, [value, step, onStep, active, stop]);
  useEffect(() => {
    if (!repeat) return;
    const subscription = AppState.addEventListener('change', (state) => { if (state !== 'active') stop(); });
    return () => { stop(); subscription.remove(); };
  }, [repeat, stop]);

  return (direction: 1 | -1) => ({
    onPressIn: repeat ? () => {
      stop();
      repeated.current = false;
      const began = Date.now();
      const tick = () => {
        timer.current = null;
        const now = latest.current;
        if (!now.active) return;
        const next = now.step(now.value, direction);
        if (next === null) return;
        repeated.current = true;
        now.onStep(next);
        if (now.step(next, direction) !== null) timer.current = setTimeout(tick, Date.now() - began < 1200 ? 200 : 75);
      };
      if (latest.current.active) timer.current = setTimeout(tick, 400);
    } : undefined,
    onPressOut: repeat ? stop : undefined,
    onPress: () => {
      const now = latest.current;
      if (!now.active || (repeat && repeated.current)) return;
      const next = now.step(now.value, direction);
      if (next !== null) now.onStep(next);
    },
  });
}
