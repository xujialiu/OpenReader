/**
 * Read-ahead: **three Utterances ahead, two fetches at a time** (ADR 0006).
 *
 * Zotero's engine slides a parallel three-Utterance window and runs two
 * concurrent fetches; ADR 0006 names those numbers as behaviour to learn rather
 * than code to copy, because `zotero/reader` is AGPLv3. This file is the whole
 * of the scheduling decision, written as one pure function so the numbers are
 * visible and the behaviour is testable without an audio device.
 *
 * Why three and why two, in this app's terms:
 *
 * - **Three** is what keeps the queue from draining. A drained queue is safe —
 *   it renders silence and resumes on the next buffer (notes/NOTES.md footgun 3)
 *   — but a reader hears the drain as a stall mid-sentence, and one Utterance of
 *   lead is not enough when a Provider takes a second or two to answer.
 * - **Two** is a cap on money and on the Provider's patience, not on CPU. Under
 *   ADR 0002 every request is the owner's own quota, and a burst of them is how a
 *   rate limit is hit; two also means the Utterance actually being read is never
 *   queued behind a pile of speculative ones.
 *
 * The window includes the Utterance at the cursor. On a fresh start or after a
 * seek, that one has not been fetched either, and it is the one playback is
 * waiting for.
 */

/** Utterances kept prepared beyond the one being read. */
export const READ_AHEAD_UTTERANCES = 3;

/** Synthesis requests allowed to be in flight at once. */
export const CONCURRENT_FETCHES = 2;

/**
 * What the scheduler knows about one Utterance.
 *
 * `failed` is not retried. The plugin's prefetch chain ends on a failure and
 * lets playback surface the error when it reaches that Utterance, and the reason
 * carries over: a Provider that refused once will refuse again, a retry loop in
 * the background spends the owner's quota out of sight of anything that could
 * show it, and philosophy rule 1 wants the failure reported rather than hidden
 * behind attempts. A retry is an explicit act — a seek back to that Utterance.
 */
export type UtteranceState = 'absent' | 'fetching' | 'ready' | 'failed';

export interface FetchWindowInput {
  /** The Utterance being read — the one whose Clip is playing, or the one playback is waiting for. */
  cursor: number;
  /** How many Utterances the document has. */
  total: number;
  /** Requests in flight right now, wherever they are. Counted rather than derived: a seek leaves fetches running outside the window, and they still cost the Provider. */
  inFlight: number;
  stateOf(index: number): UtteranceState;
  /** Overridable for a test; the defaults are the two numbers ADR 0006 names. */
  readAhead?: number;
  concurrency?: number;
}

/**
 * Which Utterances to start fetching now, in reading order.
 *
 * In reading order because that is the order they are needed and the order they
 * must be enqueued in; starting the further one first would leave the queue
 * holding a Clip it cannot play yet.
 *
 * Returns at most `concurrency - inFlight` indices, and never one that is
 * already ready, already fetching or already failed. An empty array is the
 * normal answer — most of the time everything in the window is in hand.
 */
export function fetchWindow(input: FetchWindowInput): number[] {
  const readAhead = input.readAhead ?? READ_AHEAD_UTTERANCES;
  const concurrency = input.concurrency ?? CONCURRENT_FETCHES;
  const slots = concurrency - input.inFlight;
  if (slots <= 0) return [];

  const from = Math.max(0, input.cursor);
  const to = Math.min(input.total - 1, from + readAhead);
  const start: number[] = [];
  for (let index = from; index <= to && start.length < slots; index++) {
    if (input.stateOf(index) === 'absent') start.push(index);
  }
  return start;
}

/**
 * The last Utterance the queue may hold a buffer for, given where the reading
 * is. The same bound as the fetch window, applied to enqueueing rather than
 * fetching.
 *
 * It matters on its own because a warm cache answers instantly: without this
 * bound, a document whose Clips are all cached would be decoded and enqueued in
 * one pass — the whole book in memory as float samples — the first time
 * anything asked for it.
 */
export function enqueueCeiling(cursor: number, readAhead: number = READ_AHEAD_UTTERANCES): number {
  return Math.max(0, cursor) + readAhead;
}
