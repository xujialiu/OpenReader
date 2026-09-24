/**
 * One run at a time, and at most one waiting behind it — the scheduling both
 * WebDAV transports of ADR 0003 share, the one that carries reading positions
 * and the one that carries shared settings. A poke while a run is in flight
 * does not start a second one: it is folded into a single trailing run that
 * starts when the current one ends, carrying the last trigger's name and the
 * strongest `force` asked for meanwhile. So a burst of documents opening costs
 * one round trip plus one, never one per document, and nothing ever blocks the
 * caller: `poke` returns at once, `flush` resolves when its run has ended.
 *
 * **`flush` resolves with what its own run returned**, carried on that run's
 * promise and never read from anything shared (#54). The trailing run starts
 * inside the finished run's cleanup, before the awaiting caller resumes, so an
 * answer kept beside the runs has already been replaced by the time it is read:
 * Play waiting on a sync was told "sync is off" by a trailing run that had only
 * just started, and skipped the place its own run had adopted (measured
 * 2026-09-24). A flush that joins the trailing run is answered by that run.
 */

export interface SingleFlight<T> {
  /** Schedule a run; never blocks, a burst coalesces into the running one plus one trailing run. */
  poke(trigger: string): void;
  /**
   * One awaited, forced run — the shutdown's final push; it runs even inside a
   * failure window. Resolves with what that run returned: its own, or the
   * trailing run's when one was already in flight.
   */
  flush(trigger: string): Promise<T>;
  running(): boolean;
}

/** `run` must never reject; what it reports is its own business (the stats and the gated error report). */
export function createSingleFlight<T>(run: (trigger: string, force: boolean) => Promise<T>): SingleFlight<T> {
  let inFlight: Promise<T> | null = null;
  let trailing: {
    trigger: string;
    force: boolean;
    promise: Promise<T>;
    resolve: (answer: T) => void;
    reject: (problem: unknown) => void;
  } | null = null;

  function request(trigger: string, force: boolean): Promise<T> {
    if (inFlight) {
      if (trailing) {
        trailing.trigger = trigger;
        trailing.force = trailing.force || force;
      } else {
        let resolve!: (answer: T) => void;
        let reject!: (problem: unknown) => void;
        const promise = new Promise<T>((yes, no) => {
          resolve = yes;
          reject = no;
        });
        trailing = { trigger, force, promise, resolve, reject };
      }
      return trailing.promise;
    }
    inFlight = run(trigger, force).finally(() => {
      inFlight = null;
      if (trailing) {
        const next = trailing;
        trailing = null;
        void request(next.trigger, next.force).then(next.resolve, next.reject);
      }
    });
    return inFlight;
  }

  return {
    poke: (trigger) => {
      void request(trigger, false);
    },
    flush: (trigger) => request(trigger, true),
    running: () => inFlight !== null,
  };
}
