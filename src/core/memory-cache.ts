/**
 * An in-process audio cache: a byte-bounded LRU map.
 *
 * Memory only, and there is deliberately no disk cache (ADR 0002). What a cache
 * is for here is not keeping clips between sessions but never paying twice
 * inside one — philosophy rule 4, "never re-spends it for audio it already
 * had". The key is the provider, the voice and the text, and deliberately not
 * the speed (ADR 0009, ADR 0010): put speed in the key and nudging 1.5× to 1.6×
 * discards every clip the owner has already paid for.
 *
 * Pure JS, no globals. It holds bytes and knows nothing about how they were
 * fetched or how they will be played, which is what lets it run under Node with
 * the rest of `core/`.
 */

/**
 * What the cache itself needs of a clip: its bytes, so the budget can be
 * measured. A provider's result carries more — the sample rate, the word
 * timings (ADR 0013) — and the cache hands back whatever it was given,
 * untouched.
 */
export type CachedClip = { audio: Uint8Array };

/**
 * The contract a cache answers. In the plugin this interface lived in the layer
 * *above* `core/` and `memory-cache.ts` imported it upward; here dependencies
 * point inwards, so it lives with its only implementation.
 *
 * Generic in the clip rather than tied to `SynthesisResult`. The cache never
 * looks past the bytes, and `SynthesisResult` is a union whose two arms name
 * them differently (`samples` for PCM, `bytes` for an encoded container, ADR
 * 0013) — so a caller says what it stores and the budget stays measurable
 * either way.
 */
export interface AudioCache<Clip extends CachedClip = CachedClip> {
  match(key: string): Promise<Clip | null>;
  put(key: string, value: Clip): Promise<void>;
}

export function createMemoryCache<Clip extends CachedClip = CachedClip>(opts: {
  maxBytes: number;
}): AudioCache<Clip> & { clear(): void } {
  // Map preserves insertion order; deleting and re-inserting moves a key to
  // the most-recent end, which is all an LRU needs.
  const entries = new Map<string, { value: Clip; bytes: number }>();
  let total = 0;

  function evictUntilFits(incoming: number): void {
    for (const [key, entry] of entries) {
      if (total + incoming <= opts.maxBytes) break;
      entries.delete(key);
      total -= entry.bytes;
    }
  }

  return {
    async match(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      // Refresh recency.
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },

    async put(key, value) {
      const bytes = value.audio.byteLength;
      // An entry that cannot fit even in an empty cache is simply not cached;
      // evicting everything to make room for it would be strictly worse.
      if (bytes > opts.maxBytes) return;

      const existing = entries.get(key);
      if (existing) {
        entries.delete(key);
        total -= existing.bytes;
      }
      evictUntilFits(bytes);
      entries.set(key, { value, bytes });
      total += bytes;
    },

    clear() {
      entries.clear();
      total = 0;
    },
  };
}
