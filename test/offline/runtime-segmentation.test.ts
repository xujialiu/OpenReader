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
  lines: [] as { tag: string; message: string }[],
  asked: [] as string[],
  connectivity: (_connected: boolean) => {},
  appState: 'active',
  lifecycle: new Set<(state: string) => void>(),
}));
vi.mock('../../src/debug/mode', () => ({ DEBUG_MODE: true }));
vi.mock('../../src/debug/debug-log', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/debug/debug-log')>(),
  debugLog: (tag: string, message: string) => { mock.lines.push({ tag, message }); },
}));
vi.mock('react-native', () => ({
  AppState: { get currentState() { return mock.appState; }, addEventListener: (_: string, fn: (state: string) => void) => {
    mock.lifecycle.add(fn); return { remove() { mock.lifecycle.delete(fn); } };
  } },
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
  mock.lines = [];
  mock.appState = 'active';
  mock.lifecycle.clear();
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


const ready = () => vi.waitFor(() => expect(runtime.downloadsReady()).toBe(true), { interval: 1 });
const changeState = (state: string) => { mock.appState = state; for (const fn of mock.lifecycle) fn(state); };
async function recheck(changed = true) {
  await vi.waitFor(() => expect(runtime.preparationRequest()).not.toBeNull(), { interval: 1 });
  const request = runtime.preparationRequest()!;
  const chapters = changed ? sectionChapters(0, [{ text }, { text: unchanged }], [], 'zh')
    : [chapter('section-0', [text, unchanged])];
  runtime.finishPreparation(request.token, chapters);
  await vi.waitFor(() => expect(runtime.planOf('book')?.chapters[0].recheck).toBe(false), { interval: 1 });
}
it('records launch evidence, the chosen Voice in a Debug Note, and the Download trigger', async () => {
  await launch(); await ready();
  expect(mock.lines.some((l) => l.tag === 'offline' && l.message.includes('launch:') && l.message.includes('1 Downloaded, 1 awaiting Recheck'))).toBe(true);
  const note = await import('../../src/debug/debug-note');
  note.writeDebugNote({ time: 'test-note-time', document: { id: 'book', title: 'Book' }, comment: 'check', voice: { ...voice, voice: 'other' } });
  await vi.waitFor(() => expect(mock.lines.some((l) => l.message.includes('snapshot, Debug Note test-note-time') && l.message.includes('other'))).toBe(true), { interval: 1 });
  await recheck();
  await runtime.enqueue('book', voice, ['section-0']);
  expect(mock.lines.some((l) => l.tag === 'download' && l.message.includes('george') && l.message.includes('Download selected'))).toBe(true);
  await vi.waitFor(() => expect(runtime.downloadTasks('book')[0].state).toBe('done'), { interval: 1 });
});

it('keeps checks through an update, then Rechecks unchanged sentences without any Provider call', async () => {
  await launch(); await ready();
  expect(await shown()).toEqual({ complete: true, count: 2, prepared: [true, true] });
  await recheck(false);
  expect((await shown()).complete).toBe(true);
  expect(mock.asked).toEqual([]);
  expect(disk.size).toBe(2);
});
it('a changed sentence loses only its check, not its partial count, and only Download selected may fill the hole', async () => {
  await launch(); await ready();
  await recheck();
  await vi.waitFor(async () => expect((await shown()).complete).toBe(false), { interval: 1 });
  expect((await shown()).count).toBe(1);
  expect(runtime.downloadTasks('book')[0].recheckHeld).toEqual(['section-0']);
  runtime.toggleTask(runtime.downloadTasks('book')[0]); // Resume all is NOT a fresh selection
  await flush(); await flush();
  expect(mock.asked).toEqual([]);
  await launch(); await ready(); // durable even if a restart loses every in-memory object
  runtime.toggleTask(runtime.downloadTasks('book')[0]);
  mock.connectivity(true);
  await flush(); await flush();
  expect(mock.asked).toEqual([]);
  await runtime.enqueue('book', voice, ['section-0']);
  await vi.waitFor(() => expect(mock.asked).toEqual(['这是第一句。', '2024年发生了很多事。']), { interval: 1 });
  await vi.waitFor(async () => expect((await shown()).complete).toBe(true), { interval: 1 });
});
it.each(['queued', 'downloading', 'waiting', 'interrupted'] as const)('an unfinished %s Download keeps going, but cannot fill a completed chapter made incomplete by Recheck', async (state) => {
  await store.catalog.saveTasks([task(state)]);
  await launch(); await ready();
  await recheck();
  mock.connectivity(true);
  await flush(); await flush();
  expect(runtime.downloadTasks('book')[0].state).not.toBe('paused');
  expect(mock.asked).toEqual([]);
});
it('a partly saved Download is cut again before sending, and may finish its authorized work', async () => {
  await repository.saveSection('book', 0, [chapter('section-0', [text, unchanged, 'Not yet saved.'])]);
  await store.catalog.saveTasks([task('queued')]);
  await launch(); await ready();
  await recheck();
  await vi.waitFor(() => expect(mock.asked).toEqual(['这是第一句。', '2024年发生了很多事。']), { interval: 1 });
});
it('keeps completeness without Recheck when both revisions are current', async () => {
  await recordRevision(CURRENT_SEGMENTATION);
  await launch(); await ready();
  expect(await shown()).toEqual({ complete: true, count: 2, prepared: [true, true] });
  await new Promise((r) => setTimeout(r, 40));
  expect(runtime.preparationRequest()).toBeNull();
  expect(mock.asked).toEqual([]);
});
it('marks an older revision once, and retries an interrupted Recheck after reopening', async () => {
  await recordRevision(0);
  const mark = vi.spyOn(store.catalog, 'prepareAgain');
  await launch(); await ready();
  await vi.waitFor(() => expect(runtime.preparationRequest()).not.toBeNull(), { interval: 1 });
  await launch(); await ready();
  expect(mark).toHaveBeenCalledTimes(1);
  await recheck(false);
  expect((await shown()).complete).toBe(true);
});
it('abandons Recheck away from the foreground, ignores its late reply, and continues on return', async () => {
  await launch(); await ready();
  await vi.waitFor(() => expect(runtime.preparationRequest()).not.toBeNull(), { interval: 1 });
  const stale = runtime.preparationRequest()!;
  changeState('background');
  runtime.finishPreparation(stale.token, [chapter('section-0', ['Wrong.'])]);
  await flush();
  expect(runtime.preparationRequest()).toBeNull();
  expect((await shown()).complete).toBe(true);
  changeState('active');
  await recheck(false);
  expect(mock.asked).toEqual([]);
});
it('a Download preempts an idle Recheck, ignores its old reply, then Recheck resumes without paying', async () => {
  await launch(); await ready();
  await vi.waitFor(() => expect(runtime.preparationRequest()).not.toBeNull(), { interval: 1 });
  const stale = runtime.preparationRequest()!;
  await repository.savePlan('next', { version: 2, sections: [{ path: 'next', href: 'next' }], preparedSections: [],
    chapters: [{ ...chapter('section-0', []), section: 0, prepared: false }] });
  runtime.requestPlan('next', 'Next');
  await vi.waitFor(() => expect(runtime.planOf('next')).not.toBeNull(), { interval: 1 });
  await runtime.enqueue('next', voice, ['section-0']);
  await vi.waitFor(() => expect(runtime.preparationRequest()?.document).toBe('next'), { interval: 1 });
  runtime.finishPreparation(stale.token, [chapter('section-0', ['STALE'])]);
  const fresh = runtime.preparationRequest()!;
  runtime.finishPreparation(fresh.token, [chapter('section-0', ['Explicit download.'])]);
  await vi.waitFor(() => expect(runtime.downloadTasks('next')[0].state).toBe('done'), { interval: 1 });
  await recheck(false);
  expect(mock.asked).toEqual(['Explicit download.']);
  expect((await repository.chapter('book', 'section-0'))?.texts).toEqual([text, unchanged]);
});

it('a section save failing after rendering leaves the old check and never schedules synthesis', async () => {
  await launch(); await ready();
  vi.spyOn(repository, 'saveSection').mockRejectedValueOnce(new Error('disk full'));
  await vi.waitFor(() => expect(runtime.preparationRequest()).not.toBeNull(), { interval: 1 });
  runtime.finishPreparation(runtime.preparationRequest()!.token, [chapter('section-0', ['Changed'])]);
  await vi.waitFor(() => expect(mock.lines.some((l) => l.message.includes('Recheck') && l.message.includes('disk full'))).toBe(true), { interval: 1 });
  expect((await shown()).complete).toBe(true);
  expect(mock.asked).toEqual([]);
  changeState('background'); changeState('active');
  await recheck(false);
});

it('gates scheduler and Recheck until revisions have been read, even on reconnect', async () => {
  let release!: (value: number) => void;
  vi.spyOn(store.catalog, 'preparedWalk').mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  await launch();
  try {
    mock.connectivity(true);
    await flush();
    expect(mock.asked).toEqual([]);
    expect(runtime.preparationRequest()).toBeNull();
  } finally { release(BLOCK_WALK); }
  await ready();
  await recheck(false);
});
it('a failed revision transaction leaves the old evidence intact and both runners stopped until restart', async () => {
  await store.catalog.saveTasks([task('queued')]);
  vi.spyOn(store.catalog, 'prepareAgain').mockRejectedValueOnce(new Error('disk full'));
  await launch();
  await vi.waitFor(() => expect(runtime.downloadError()).toContain('disk full'), { interval: 1 });
  expect(await revision()).toBeNull();
  expect((await repository.plan('book'))?.chapters[0].prepared).toBe(true);
  runtime.toggleTask(runtime.downloadTasks('book')[0]);
  await runtime.enqueue('book', voice, ['section-0']);
  mock.connectivity(true);
  await flush();
  expect(runtime.downloadsReady()).toBe(false);
  expect(mock.asked).toEqual([]);
  await launch(); await ready();
  await recheck(false);
});
