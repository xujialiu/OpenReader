import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';
import { createVoiceLists, type VoiceListDeps } from '../../src/app/voice-lists';
import type { ProviderId, VoiceInfo } from '../../src/core/providers/types';

/** A listing that answers when the test says so, one per call. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const voice = (id: string): VoiceInfo => ({ id, label: id, locale: 'en' });
const settings: AppSettings = { ...DEFAULT_SETTINGS, enabledProviders: ['fish', 'speechify', 'openai-official'] };

function harness() {
  const calls: { provider: ProviderId; answer: ReturnType<typeof deferred<VoiceInfo[]>> }[] = [];
  const remembered: [ProviderId, readonly VoiceInfo[]][] = [];
  const deps: VoiceListDeps = {
    list: (_settings, provider) => {
      const answer = deferred<VoiceInfo[]>();
      calls.push({ provider, answer });
      return answer.promise;
    },
    remember: (_settings, provider, voices) => void remembered.push([provider, voices]),
    scope: (_settings, provider) => provider,
  };
  return { lists: createVoiceLists(deps), calls, remembered };
}

describe('voice lists (#24)', () => {
  it('asks every enabled Provider at once when the app starts, not one after another', () => {
    const { lists, calls } = harness();
    lists.prefetch(settings);
    expect(calls.map((call) => call.provider).sort()).toEqual(['fish', 'openai-official', 'speechify']);
    expect([...lists.asking()].sort()).toEqual(['fish', 'openai-official', 'speechify']);
  });

  it('lets a sheet opened mid-listing wait for the same request instead of sending another', async () => {
    const { lists, calls, remembered } = harness();
    lists.prefetch({ ...settings, enabledProviders: ['fish'] });
    const joined = lists.load(settings, 'fish');
    expect(calls).toHaveLength(1);
    calls[0].answer.resolve([voice('en/a')]);
    expect(await joined).toEqual([voice('en/a')]);
    expect(remembered).toEqual([['fish', [voice('en/a')]]]);
    expect(lists.asking().size).toBe(0);
  });

  it('keeps a failure at start to itself, and asks again, reporting, when the sheet asks', async () => {
    const { lists, calls } = harness();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      lists.prefetch({ ...settings, enabledProviders: ['fish'] });
      calls[0].answer.reject(new Error('Fish Audio voice list: cannot reach api.fish.audio'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
      expect(lists.asking().size).toBe(0);
      const again = lists.load(settings, 'fish');
      expect(calls).toHaveLength(2);
      calls[1].answer.reject(new Error('still down'));
      await expect(again).rejects.toThrow('still down');
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('tells its listeners when what is being asked changes', async () => {
    const { lists, calls } = harness();
    const heard = vi.fn();
    const stop = lists.subscribe(heard);
    const listed = lists.load(settings, 'speechify');
    expect(heard).toHaveBeenCalledTimes(1);
    const before = lists.asking();
    calls[0].answer.resolve([]);
    await listed;
    expect(heard).toHaveBeenCalledTimes(2);
    // A new set, so `useSyncExternalStore` sees the change.
    expect(lists.asking()).not.toBe(before);
    stop();
  });

  it('asks nothing for a Provider that is not enabled', () => {
    const { lists, calls } = harness();
    lists.prefetch({ ...settings, enabledProviders: [] });
    expect(calls).toHaveLength(0);
  });
});
