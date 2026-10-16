import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_FISH_MODEL, FISH_MODELS, FishModelList, fishModelLabel, fishModels, parseFishModels } from '../../../src/core/providers/fish-models';

const entry = (id: string, price: unknown = '0.000015', modality = 'text->speech') => ({ id, architecture: { modality }, pricing: { prompt: price } });
afterEach(() => vi.useRealTimers());

it('keeps the known order, supplements only Fish speech Models and never quotes a price', () => {
  const found = parseFishModels({ data: [entry('fish-audio/s1'), entry('fish-audio/drama-3'), entry('fish-audio/future', '0'),
    entry('other/model'), entry('fish-audio/transcribe', '0', 'audio->text'), entry('fish-audio/s1'), entry('fish-audio/'), null] });
  expect(fishModels(found).map(fishModelLabel)).toEqual([
    's2.1-pro-free — free', 's2.1-pro — paid', 'drama-3 — paid', 's2-pro — paid', 's1 — paid', 'future — free',
  ]);
});
it('retains an unlisted selection without a price claim and leaves unknown prices unknown', () => {
  expect(fishModels([], 'retired').at(-1)).toEqual({ id: 'retired' });
  expect(fishModelLabel({ id: 'retired' })).toBe('retired');
  for (const price of [null, undefined, '', ' ', 'not-a-number', -1]) {
    expect(parseFishModels({ data: [{ ...entry('fish-audio/new'), pricing: { prompt: price } }] })).toEqual([{ id: 'new' }]);
  }
  expect(FISH_MODELS[0].id).toBe(DEFAULT_FISH_MODEL);
  expect(() => parseFishModels({ error: 'not a list' })).toThrow();
});
it('shares a keyless request, caches it for 30 minutes, then asks again', async () => {
  let now = 0;
  const list = new FishModelList(() => now);
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [entry('fish-audio/s1')] }));
  const first = list.load(fetcher);
  expect(list.load(fetcher)).toBe(first);
  expect(await first).toEqual([{ id: 's1', free: false }]);
  now = 30 * 60_000 - 1;
  await list.load(fetcher);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]).toEqual(['https://api.fish.audio/compat/v1/models', { signal: expect.any(AbortSignal) }]);
  now++;
  await list.load(fetcher);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('does not cache failures, so reopening can retry without losing built-in choices', async () => {
  const list = new FishModelList();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(Response.json({ data: [] }));
  await expect(list.load(fetcher)).rejects.toThrow('503');
  expect(fishModels(await list.load(fetcher))).toEqual(FISH_MODELS);
});
it('bounds a stalled response body, aborts and can retry', async () => {
  vi.useFakeTimers();
  const list = new FishModelList();
  const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream()));
  const pending = expect(list.load(fetcher)).rejects.toThrow('did not respond');
  await vi.advanceTimersByTimeAsync(5000);
  await pending;
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  fetcher.mockResolvedValue(Response.json({ data: [] }));
  await expect(list.load(fetcher)).resolves.toEqual([]);
});
