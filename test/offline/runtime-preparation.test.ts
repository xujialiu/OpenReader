import { expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/app/settings';
import type { DownloadTask, NarrationPlan } from '../../src/offline/model';

/**
 * The runtime's half of #76. A chapter's text is prepared by the hidden
 * rendering, which never answered while the app was away from the screen: the
 * request timed out after 60 s and the download stopped as `blocked`, and
 * nothing moved it on when the app came back (notes/NOTES_2026-09-28.md, 02:49).
 * Here the request out when the app leaves is withdrawn as an interruption, the
 * old request's timeout finds nothing to fail, and the download asks again and
 * finishes when the app returns, without a tap. The platform is behind the same
 * test doubles as `runtime.test.ts`, with the app's state under the test's hand.
 */
const mock = vi.hoisted(() => {
  const listeners = new Set<(state: string) => void>();
  return {
    open: vi.fn<() => Promise<unknown>>(),
    listeners,
    app: {
      currentState: 'active',
      addEventListener(_type: string, listener: (state: string) => void) {
        listeners.add(listener);
        return { remove() { listeners.delete(listener); } };
      },
    },
  };
});
vi.mock('react-native', () => ({ AppState: mock.app, Platform: { OS: 'ios' } }));
vi.mock('expo-file-system', () => ({ FileMode: { ReadOnly: 'r' } }));
vi.mock('../../modules/open-reader-offline', () => ({
  offlineNative: {
    addListener: () => ({ remove() {} }),
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

const { configureDownloads, downloadTasks, failPreparation, finishPreparation, preparationRequest, startDownloads } = await import('../../src/offline/runtime');

const move = (state: 'active' | 'background') => {
  mock.app.currentState = state;
  mock.listeners.forEach((listener) => listener(state));
};

it('withdraws the preparation out when the app leaves, ignores its timeout, and asks again when the app returns', async () => {
  const voice = { provider: 'fish' as const, voice: 'A', label: 'A' };
  const chapter = { id: 'a', title: 'A', depth: 0, parent: null, texts: [], section: 0, fragment: '' };
  let plan: NarrationPlan = { version: 2, chapters: [{ ...chapter, prepared: false }], sections: [{ href: 'a.xhtml', path: 'a.xhtml' }], preparedSections: [] };
  const stored: DownloadTask = { id: 't', document: 'book', voice, chapters: ['a'], state: 'queued', error: null, failed: [] };
  const saveSection = vi.fn(async () => {
    plan = { ...plan, chapters: [{ ...chapter, prepared: true, textCount: 1 }], preparedSections: [0] };
  });
  mock.open.mockResolvedValue({
    tasks: async () => [stored],
    catalog: { saveTasks: async () => {}, speechKeying: async () => null },
    rekey: async () => {},
    plan: async () => plan,
    progress: async () => [],
    saveSection,
    chapter: async () => ({ ...chapter, prepared: true, texts: ['Hello.'], textsLoaded: true }),
    hasClip: async () => true,
  });
  configureDownloads(DEFAULT_SETTINGS);
  const stop = startDownloads();
  try {
    await vi.waitFor(() => expect(preparationRequest()).not.toBeNull());
    const [task] = downloadTasks('book');
    const first = preparationRequest()!.token;
    expect(task.state).toBe('preparing');

    move('background');
    await vi.waitFor(() => expect(task.state).toBe('interrupted'));
    expect(task.error).toBeNull();
    expect(preparationRequest()).toBeNull();
    // The hidden rendering's 60 s timer for the withdrawn request fails nothing.
    failPreparation(first, 'Chapter preparation timed out. Continue to try again.');
    expect(task.state).toBe('interrupted');

    move('active');
    await vi.waitFor(() => expect(preparationRequest()?.token).toBeGreaterThan(first));
    expect(task.state).toBe('preparing');
    finishPreparation(preparationRequest()!.token, [{ ...chapter, texts: ['Hello.'] }]);
    await vi.waitFor(() => expect(task.state).toBe('done'));
    expect(saveSection).toHaveBeenCalledTimes(1);
    expect(task.failed).toEqual([]);
  } finally {
    stop();
  }
});
