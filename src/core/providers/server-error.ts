import { SynthesisError } from './errors';
import { throwIfAborted } from './response';

/**
 * A 5xx is the server's passing failure (#237, ADR 0084). Every Provider asks
 * the same synthesis again after one, in a Reading and in a Download alike,
 * up to SERVER_ERROR_TRIES in all, and reports the last 5xx as it is when none
 * passed. That last one is not retriable, so a Download's own bounded retry
 * (`src/offline/scheduler.ts`) never asks a fourth time.
 */
export const SERVER_ERROR_TRIES = 3;
/** The pause before the first retry; the second waits twice as long: 500 ms, then 1 s. */
export const SERVER_ERROR_DELAY_MS = 500;

/** The pause before retry `retry`, counted from 1. */
export const serverErrorPause = (retry: number): number => SERVER_ERROR_DELAY_MS * retry;

/** Whether one more try is allowed after `retries` retries already made. */
export const mayRetryServerError = (status: number, retries: number): boolean =>
  status >= 500 && retries < SERVER_ERROR_TRIES - 1;

/**
 * What the clip's note says of the retries made, with a leading space so it
 * follows whatever note the clip already has: ` after a retry of HTTP 502`,
 * ` after 2 retries of HTTP 502, 503`, or nothing when there was none. The
 * Debug Log does not print a clip's note; it shows each try as its own
 * request line (ADR 0084).
 */
export function serverErrorNote(statuses: readonly number[]): string {
  if (!statuses.length) return '';
  if (statuses.length === 1) return ` after a retry of HTTP ${statuses[0]}`;
  return ` after ${statuses.length} retries of HTTP ${statuses.join(', ')}`;
}

/**
 * A refusal whose status was a 5xx: a SynthesisError of kind `unknown`, as
 * before, which also carries the status so that `askThroughServerErrors` can
 * tell it from a refusal that will not pass.
 */
export class ServerError extends SynthesisError {
  readonly status: number;

  constructor(status: number, message: string) {
    super('unknown', message);
    this.status = status;
  }
}

/**
 * Runs `once` and, while it rejects with a ServerError, again, as
 * SERVER_ERROR_TRIES allows, after serverErrorPause. For a Provider whose one
 * synthesis is a sequence of requests (Kokoro's captioned route and its
 * fallback, the speech route's PCM and MP3), a try is that whole sequence. An
 * aborted request stops after the pause, before asking again; a Reading's
 * pause or skip aborts nothing (ADR 0026), only the synthesis deadline does.
 */
export async function askThroughServerErrors<T extends { note?: string }>(
  once: () => Promise<T>,
  deps: { pause: (ms: number) => Promise<void>; signal?: AbortSignal; what: string },
): Promise<T> {
  const statuses: number[] = [];
  for (;;) {
    try {
      const result = await once();
      const after = serverErrorNote(statuses);
      return after ? { ...result, note: `${result.note ?? ''}${after}`.trim() } : result;
    } catch (error) {
      if (!(error instanceof ServerError) || !mayRetryServerError(error.status, statuses.length)) throw error;
      statuses.push(error.status);
      await deps.pause(serverErrorPause(statuses.length));
      throwIfAborted(deps.signal, deps.what);
    }
  }
}
