import { setImmediate } from 'node:timers';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/app/settings';
import type { SynthesisResult } from '../../src/core/providers/types';
import { SEGMENTATION as CURRENT_SEGMENTATION } from '../../src/core/segmenter/revision';
import type { StoredAudio } from '../../src/offline/catalog';
import { audioAddress } from '../../src/offline/catalog-keys';
import { sectionChapters, type DownloadTask } from '../../src/offline/model';
import { OfflineRepository, type AudioFiles } from '../../src/offline/repository';
import { speechKeying } from '../../src/offline/speech';
import { BLOCK_WALK } from '../../src/renderer/highlighter';
import { testCatalog } from './sqlite';

// #240/#245/#241/#242: real runtime, scheduler, repository, SQLite and splitter.
// Native lifecycle, files, rendering and the Provider are doubles. No real audio.
const mock = vi.hoisted(() => ({
  repository: null as unknown,
  asked: [] as string[],
  connectivity: (_connected: boolean) => {},
}));
vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  Platform: { OS: 'ios' },
}));
vi.mock('expo-file-system', () => ({ FileMode: { ReadOnly: 'r' } }));
vi.mock('../../modules/open-reader-offline', () => ({
  offlineNative: {
    addListener: (name: string, listener: (event: { connected: boolean }) => void) => {
      if (name === 'connectivity') mock.connectivity = (connected) => listener({ connected });
      return { remove() {} };
    },
    beginBackground: async () => true, endBackground: async () => {},
    submitContinued: async () => false, updateContinued: async () => {}, finishContinued: async () => {},
  },
}));
vi.mock('../../src/app/library', () => ({ documentFile: () => { throw new Error('No EPUB is opened in this host test.'); } }));
vi.mock('../../src/keys/store', () => ({
  readProviderKey: async () => ({ outcome: 'found', secret: 'test-key' }),
  readGatewayHeaders: async () => ({ outcome: 'found', secret: '' }),
}));
vi.mock('../../src/core/providers/factory', () => ({
  createProvider: () => ({
    id: 'speechify', capabilities: { wordTimestamps: false }, listVoices: async () => [],
    synthesize: async (text: string): Promise<SynthesisResult> => {
      mock.asked.push(text);
      return { audio: 'encoded', bytes: new Uint8Array([1, 2, 3]), mediaType: 'audio/mp4' };
    },
  }),
}));
vi.mock('../../src/offline/database', () => ({ offlineRepository: async () => mock.repository }));

const settings = { ...DEFAULT_SETTINGS, provider: 'speechify' as const, enabledProviders: ['speechify' as const], voice: 'george' };
const voice = { provider: 'speechify' as const, voice: 'george', label: 'George' };
const text = '这是第一句。2024年发生了很多事。';
const unchanged = 'Unchanged sentence.';
const clip: SynthesisResult = { audio: 'encoded', bytes: new Uint8Array([1, 2, 3]), mediaType: 'audio/mp4' };
const disk = new Map<string, StoredAudio>();
const key = (a: { document: string; voice: string; key: string }) => `${a.document}/${a.voice}/${a.key}`;
const files: AudioFiles = {
  lookup: async (address) => disk.get(key(address)) ?? null,
  present: async (audio) => disk.has(key(audio)),
  read: async (audio) => disk.has(key(audio)) ? clip : null,
  write: async (document, v, speech) => {
    const address = audioAddress(document, v, speech);
    disk.set(key(address), { ...address, path: `${address.key}.audio`, format: 'encoded', size: 3, mediaType: 'audio/mp4' });
    return true;
  },
  remove: async (address) => { disk.delete(key(address)); },
  cleanTemporary: async () => {}, removeDocumentFiles: async () => {},
};
const chapter = (id: string, texts: string[]) => ({ id, title: id, depth: 0, parent: null, texts });
const task = (state: DownloadTask['state']): DownloadTask => ({
  id: 'book/george', document: 'book', voice, chapters: ['section-0', 'section-1'], state, error: null, failed: [],
});
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
let store: ReturnType<typeof testCatalog>;
let repository: OfflineRepository;
let runtime: typeof import('../../src/offline/runtime');
let stop: (() => void) | undefined;

beforeEach(async () => {
  mock.asked = [];
  disk.clear();
  store = testCatalog();
  await store.catalog.initialize();
  repository = new OfflineRepository(store.catalog, files);
  await repository.recover();
  await repository.savePlan('book', {
    version: 2, sections: [{ path: 'one', href: 'one' }, { path: 'cover', href: 'cover' }], preparedSections: [],
    chapters: [0, 1].map((section) => ({ ...chapter(`section-${section}`, []), section, prepared: false })),
  });
  await repository.saveSection('book', 0, [chapter('section-0', [text, unchanged])]);
  await repository.saveSection('book', 1, [chapter('section-1', [])]);
  for (const speech of [text, unchanged]) await repository.saveClip('book', voice, speech, clip, () => true);
  await store.catalog.saveTasks([task('done')]);
  await store.catalog.recordWalk(BLOCK_WALK);
  await store.catalog.recordSpeechKeying(speechKeying(settings));
  mock.repository = repository;
});
afterEach(async () => {
  stop?.();
  stop = undefined;
  await flush();
  store.close();
});

async function launch() {
  stop?.();
  vi.resetModules();
  runtime = await import('../../src/offline/runtime');
  (await import('../../src/app/consent')).configureConsent({ kept: () => true, keep: () => {}, ask: async () => true });
  runtime.configureDownloads(settings);
  stop = runtime.startDownloads();
  await flush();
}
async function shown() {
  runtime.requestPlan('book', 'Document');
  runtime.requestProgress('book', voice);
  await flush();
  // The first availability query can now yield while verifying pre-fix audio
  // (#313); a single setImmediate is not a completed progress read.
  await vi.waitFor(() => expect(runtime.chapterProgress('book', voice).has('section-0')).toBe(true), { interval: 1 });
  return {
    complete: runtime.chapterProgress('book', voice).get('section-0')?.complete,
    count: runtime.chapterProgress('book', voice).get('section-0')?.count,
    prepared: runtime.planOf('book')?.chapters.map((c) => c.prepared),
  };
}
async function revision() {
  const [row] = await store.connection.getAllAsync<{ value: string }>("SELECT value FROM state WHERE name='segmentation'");
  return row ? Number(row.value) : null;
}
async function recordRevision(value: number) {
  await store.connection.runAsync("INSERT OR REPLACE INTO state VALUES('segmentation',?)", String(value));
}

it('removes stale completeness, not saved audio or the ability to delete it, even when the walk is current', async () => {
  await launch();
  expect(await shown()).toEqual({ complete: false, count: 2, prepared: [false, true] });
  expect(await revision()).toBe(CURRENT_SEGMENTATION);
  expect(disk.size).toBe(2);
  expect(mock.asked).toEqual([]);
  expect(runtime.preparationRequest()).toBeNull();
  expect(runtime.downloadTasks('book')[0].state).toBe('done');
});

it('keeps completeness when both preparation revisions are current', async () => {
  await recordRevision(CURRENT_SEGMENTATION);
  await launch();
  expect(await shown()).toEqual({ complete: true, count: 2, prepared: [true, true] });
  expect(mock.asked).toEqual([]);
});

it('invalidates an explicitly older revision, and only once across fresh runtimes', async () => {
  await recordRevision(0);
  const invalidate = vi.spyOn(store.catalog, 'prepareAgain');
  await launch();
  expect(invalidate).toHaveBeenCalledTimes(1);
  await launch();
  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(await revision()).toBe(CURRENT_SEGMENTATION);
  expect(mock.asked).toEqual([]);
});

it.each(['queued', 'downloading', 'waiting', 'interrupted'] as const)('persists a pause for an unfinished %s Download; another launch or reconnect cannot resume it', async (state) => {
  await store.catalog.saveTasks([task(state)]);
  await launch();
  expect(runtime.downloadTasks('book')[0].state).toBe('paused');
  expect((await repository.tasks())[0].state).toBe('paused');
  await launch();
  mock.connectivity(true);
  await flush();
  expect(runtime.downloadTasks('book')[0].state).toBe('paused');
  expect(runtime.preparationRequest()).toBeNull();
  expect(mock.asked).toEqual([]);
});

it('an explicit Download prepares current sentences and requests only changed text; unchanged audio still plays from disk', async () => {
  await launch();
  expect((await shown()).complete).toBe(false);
  runtime.enqueue('book', voice, ['section-0']);
  await flush();
  const request = runtime.preparationRequest();
  if (!request) throw new Error('An explicit Download must request fresh preparation.');
  const prepared = sectionChapters(0, [{ text }, { text: unchanged }], [], 'zh');
  runtime.finishPreparation(request.token, prepared);
  await flush();
  expect((await shown()).complete).toBe(true);
  expect(mock.asked).toEqual(['这是第一句。', '2024年发生了很多事。']);
  expect(disk.size).toBe(4); // The old merged Clip was not deleted.
  await runtime.offlineProvider('book', settings).synthesize(unchanged, { voice: voice.voice, signal: new AbortController().signal });
  expect(mock.asked).toHaveLength(2);
});

it('does not start the scheduler on a reconnect while preparation revisions are still being read', async () => {
  await store.catalog.saveTasks([task('queued')]);
  await repository.saveSection('book', 0, [chapter('section-0', [text, unchanged, 'Not yet saved.'])]);
  let release!: (value: number) => void;
  vi.spyOn(store.catalog, 'preparedWalk').mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  try {
    await launch();
    mock.connectivity(true);
    await flush();
    expect(mock.asked).toEqual([]);
    expect(runtime.preparationRequest()).toBeNull();
    expect(runtime.downloadTasks('book')[0].state).toBe('queued');
  } finally {
    release(BLOCK_WALK);
    await flush();
  }
  expect(runtime.downloadTasks('book')[0].state).toBe('paused');
});

it('a failure to persist the pauses leaves both the old revision and prepared texts intact', async () => {
  await store.catalog.saveTasks([task('queued')]);
  const save = store.catalog.saveTasks.bind(store.catalog);
  const persist = vi.spyOn(store.catalog, 'saveTasks').mockImplementation(async (tasks) => {
    if (tasks.some((task) => task.state === 'paused')) throw new Error('pause write failed');
    await save(tasks);
  });
  await launch();
  expect(runtime.downloadError()).toContain('pause write failed');
  expect(await revision()).toBeNull();
  expect((await repository.plan('book'))?.chapters[0].prepared).toBe(true);
  expect((await repository.tasks())[0].state).toBe('queued');
  mock.connectivity(true);
  await flush();
  expect(mock.asked).toEqual([]);
  persist.mockRestore();
  await launch();
  expect(await revision()).toBe(CURRENT_SEGMENTATION);
  expect((await repository.tasks())[0].state).toBe('paused');
});

it('a revision-write failure rolls back the invalidation of chapters and prepared sections', async () => {
  await recordRevision(0);
  const transact = store.connection.withExclusiveTransactionAsync.bind(store.connection);
  vi.spyOn(store.connection, 'withExclusiveTransactionAsync').mockImplementationOnce((run) => transact(async (tx) => run({
    ...tx,
    runAsync: async (sql, ...params) => {
      if (sql.includes("VALUES('segmentation'")) throw new Error('revision write failed');
      return tx.runAsync(sql, ...params);
    },
  })));
  await expect(store.catalog.prepareAgain(BLOCK_WALK, CURRENT_SEGMENTATION)).rejects.toThrow('revision write failed');
  expect(await revision()).toBe(0);
  expect((await repository.plan('book'))?.chapters.map((c) => c.prepared)).toEqual([true, true]);
  expect((await repository.plan('book'))?.preparedSections).toEqual([0, 1]);
  expect(disk.size).toBe(2);
});

it('a failed invalidation cannot advance the revision or authorize requests; the next launch retries it', async () => {
  await store.catalog.saveTasks([task('queued')]);
  vi.spyOn(store.catalog, 'prepareAgain').mockRejectedValueOnce(new Error('migration write failed'));
  await launch();
  expect(runtime.downloadError()).toContain('migration write failed');
  expect(await revision()).toBeNull();
  expect((await repository.tasks())[0].state).toBe('paused');
  runtime.toggleTask(runtime.downloadTasks('book')[0]);
  runtime.toggleChapter(runtime.downloadTasks('book')[0], 'section-0');
  runtime.enqueue('book', voice, ['section-0']);
  mock.connectivity(true);
  await flush();
  expect(runtime.downloadTasks('book')[0].state).toBe('paused');
  expect(runtime.downloadError()).toContain('migration write failed');
  expect(mock.asked).toEqual([]);
  await launch();
  expect(await revision()).toBe(CURRENT_SEGMENTATION);
  expect((await shown()).complete).toBe(false);
  expect(runtime.downloadTasks('book')[0].state).toBe('paused');
});
