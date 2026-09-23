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
 * The window starts at the first Utterance not yet on the queue and reaches three
 * past the cursor. On a fresh start or after a seek that is the cursor itself,
 * which has not been fetched either and is the one playback is waiting for. Once
 * a Clip is queued it is never asked for again: `drain` takes it out of the
 * prepared set as it queues it, so it reports `absent`, and a window starting at
 * the cursor fetched every sentence a second time and kept the copy (#49).
 *
 * A refused Utterance stays refused until the owner asks for it again, and what
 * a press of Play asks for is decided here too (`retryOnPlay`): every refusal,
 * not only the one the reading stopped on (#45).
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
 * behind attempts. A retry is an explicit act: a press of Play, which asks again
 * for every refused Utterance (`retryOnPlay`, #45), or a seek back to one.
 */
export type UtteranceState = 'absent' | 'fetching' | 'ready' | 'failed';

export interface FetchWindowInput {
  /** The Utterance being read — the one whose Clip is playing, or the one playback is waiting for. */
  cursor: number;
  /** The next Utterance the queue would take. Everything before it is on the queue already, where `stateOf` cannot see it. */
  nextToEnqueue: number;
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
 * already queued, ready, fetching or failed. An empty array is the normal
 * answer — most of the time everything in the window is in hand.
 */
export function fetchWindow(input: FetchWindowInput): number[] {
  const readAhead = input.readAhead ?? READ_AHEAD_UTTERANCES;
  const concurrency = input.concurrency ?? CONCURRENT_FETCHES;
  const slots = concurrency - input.inFlight;
  if (slots <= 0) return [];

  const from = Math.max(0, input.cursor, input.nextToEnqueue);
  const to = Math.min(input.total - 1, Math.max(0, input.cursor) + readAhead);
  const start: number[] = [];
  for (let index = from; index <= to && start.length < slots; index++) {
    if (input.stateOf(index) === 'absent') start.push(index);
  }
  return start;
}

/** What the engine knows about its refusals at the moment Play is pressed. */
export interface RetryInput {
  /** The Utterance being read, which is the refused one when the reading stopped on a refusal. */
  cursor: number;
  /** The next Utterance the queue would take. */
  nextToEnqueue: number;
  /** The Utterances whose synthesis was refused, or whose Clip would not decode. */
  failed: ReadonlySet<number>;
}

/** Where the engine stands once the press has been taken as a retry. */
export interface Retry {
  /** Empty: every refusal is asked for again as the window reaches it. */
  failed: ReadonlySet<number>;
  nextToEnqueue: number;
}

/**
 * A press of Play, as a retry of **every** Utterance that was refused (#45).
 *
 * The read-ahead asks for two sentences at a time, so a network failure refuses
 * more than one of them. Retrying only the one the reading stopped on played it
 * and stopped again at the next, which nobody had asked for again, still showing
 * the error from before the press: measured on 2026-09-23, 279, 280 and 281 were
 * refused together, Play asked again for 279 alone, and the reading stopped at
 * 280 with no request sent for it (notes/NOTES_2026-09-23.md, 13:30). The press
 * is one explicit act, and it asks again for all of them; nothing is asked again
 * without one.
 *
 * `nextToEnqueue` moves back to the cursor only when the cursor's own Utterance
 * is one of them. `drain` never steps over a refusal, so otherwise the cursor's
 * Clip is on the queue already, and moving back would queue it a second time.
 */
export function retryOnPlay(input: RetryInput): Retry {
  return {
    failed: new Set<number>(),
    nextToEnqueue: input.failed.has(input.cursor) ? input.cursor : input.nextToEnqueue,
  };
}

/** What the engine knows about itself when it asks whether there is anything left to play. */
export interface RunOutInput {
  /** Whether the reading is running. A paused engine with an empty queue is a pause, which is not news. */
  playing: boolean;
  /** The next Utterance the queue would take. Equal to `total` once every one of them is on it. */
  nextToEnqueue: number;
  /** How many Utterances the engine holds. */
  total: number;
  /** Buffers enqueued and not yet consumed. */
  queued: number;
  /** Synthesis requests in flight. */
  fetching: number;
}

/**
 * Whether the reading has run out of text, as opposed to waiting for some.
 *
 * The distinction is the whole of this function and it is not obvious from
 * inside the engine, because **the two look identical there**: a drained buffer
 * queue renders silence and stays in the playing state either way
 * (notes/NOTES.md footgun 3). One of them fixes itself a second later and the
 * other never does, and telling the owner the wrong one is either a sentence
 * that flashes up at every slow Provider response or six minutes of silence with
 * nothing said (notes/NOTES_2026-09-20.md, 04:43).
 *
 * All four conditions, and each rules out an ordinary moment:
 *
 * - **Playing.** A pause empties nothing but means nothing either.
 * - **Everything enqueued.** Short of that the queue simply has not caught up.
 * - **The queue consumed.** A buffer still on it is a sentence still to be heard.
 * - **Nothing in flight.** A fetch outstanding is a Provider being slow, which is
 *   a stall the reader hears and which ends by itself.
 *
 * **There is deliberately no fifth condition about the failed set** (ADR 0023). A
 * Clip that was refused used to leave `inFlight` while `nextToEnqueue` stepped over
 * it, so all four of the above held — a Provider that dropped the last clips of a
 * document ran out of text exactly the way a finished book does, and the owner was
 * told "the reading has stopped at the end of the book" with two thousand chapters
 * still ahead (notes/NOTES_2026-09-20.md, 07:48). Making the failures a fifth
 * condition would say nothing at all instead, which is the six minutes of silence
 * this function was written to end. So the reading **has** run out, and what it is
 * told to say gains a third sentence: `outOfTextSentence` in `src/app/segment.ts`
 * takes the count of Utterances that were never spoken and names the refusal.
 * Since ADR 0027 `drain` stops the reading on a refusal instead, and since #49
 * nothing refused lies behind `nextToEnqueue`, so that sentence is kept as a guard.
 */
export function hasRunOut(input: RunOutInput): boolean {
  if (!input.playing) return false;
  if (input.nextToEnqueue < input.total) return false;
  if (input.queued > 0) return false;
  return input.fetching === 0;
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
