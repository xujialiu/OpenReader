import { expect, it, vi } from 'vitest';
import type { DownloadTask } from '../../src/offline/model';

/**
 * The runtime's half of #56: a chapter the owner paused stays paused across a
 * restart and when other chapters are added. The platform is behind the same
 * test doubles as `runtime.test.ts`; the device is taken offline before the
 * restored download starts, so the scheduler parks it as waiting and nothing
 * is fetched.
 */
const mock = vi.hoisted(() => ({
  open: vi.fn<() => Promise<unknown>>(),
  connectivity: null as null | ((event: { connected: boolean }) => void),
}));
vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  Platform: { OS: 'ios' },
}));
vi.mock('expo-file-system', () => ({ FileMode: { ReadOnly: 'r' } }));
vi.mock('../../modules/open-reader-offline', () => ({
  offlineNative: {
    addListener(event: string, listener: (event: { connected: boolean }) => void) {
      if (event === 'connectivity') mock.connectivity = listener;
      return { remove() {} };
    },
    beginBackground: async () => true,
    endBackground: async () => {},
  },
}));
vi.mock('../../src/app/library', () => ({
  documentFile: () => { throw new Error('The document file is not read here.'); },
}));
vi.mock('../../src/keys/store', () => ({
  readProviderKey: async () => ({ outcome: 'found', secret: 'test-key' }),
  readGatewayHeaders: async () => ({ outcome: 'found', secret: '' }),
}));
vi.mock('../../src/core/providers/factory', () => ({
  createProvider: () => { throw new Error('Nothing is synthesized here.'); },
}));
vi.mock('../../src/offline/database', () => ({ offlineRepository: () => mock.open() }));

const { downloadTasks, downloadsReady, enqueue, startDownloads, toggleChapter } = await import('../../src/offline/runtime');

it('keeps the chapters the owner paused paused across a restart and when other chapters are added', async () => {
  const voice = { provider: 'fish' as const, voice: 'A', label: 'A' };
  const stored: DownloadTask = { id: 't', document: 'book', voice, chapters: ['a', 'b'], state: 'downloading', error: null, failed: [], paused: ['a'] };
  const saveTasks = vi.fn(async (_tasks: DownloadTask[]) => {});
  mock.open.mockResolvedValue({ tasks: async () => [stored], catalog: { saveTasks, speechKeying: async () => null } });
  const stop = startDownloads();
  try {
    mock.connectivity!({ connected: false });
    await vi.waitFor(() => expect(downloadsReady()).toBe(true));
    const [task] = downloadTasks('book');
    // Restored: what was being written waits for the network, and the paused chapter is still paused.
    await vi.waitFor(() => expect(task.state).toBe('waiting'));
    expect(task.paused).toEqual(['a']);

    enqueue('book', voice, ['c']);
    expect(task).toMatchObject({ chapters: ['a', 'b', 'c'], paused: ['a'], state: 'queued' });
    await vi.waitFor(() => expect(saveTasks).toHaveBeenLastCalledWith([expect.objectContaining({ chapters: ['a', 'b', 'c'], paused: ['a'] })]));

    // Pausing the other two leaves nothing going on, so the download is paused.
    toggleChapter(task, 'b');
    toggleChapter(task, 'c');
    expect(task).toMatchObject({ state: 'paused', paused: ['a', 'b', 'c'] });
    // Choosing a paused chapter again is choosing it: it is no longer paused.
    enqueue('book', voice, ['b']);
    expect(task).toMatchObject({ state: 'queued', paused: ['a', 'c'] });
  } finally {
    stop();
  }
});
