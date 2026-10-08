import { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';
import type { SynthesisResult } from '../../src/core/providers/types';
import { OfflineCatalog, type SqlDatabase, type SqlSession, type StoredAudio } from '../../src/offline/catalog';
import { audioAddress } from '../../src/offline/catalog-keys';
import { OfflineRepository, type AudioFiles } from '../../src/offline/repository';
import { speechKeying } from '../../src/offline/speech';

/**
 * #146: Delete selected in Manage downloads, as the owner sees it afterwards.
 *
 * A deleted chapter looks deleted: it leaves Manage downloads, shows no count
 * of saved sentences and no check. A sentence it shares with a chapter still
 * downloaded keeps its one file for that chapter, and the file goes once every
 * chapter that uses it has been deleted.
 *
 * The real runtime, scheduler, repository and SQLite catalogue; the Provider
 * and the disk are doubles. What the drawer would draw is asked of the same
 * row rules it uses (`download-rows.ts`), over the progress it reads.
 */
const mock = vi.hoisted(() => ({
  repository: null as unknown,
  /** Requests out at the Provider, each answered when its function is called. */
  held: new Map<string, () => void>(),
  hold: false,
}));
vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  Platform: { OS: 'ios' },
}));
vi.mock('expo-file-system', () => ({ FileMode: { ReadOnly: 'r' } }));
vi.mock('../../modules/open-reader-offline', () => ({
  offlineNative: {
    addListener: () => ({ remove() {} }),
    beginBackground: async () => true,
    endBackground: async () => {},
    submitContinued: async () => false,
    updateContinued: async () => {},
    finishContinued: async () => {},
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
  createProvider: () => ({
    id: 'speechify', capabilities: { wordTimestamps: true }, listVoices: async () => [],
    synthesize: async (text: string): Promise<SynthesisResult> => {
      if (mock.hold) await new Promise<void>((resolve) => mock.held.set(text, resolve));
      return { audio: 'encoded', bytes: new Uint8Array([1, 2, 3]), mediaType: 'audio/mp4' };
    },
  }),
}));
vi.mock('../../src/offline/database', () => ({ offlineRepository: async () => mock.repository }));

const { downloadedChapters, listedInManage, marker } = await import('../../src/app/download-rows');

const settings: AppSettings = {
  ...DEFAULT_SETTINGS, provider: 'speechify', enabledProviders: ['speechify'], voice: 'en-US/george',
  sentencesAtOnce: { ...DEFAULT_SETTINGS.sentencesAtOnce, speechify: 3 },
};
const voice = { provider: 'speechify' as const, voice: 'en-US/george', label: 'George' };
const lines = (name: string, count: number) => Array.from({ length: count }, (_, i) => `${name} says line ${i}.`);
/**
 * A line repeated from chapter to chapter, as in the owner's book. Not one of
 * its status boxes in angle brackets: the bracket setting leaves those out of
 * the Speech Text (#25), which is not what is tested here.
 */
const SHARED = '"I don\'t have an ability."';

/** The disk: every file the store wrote and has not removed. */
const disk = new Map<string, StoredAudio>();
const at = (a: { document: string; voice: string; key: string }) => `${a.document}/${a.voice}/${a.key}`;
const files: AudioFiles = {
  lookup: async (address) => disk.get(at(address)) ?? null,
  present: async (audio) => disk.has(at(audio)),
  read: async () => null,
  write: async (document, v, text, _clip, wanted) => {
    if (!wanted()) return false;
    const address = audioAddress(document, v, text);
    disk.set(at(address), { ...address, path: `${address.key}.audio`, format: 'encoded', size: 3, mediaType: 'audio/mp4' });
    return true;
  },
  remove: async (address) => { disk.delete(at(address)); },
  cleanTemporary: async () => {},
  removeDocumentFiles: async (document) => { for (const k of [...disk.keys()]) if (k.startsWith(`${document}/`)) disk.delete(k); },
};

let db: DatabaseSync;
let runtime: typeof import('../../src/offline/runtime');
let stop: () => void = () => {};

/** A fresh catalogue holding `book`, prepared, and a fresh runtime over it. */
async function open(book: { id: string; texts: string[] }[]) {
  stop();
  disk.clear();
  mock.held.clear();
  mock.hold = false;
  db = new DatabaseSync(':memory:');
  const session: SqlSession = {
    execAsync: async (sql) => { db.exec(sql); },
    runAsync: async (sql, ...params) => { db.prepare(sql).run(...params); },
    getAllAsync: async <T>(sql: string, ...params: (string | number | null)[]) => db.prepare(sql).all(...params) as T[],
  };
  const connection: SqlDatabase = {
    ...session,
    withExclusiveTransactionAsync: async (run) => {
      db.exec('BEGIN');
      try { await run(session); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  const catalog = new OfflineCatalog(connection);
  await catalog.initialize();
  const repository = new OfflineRepository(catalog, files);
  await repository.recover();
  await repository.savePlan('book', {
    version: 2, sections: [{ href: '0', path: '0' }], preparedSections: [],
    chapters: book.map(({ id }) => ({ id, title: id, depth: 0, parent: null, section: 0, fragment: id, prepared: false, texts: [] })),
  });
  await repository.saveSection('book', 0, book.map(({ id, texts }) => ({ id, title: id, depth: 0, parent: null, texts })));
  await catalog.recordSpeechKeying(speechKeying(settings));
  mock.repository = repository;

  vi.resetModules();
  runtime = await import('../../src/offline/runtime');
  (await import('../../src/app/consent')).configureConsent({ kept: () => true, keep: () => {}, ask: async () => true });
  runtime.configureDownloads(settings);
  stop = runtime.startDownloads();
  await vi.waitFor(() => expect(runtime.downloadsReady()).toBe(true));
  runtime.requestPlan('book', 'Book');
  await vi.waitFor(() => expect(runtime.planOf('book')).not.toBeNull());
  // The drawer is open: it asks for the progress, and every saved clip reads it again.
  runtime.requestProgress('book', voice);
}
beforeEach(() => stop());

/** Lets the runtime's chained saves and progress reads settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

/** What the Download drawer and Manage downloads would draw now, and what is left in the store. */
async function shown() {
  runtime.requestProgress('book', voice);
  await settle();
  const chapters = runtime.planOf('book')!.chapters;
  const progress = runtime.chapterProgress('book', voice);
  const task = runtime.downloadTasks('book').find((t) => runtime.sameVoice(t.voice, voice));
  const managed = new Map(chapters.map((c) => [c.id, marker(c, progress.get(c.id), task, true)]));
  return {
    /** The `k / N` under a row the Download page does not check. */
    counts: Object.fromEntries(chapters.map((c) => [c.id, progress.get(c.id)?.count ?? 0])),
    /** Checked in the Download drawer and in Contents (#134). */
    downloaded: chapters.map((c) => c.id).filter((id) => downloadedChapters(chapters, progress).has(id)),
    manage: [...listedInManage(chapters, managed)],
    files: disk.size,
  };
}
/** Files and rows of one sentence's clip. */
const saved = (text: string) => {
  const key = audioAddress('book', voice, text);
  const rows = (db.prepare('SELECT COUNT(*) AS n FROM clips WHERE document=? AND voice=? AND key=?').get(key.document, key.voice, key.key) as { n: number }).n;
  return { file: disk.has(at(key)), rows };
};
/** Answers the Provider's requests one at a time until `done` holds, then leaves the rest out. */
async function answerUntil(done: () => Promise<boolean>) {
  while (!(await done())) {
    await vi.waitFor(() => expect(mock.held.size).toBeGreaterThan(0));
    const [text, answer] = [...mock.held.entries()][0];
    mock.held.delete(text);
    answer();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await vi.waitFor(() => expect(mock.held.size).toBeGreaterThan(0));
}
const savedOf = async (id: string) =>
  (await (mock.repository as OfflineRepository).progress('book', voice)).find((p) => p.id === id)!.count;
const answerAll = () => { for (const answer of mock.held.values()) answer(); mock.held.clear(); };

it('deletes every trace of a chapter half downloaded and paused, with requests still out (#146)', async () => {
  await open([{ id: 'one', texts: lines('One', 12) }]);
  mock.hold = true;
  runtime.enqueue('book', voice, ['one']);
  await answerUntil(async () => (await savedOf('one')) >= 6);
  runtime.toggleTask(runtime.downloadTasks('book')[0]);
  expect(runtime.downloadTasks('book')[0].state).toBe('paused');
  await runtime.deleteDownloaded('book', voice, ['one']);
  // What was out when the owner deleted answers afterwards, and is not kept.
  answerAll();
  expect(await shown()).toEqual({ counts: { one: 0 }, downloaded: [], manage: [], files: 0 });
  expect(db.prepare('SELECT COUNT(*) AS n FROM clips').get()).toEqual({ n: 0 });
  expect(db.prepare('SELECT COUNT(*) AS n FROM writes').get()).toEqual({ n: 0 });
  expect(runtime.downloadTasks('book')).toEqual([]);
});

it('deletes every trace of a chapter paused by its ring, after what was out has been kept', async () => {
  await open([{ id: 'one', texts: lines('One', 12) }]);
  mock.hold = true;
  runtime.enqueue('book', voice, ['one']);
  await answerUntil(async () => (await savedOf('one')) >= 6);
  await settle();
  runtime.toggleChapter(runtime.downloadTasks('book')[0], 'one');
  // A paused download keeps the results it already paid for.
  answerAll();
  await settle();
  await runtime.deleteDownloaded('book', voice, ['one']);
  expect(await shown()).toEqual({ counts: { one: 0 }, downloaded: [], manage: [], files: 0 });
  expect(runtime.downloadTasks('book')).toEqual([]);
});

it('shows a deleted chapter as deleted, and keeps the line it shares for the chapters still downloaded (#146)', async () => {
  // The owner's case: chapter two is half saved when the download is paused.
  await open([
    { id: 'one', texts: [SHARED, ...lines('One', 4)] },
    { id: 'two', texts: [SHARED, ...lines('Two', 11)] },
    { id: 'three', texts: [SHARED, ...lines('Three', 4)] },
  ]);
  mock.hold = true;
  runtime.enqueue('book', voice, ['one', 'two', 'three']);
  await answerUntil(async () => (await savedOf('two')) >= 6);
  runtime.toggleTask(runtime.downloadTasks('book')[0]);
  answerAll();
  await settle();
  const before = await shown();
  expect(before.downloaded).toEqual(['one']);
  expect(before.manage).toEqual(['one', 'two', 'three']);

  await runtime.deleteDownloaded('book', voice, ['two']);
  const after = await shown();
  // Two is gone from Manage, and its row counts nothing; one is still downloaded.
  expect(after.manage).toEqual(['one', 'three']);
  expect(after.counts).toEqual({ one: 5, two: 0, three: 1 });
  expect(after.downloaded).toEqual(['one']);
  // The shared line is one file, kept for one and three; two's own lines are gone.
  expect(saved(SHARED)).toEqual({ file: true, rows: 1 });
  expect(saved('Two says line 0.')).toEqual({ file: false, rows: 0 });
});

it('does not offer for deletion a chapter that was never downloaded, though it shares a line with one that was (#146)', async () => {
  await open([
    { id: 'one', texts: [SHARED, ...lines('One', 4)] },
    { id: 'two', texts: [SHARED, ...lines('Two', 11)] },
  ]);
  runtime.enqueue('book', voice, ['one']);
  await vi.waitFor(() => expect(runtime.downloadTasks('book')[0].state).toBe('done'));
  expect(await shown()).toEqual({ counts: { one: 5, two: 0 }, downloaded: ['one'], manage: ['one'], files: 5 });
});

it('takes the check from a deleted chapter whose every sentence another downloaded chapter still keeps (#146)', async () => {
  await open([
    { id: 'one', texts: [SHARED, ...lines('One', 4)] },
    { id: 'box', texts: [SHARED] },
  ]);
  runtime.enqueue('book', voice, ['one', 'box']);
  await vi.waitFor(() => expect(runtime.downloadTasks('book')[0].state).toBe('done'));
  expect((await shown()).downloaded).toEqual(['one', 'box']);
  await runtime.deleteDownloaded('book', voice, ['box']);
  // Its one line is still on the phone, for chapter one; the owner deleted the chapter, so it is not checked.
  expect(saved(SHARED)).toEqual({ file: true, rows: 1 });
  expect(await shown()).toEqual({ counts: { one: 5, box: 0 }, downloaded: ['one'], manage: ['one'], files: 5 });
});

it('deletes a shared line only once every chapter that uses it has been deleted', async () => {
  await open([
    { id: 'one', texts: [SHARED, ...lines('One', 4)] },
    { id: 'two', texts: [SHARED, ...lines('Two', 4)] },
    { id: 'three', texts: [SHARED, ...lines('Three', 4)] },
  ]);
  runtime.enqueue('book', voice, ['one', 'two', 'three']);
  await vi.waitFor(() => expect(runtime.downloadTasks('book')[0].state).toBe('done'));
  await runtime.deleteDownloaded('book', voice, ['two']);
  expect(saved(SHARED)).toEqual({ file: true, rows: 1 });
  await runtime.deleteDownloaded('book', voice, ['one']);
  expect(saved(SHARED)).toEqual({ file: true, rows: 1 });
  await runtime.deleteDownloaded('book', voice, ['three']);
  expect(saved(SHARED)).toEqual({ file: false, rows: 0 });
  expect(await shown()).toEqual({ counts: { one: 0, two: 0, three: 0 }, downloaded: [], manage: [], files: 0 });
});
