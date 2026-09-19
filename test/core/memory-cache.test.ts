import { describe, expect, it } from 'vitest';
import { createMemoryCache } from '../../src/core/memory-cache';
import type { Timestamp } from '../../src/core/providers/types';

/** A clip of `s.length` bytes. The budget counts bytes, so the text is only a label. */
const clip = (s: string) => new TextEncoder().encode(s);

/**
 * What a provider will hand back once the layer of ADR 0013 arrives: bytes plus
 * whatever word timings came with them. The cache only ever reads `audio`.
 */
type Clip = { audio: Uint8Array; timestamps?: Timestamp[] };

describe('createMemoryCache', () => {
  it('returns null for a key it has never seen', async () => {
    const c = createMemoryCache<Clip>({ maxBytes: 1000 });
    expect(await c.match('nope')).toBeNull();
  });

  it('returns exactly what was put, including timestamps', async () => {
    const c = createMemoryCache<Clip>({ maxBytes: 1000 });
    const value = { audio: clip('abc'), timestamps: [{ start: 0, end: 1, charStart: 0, charEnd: 3 }] };
    await c.put('k', value);
    const hit = await c.match('k');
    expect(hit).not.toBeNull();
    expect(hit!.audio).toBe(value.audio);
    expect(hit!.timestamps).toBe(value.timestamps);
  });

  it('evicts the least recently used entry once the byte budget is exceeded', async () => {
    const c = createMemoryCache<Clip>({ maxBytes: 10 });
    await c.put('a', { audio: clip('1234') }); // 4
    await c.put('b', { audio: clip('1234') }); // 8
    await c.put('c', { audio: clip('1234') }); // 12 -> evict a
    expect(await c.match('a')).toBeNull();
    expect(await c.match('b')).not.toBeNull();
    expect(await c.match('c')).not.toBeNull();
  });

  it('a match refreshes recency, so the touched entry survives eviction', async () => {
    const c = createMemoryCache<Clip>({ maxBytes: 10 });
    await c.put('a', { audio: clip('1234') });
    await c.put('b', { audio: clip('1234') });
    await c.match('a'); // a is now most recent
    await c.put('c', { audio: clip('1234') }); // evict b, not a
    expect(await c.match('a')).not.toBeNull();
    expect(await c.match('b')).toBeNull();
  });

  it('never stores an entry larger than the whole budget', async () => {
    const c = createMemoryCache<Clip>({ maxBytes: 5 });
    await c.put('big', { audio: clip('123456') });
    expect(await c.match('big')).toBeNull();
  });

  it('replacing a key does not double-count its bytes', async () => {
    const c = createMemoryCache<Clip>({ maxBytes: 8 });
    await c.put('a', { audio: clip('1234') });
    await c.put('a', { audio: clip('1234') }); // same key, 4 bytes total, not 8
    await c.put('b', { audio: clip('1234') }); // 8 -> fits without evicting a
    expect(await c.match('a')).not.toBeNull();
    expect(await c.match('b')).not.toBeNull();
  });

  it('clear() empties it', async () => {
    const c = createMemoryCache<Clip>({ maxBytes: 100 });
    await c.put('a', { audio: clip('x') });
    c.clear();
    expect(await c.match('a')).toBeNull();
  });

  // The plugin measured a clip's size with Blob.size. A Uint8Array has no
  // .size, so a budget read off the wrong property would be undefined and the
  // cache would grow without bound.
  it('measures the budget in bytes, not in characters', async () => {
    const c = createMemoryCache<Clip>({ maxBytes: 8 });
    // Two characters, six bytes: the four-byte entry after it no longer fits.
    await c.put('a', { audio: clip('你好') });
    await c.put('b', { audio: clip('1234') });
    expect(await c.match('a')).toBeNull();
  });
});
