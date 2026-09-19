import { describe, expect, it } from 'vitest';

import {
  CONCURRENT_FETCHES,
  enqueueCeiling,
  fetchWindow,
  READ_AHEAD_UTTERANCES,
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
    expect(fetchWindow({ cursor: 0, total: 100, inFlight: 0, stateOf: nothing() })).toEqual([0, 1]);
  });

  it('never starts more than the concurrency allows', () => {
    expect(fetchWindow({ cursor: 0, total: 100, inFlight: 1, stateOf: nothing() })).toEqual([0]);
    expect(fetchWindow({ cursor: 0, total: 100, inFlight: 2, stateOf: nothing() })).toEqual([]);
  });

  it('counts fetches in flight wherever they are, because a seek leaves some outside the window', () => {
    // They still cost the Provider, so they still count against the two.
    expect(fetchWindow({ cursor: 50, total: 100, inFlight: 2, stateOf: nothing() })).toEqual([]);
  });

  it('reaches exactly three Utterances past the cursor and no further', () => {
    const window = fetchWindow({ cursor: 10, total: 100, inFlight: 0, stateOf: nothing(), concurrency: 99 });
    expect(window).toEqual([10, 11, 12, 13]);
  });

  it('returns them in reading order, which is the order they must be enqueued in', () => {
    const window = fetchWindow({
      cursor: 4,
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
    const window = fetchWindow({ cursor: 0, total: 100, inFlight: 0, stateOf: states({ 0: 'failed' }) });
    expect(window).toEqual([1, 2]);
  });

  it('stops at the end of the document', () => {
    expect(fetchWindow({ cursor: 8, total: 10, inFlight: 0, stateOf: nothing(), concurrency: 99 })).toEqual([8, 9]);
    expect(fetchWindow({ cursor: 9, total: 10, inFlight: 0, stateOf: nothing(), concurrency: 99 })).toEqual([9]);
  });

  it('has nothing to do for an empty document', () => {
    expect(fetchWindow({ cursor: 0, total: 0, inFlight: 0, stateOf: nothing() })).toEqual([]);
  });

  it('treats a negative cursor as the start rather than reading backwards', () => {
    expect(fetchWindow({ cursor: -5, total: 10, inFlight: 0, stateOf: nothing() })).toEqual([0, 1]);
  });

  it('has nothing to do when the whole window is prepared', () => {
    const stateOf = states({ 0: 'ready', 1: 'ready', 2: 'ready', 3: 'ready' });
    expect(fetchWindow({ cursor: 0, total: 100, inFlight: 0, stateOf })).toEqual([]);
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
    const window = fetchWindow({ cursor: 0, total: 5000, inFlight: 0, stateOf: nothing(), concurrency: 5000 });
    expect(Math.max(...window)).toBe(enqueueCeiling(0));
  });
});
