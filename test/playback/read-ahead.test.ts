import { describe, expect, it } from 'vitest';

import {
  CONCURRENT_FETCHES,
  enqueueCeiling,
  fetchWindow,
  hasRunOut,
  READ_AHEAD_UTTERANCES,
  retryOnPlay,
  type UtteranceState,
} from '../../src/playback/read-ahead';

/**
 * ADR 0006 names the two numbers: three Utterances of read-ahead, two concurrent
 * fetches. They are the behaviour borrowed from Zotero's engine — which is
 * AGPLv3, so the behaviour was learned and this was written fresh — and they are
 * the reason a reader does not hear the queue drain mid-sentence and the owner
 * is not billed for a burst of speculative requests.
 */

/** A document where nothing has been fetched yet. */
const nothing = (): ((index: number) => UtteranceState) => () => 'absent';

/** A document with a state per index, defaulting to absent. */
const states = (map: Record<number, UtteranceState>) => (index: number) => map[index] ?? 'absent';

describe('the numbers ADR 0006 names', () => {
  it('is three ahead and two at a time', () => {
    expect(READ_AHEAD_UTTERANCES).toBe(3);
    expect(CONCURRENT_FETCHES).toBe(2);
  });
});

describe('fetchWindow', () => {
  it('starts with the Utterance at the cursor, which on a fresh start is the one playback waits for', () => {
    expect(fetchWindow({ cursor: 0, nextToEnqueue: 0, total: 100, inFlight: 0, stateOf: nothing() })).toEqual([0, 1]);
  });

  it('never starts more than the concurrency allows', () => {
    expect(fetchWindow({ cursor: 0, nextToEnqueue: 0, total: 100, inFlight: 1, stateOf: nothing() })).toEqual([0]);
    expect(fetchWindow({ cursor: 0, nextToEnqueue: 0, total: 100, inFlight: 2, stateOf: nothing() })).toEqual([]);
  });

  it('counts fetches in flight wherever they are, because a seek leaves some outside the window', () => {
    // They still cost the Provider, so they still count against the two.
    expect(fetchWindow({ cursor: 50, nextToEnqueue: 50, total: 100, inFlight: 2, stateOf: nothing() })).toEqual([]);
  });

  it('reaches exactly three Utterances past the cursor and no further', () => {
    const window = fetchWindow({ cursor: 10, nextToEnqueue: 10, total: 100, inFlight: 0, stateOf: nothing(), concurrency: 99 });
    expect(window).toEqual([10, 11, 12, 13]);
  });

  it('returns them in reading order, which is the order they must be enqueued in', () => {
    const window = fetchWindow({
      cursor: 4,
      nextToEnqueue: 4,
      total: 100,
      inFlight: 0,
      stateOf: states({ 4: 'ready', 5: 'ready' }),
      concurrency: 99,
    });
    expect(window).toEqual([6, 7]);
  });

  it('skips what is already in hand or already running', () => {
    const window = fetchWindow({
      cursor: 0,
      nextToEnqueue: 0,
      total: 100,
      inFlight: 1,
      stateOf: states({ 0: 'ready', 1: 'fetching' }),
    });
    expect(window).toEqual([2]);
  });

  it('does not retry an Utterance whose synthesis failed', () => {
    // The plugin's prefetch chain ends on a failure for the same reason: a
    // background retry loop spends the owner's quota out of sight of anything
    // that could show it, and philosophy rule 1 wants the failure reported.
    const window = fetchWindow({ cursor: 0, nextToEnqueue: 0, total: 100, inFlight: 0, stateOf: states({ 0: 'failed' }) });
    expect(window).toEqual([1, 2]);
  });

  it('stops at the end of the document', () => {
    expect(fetchWindow({ cursor: 8, nextToEnqueue: 8, total: 10, inFlight: 0, stateOf: nothing(), concurrency: 99 })).toEqual([8, 9]);
    expect(fetchWindow({ cursor: 9, nextToEnqueue: 9, total: 10, inFlight: 0, stateOf: nothing(), concurrency: 99 })).toEqual([9]);
  });

  it('has nothing to do for an empty document', () => {
    expect(fetchWindow({ cursor: 0, nextToEnqueue: 0, total: 0, inFlight: 0, stateOf: nothing() })).toEqual([]);
  });

  it('treats a negative cursor as the start rather than reading backwards', () => {
    expect(fetchWindow({ cursor: -5, nextToEnqueue: -5, total: 10, inFlight: 0, stateOf: nothing() })).toEqual([0, 1]);
  });

  it('has nothing to do when the whole window is prepared', () => {
    const stateOf = states({ 0: 'ready', 1: 'ready', 2: 'ready', 3: 'ready' });
    expect(fetchWindow({ cursor: 0, nextToEnqueue: 0, total: 100, inFlight: 0, stateOf })).toEqual([]);
  });
});

/**
 * What a press of Play does to the Utterances whose synthesis was refused (#45).
 *
 * Measured on 2026-09-23 (notes/NOTES_2026-09-23.md, 13:30): 279, 280 and 281
 * were refused at once, the reading stopped at 279, and Play asked again for 279
 * alone — so the reading stopped again at 280, with no request sent for it and
 * the old error still on the screen. One press is one explicit act, and it asks
 * again for all of them.
 */
describe('retryOnPlay', () => {
  it('asks again for every refused Utterance when the reading stopped on one of them', () => {
    const retry = retryOnPlay({ cursor: 279, nextToEnqueue: 279, failed: new Set([279, 280, 281]) });
    expect([...retry.failed]).toEqual([]);
    expect(retry.nextToEnqueue).toBe(279);
    // The window then reaches every one of them in turn, two at a time.
    const stateOf = (index: number): UtteranceState => (retry.failed.has(index) ? 'failed' : 'absent');
    expect(fetchWindow({ cursor: 279, nextToEnqueue: 279, total: 400, inFlight: 0, stateOf })).toEqual([279, 280]);
  });

  it('leaves the queue where it was when only later Utterances were refused, so nothing already queued is queued twice', () => {
    // A pause at 277 with 277 and 278 on the queue and 279 refused ahead of them.
    const retry = retryOnPlay({ cursor: 277, nextToEnqueue: 279, failed: new Set([279, 280]) });
    expect([...retry.failed]).toEqual([]);
    expect(retry.nextToEnqueue).toBe(279);
  });

  it('changes nothing when nothing was refused', () => {
    const retry = retryOnPlay({ cursor: 12, nextToEnqueue: 15, failed: new Set() });
    expect([...retry.failed]).toEqual([]);
    expect(retry.nextToEnqueue).toBe(15);
  });

  it('does not change the set it was given', () => {
    const failed = new Set([3, 4]);
    retryOnPlay({ cursor: 3, nextToEnqueue: 3, failed });
    expect([...failed]).toEqual([3, 4]);
  });
});

/**
 * The window starts at the first sentence not yet on the queue (#49).
 *
 * `drain` takes a Clip out of the prepared set as it queues it, so a queued
 * Utterance reports `absent` again. A window starting at the cursor asked for it
 * a second time: measured on 2026-09-23 with the real engine, a fake audio graph
 * and a counting cache, ten sentences cost twenty cache lookups, and each second
 * copy was kept until the next seek.
 */
describe('fetchWindow, from the first sentence not yet queued (#49)', () => {
  it('never asks again for a sentence already on the queue', () => {
    // Reading 10, with 10 and 11 queued: both report absent, and neither is asked for.
    expect(fetchWindow({ cursor: 10, nextToEnqueue: 12, total: 100, inFlight: 0, stateOf: nothing() })).toEqual([12, 13]);
  });

  it('asks for the cursor’s own sentence while nothing is queued: a fresh start, a seek', () => {
    expect(fetchWindow({ cursor: 10, nextToEnqueue: 10, total: 100, inFlight: 0, stateOf: nothing() })).toEqual([10, 11]);
  });

  it('asks again for the cursor’s sentence when a retry has moved the queue back to it', () => {
    const retry = retryOnPlay({ cursor: 279, nextToEnqueue: 281, failed: new Set([279]) });
    expect(retry.nextToEnqueue).toBe(279);
    expect(fetchWindow({ cursor: 279, nextToEnqueue: retry.nextToEnqueue, total: 400, inFlight: 0, stateOf: nothing() })).toEqual([279, 280]);
  });

  it('still reaches three past the cursor, and no further, however far the queue has got', () => {
    const window = (nextToEnqueue: number) =>
      fetchWindow({ cursor: 10, nextToEnqueue, total: 100, inFlight: 0, stateOf: nothing(), concurrency: 99 });
    expect(window(11)).toEqual([11, 12, 13]);
    expect(window(13)).toEqual([13]);
    // The queue already holds everything up to the ceiling: nothing to ask for.
    expect(window(14)).toEqual([]);
  });
});

describe('enqueueCeiling', () => {
  it('bounds enqueueing by the same window as fetching', () => {
    expect(enqueueCeiling(0)).toBe(3);
    expect(enqueueCeiling(41)).toBe(44);
  });

  it('matters on its own, because a warm cache answers instantly', () => {
    // Without the bound, a document whose Clips were all cached would be decoded
    // and enqueued in one pass: the whole book in memory as float samples.
    const window = fetchWindow({ cursor: 0, nextToEnqueue: 0, total: 5000, inFlight: 0, stateOf: nothing(), concurrency: 5000 });
    expect(Math.max(...window)).toBe(enqueueCeiling(0));
  });
});

/**
 * Running out of text, told apart from waiting for some.
 *
 * Inside the engine the two are indistinguishable — footgun 3: a drained buffer
 * queue renders silence and stays in the playing state either way. One ends by
 * itself and the other never does, and on 2026-09-20 at 04:43 the second was
 * six minutes of silence with the app still reporting `playing`.
 */
describe('hasRunOut', () => {
  /** Everything spoken, the queue consumed, nothing outstanding, still playing. */
  const exhausted = { playing: true, nextToEnqueue: 108, total: 108, queued: 0, fetching: 0 };

  it('is the state the 04:43 reading sat in', () => {
    expect(hasRunOut(exhausted)).toBe(true);
  });

  it('is not a pause, which empties nothing and means nothing', () => {
    expect(hasRunOut({ ...exhausted, playing: false })).toBe(false);
  });

  it('is not a queue that has simply not caught up', () => {
    expect(hasRunOut({ ...exhausted, nextToEnqueue: 107 })).toBe(false);
  });

  it('is not a sentence still waiting to be heard', () => {
    expect(hasRunOut({ ...exhausted, queued: 1 })).toBe(false);
  });

  it('is not a Provider being slow, which is a stall that ends by itself', () => {
    expect(hasRunOut({ ...exhausted, fetching: 1 })).toBe(false);
  });

  it('is true again after the list grew and was spoken through', () => {
    // What `extend` arms: more text, read to the end of *that*, and it is the
    // same state again rather than a thing that can only be said once.
    expect(hasRunOut({ ...exhausted, nextToEnqueue: 130, total: 130 })).toBe(true);
  });
});
