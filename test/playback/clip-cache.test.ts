import { describe, expect, it } from 'vitest';

import { createMemoryCache } from '../../src/core/memory-cache';
import type { SynthesisResult } from '../../src/core/providers/types';
import { clipCacheKey, toStored, type StoredClip } from '../../src/playback/clip-cache';

/**
 * ADR 0009's decisive reason for applying speed at playback: "the cache key is
 * the provider, the voice and the text — and **not** the speed". Put speed in
 * the key and nudging 1.5× to 1.6× discards every Clip the owner has paid for,
 * which under ADR 0002 is their own money.
 */

const pcm = (bytes: number[]): SynthesisResult => ({
  audio: 'pcm',
  samples: new Uint8Array(bytes),
  sampleRate: 24_000,
});

describe('clipCacheKey', () => {
  it('is the same key whatever the reading speed is, because speed is not a parameter', () => {
    // The strongest form of this test is the signature: there is no speed to
    // pass. What is asserted is that nothing else varies either.
    const first = clipCacheKey('speechify', 'ava', 'Call me Ishmael.');
    const second = clipCacheKey('speechify', 'ava', 'Call me Ishmael.');
    expect(second).toBe(first);
    expect(clipCacheKey.length).toBe(3);
  });

  it('separates the provider, the voice and the text', () => {
    const base = clipCacheKey('openai-official', 'nova', 'Hello.');
    expect(clipCacheKey('compatible', 'nova', 'Hello.')).not.toBe(base);
    expect(clipCacheKey('openai-official', 'alloy', 'Hello.')).not.toBe(base);
    expect(clipCacheKey('openai-official', 'nova', 'Hello!')).not.toBe(base);
  });

  it('cannot be made to collide by writing the delimiter into a voice id', () => {
    // Which is the reason for JSON rather than a joined string: no delimiter has
    // to be chosen, so none can be smuggled in.
    expect(clipCacheKey('local', 'a', 'b:c')).not.toBe(clipCacheKey('local', 'a:b', 'c'));
    expect(clipCacheKey('local', 'a', '","')).not.toBe(clipCacheKey('local', 'a","', ''));
  });

  it('distinguishes leading and trailing whitespace, which is why an Utterance arrives trimmed', () => {
    expect(clipCacheKey('local', 'a', 'Hello. ')).not.toBe(clipCacheKey('local', 'a', 'Hello.'));
  });
});

describe('toStored', () => {
  it('finds the bytes in the pcm arm', () => {
    const clip = pcm([1, 2, 3, 4]);
    const stored = toStored(clip);
    expect(stored.audio.byteLength).toBe(4);
    expect(stored.clip).toBe(clip);
  });

  it('finds the bytes in the encoded arm, which names them differently (ADR 0013)', () => {
    const clip: SynthesisResult = { audio: 'encoded', bytes: new Uint8Array(9), mediaType: 'audio/mpeg' };
    expect(toStored(clip).audio.byteLength).toBe(9);
  });

  it('points at the same bytes rather than copying them, so caching costs nothing', () => {
    const clip = pcm([1, 2]);
    expect(toStored(clip).audio).toBe(clip.audio === 'pcm' ? clip.samples : null);
  });

  it('is measurable by the byte budget core/memory-cache keeps', async () => {
    const cache = createMemoryCache<StoredClip>({ maxBytes: 6 });
    await cache.put('a', toStored(pcm([1, 2, 3, 4])));
    await cache.put('b', toStored(pcm([5, 6, 7, 8])));
    // The first is evicted to make room, which only works because `audio` is
    // where the cache looks.
    expect(await cache.match('a')).toBeNull();
    expect(await cache.match('b')).not.toBeNull();
  });

  it('hands back the whole reply, timings included', async () => {
    const cache = createMemoryCache<StoredClip>({ maxBytes: 1000 });
    const clip: SynthesisResult = {
      audio: 'pcm',
      samples: new Uint8Array(4),
      sampleRate: 24_000,
      timestamps: [{ start: 0, end: 1, charStart: 0, charEnd: 5 }],
    };
    await cache.put('k', toStored(clip));
    const hit = await cache.match('k');
    expect(hit?.clip.timestamps).toEqual(clip.timestamps);
  });
});
