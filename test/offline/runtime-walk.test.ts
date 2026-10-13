import { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';
import type { SynthesisResult } from '../../src/core/providers/types';
import { OfflineCatalog, type SqlDatabase, type SqlSession, type StoredAudio } from '../../src/offline/catalog';
import { audioAddress } from '../../src/offline/catalog-keys';
import { OfflineRepository, type AudioFiles } from '../../src/offline/repository';
import { downloadSpeech, speechKeying } from '../../src/offline/speech';
import { BLOCK_WALK } from '../../src/renderer/highlighter';

/**
 * #184: a chapter prepared by another walk of the page is prepared again.
 *
 * The walk is what cuts a section into Blocks, and a change to it changes
 * sentences: a list read an item at a time, a heading's two lines kept apart.
 * A Reading asks for a saved Clip by the sentence it cuts now, so a chapter that
 * kept the sentences of an earlier walk would read Downloaded while one of them
 * went to the Provider (ADR 0027). At launch the runtime asks the catalogue
 * which walk prepared it, and when it is another, every chapter with text loses
 * its check until it is downloaded again; that download prepares the text
 * afresh and asks the Provider only for the sentences whose text changed.
 *
 * The real runtime, scheduler, repository and SQLite catalogue; the Provider,
 * the disk and the hidden rendering are doubles. What the drawer would draw is
 * asked of the same row rules it uses (`download-rows.ts`).
 */
const mock = vi.hoisted(() => ({ repository: null as unknown, asked: [] as string[] }));
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
      mock.asked.push(text);
      return { audio: 'encoded', bytes: new Uint8Array([1, 2, 3]), mediaType: 'audio/mp4' };
    },
  }),
}));
vi.mock('../../src/offline/database', () => ({ offlineRepository: async () => mock.repository }));

const { downloadedChapters, listedInManage, marker } = await import('../../src/app/download-rows');

const settings: AppSettings = { ...DEFAULT_SETTINGS, provider: 'speechify', enabledProviders: ['speechify'], voice: 'en-US/george' };
const voice = { provider: 'speechify' as const, voice: 'en-US/george', label: 'George' };
const CLIP: SynthesisResult = { audio: 'encoded', bytes: new Uint8Array([1, 2, 3]), mediaType: 'audio/mp4' };

/** As the earlier walk prepared it: a heading joined to its title, a list read as one sentence, and a cover with nothing to speak. */
const BOOK = [
  { id: 'one', section: 0, texts: ['Chapter 1:Nightmare Begins', 'It was late.'] },
  { id: 'two', section: 1, texts: ['The design has three advantages.', 'lower cost faster startup'] },
  { id: 'cover', section: 2, texts: [] as string[] },
];

const disk = new Map<string, StoredAudio>();
const at = (a: { document: string; voice: string; key: string }) => `${a.document}/${a.voice}/${a.key}`;
const files: AudioFiles = {
  lookup: async (address) => disk.get(at(address)) ?? null,
  present: async (audio) => disk.has(at(audio)),
  read: async () => null,
  write: async (document, v, text) => {
    const address = audioAddress(document, v, text);
    disk.set(at(address), { ...address, path: `${address.key}.audio`, format: 'encoded', size: 3, mediaType: 'audio/mp4' });
    return true;
  },
  remove: async (address) => { disk.delete(at(address)); },
  cleanTemporary: async () => {},
  removeDocumentFiles: async (document) => { for (const k of [...disk.keys()]) if (k.startsWith(`${document}/`)) disk.delete(k); },
};

let catalog: OfflineCatalog;
let runtime: typeof import('../../src/offline/runtime');
let stop: () => void = () => {};
beforeEach(() => stop());

/** A catalogue holding `BOOK` prepared and every sentence saved, by the walk `walk` (null: one that recorded none), and a fresh runtime started over it. */
async function open(walk: number | null) {
  disk.clear();
  mock.asked = [];
  const db = new DatabaseSync(':memory:');
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
  catalog = new OfflineCatalog(connection);
  await catalog.initialize();
  const repository = new OfflineRepository(catalog, files);
  await repository.recover();
  await repository.savePlan('book', {
    version: 2, sections: BOOK.map(({ id }) => ({ href: id, path: id })), preparedSections: [],
    chapters: BOOK.map(({ id, section }) => ({ id, title: id, depth: 0, parent: null, section, fragment: '', prepared: false, texts: [] })),
  });
  for (const { id, section, texts } of BOOK) {
    await repository.saveSection('book', section, [{ id, title: id, depth: 0, parent: null, texts }]);
    for (const text of texts) await repository.saveClip('book', voice, downloadSpeech(text, settings), CLIP, () => true);
  }
  // The download that saved them, finished: a chapter outside its voice's download shows nothing saved (#146).
  await catalog.saveTasks([{ id: 'done', document: 'book', voice, chapters: BOOK.map(({ id }) => id), state: 'done', error: null, failed: [] }]);
  await catalog.recordSpeechKeying(speechKeying(settings));
  if (walk !== null) await catalog.recordWalk(walk);
  mock.repository = repository;

  vi.resetModules();
  runtime = await import('../../src/offline/runtime');
  (await import('../../src/app/consent')).configureConsent({ kept: () => true, keep: () => {}, ask: async () => true });
  runtime.configureDownloads(settings);
  stop = runtime.startDownloads();
  await vi.waitFor(() => expect(runtime.downloadsReady()).toBe(true));
  runtime.requestPlan('book', 'Book');
  await vi.waitFor(() => expect(runtime.planOf('book')).not.toBeNull());
}

/** What the Download drawer and Manage downloads would draw now. */
async function shown() {
  runtime.requestProgress('book', voice);
  await new Promise((resolve) => setTimeout(resolve, 40));
  const chapters = runtime.planOf('book')!.chapters;
  const progress = runtime.chapterProgress('book', voice);
  const managed = new Map(chapters.map((c) => [c.id, marker(c, progress.get(c.id), undefined, true)]));
  return {
    downloaded: chapters.map((c) => c.id).filter((id) => downloadedChapters(chapters, progress).has(id)),
    manage: [...listedInManage(chapters, managed)],
    prepared: chapters.filter((c) => c.prepared).map((c) => c.id),
  };
}

it('keeps every Downloaded check of a catalogue this walk prepared', async () => {
  await open(BLOCK_WALK);
  expect(await shown()).toEqual({ downloaded: ['one', 'two'], manage: ['one', 'two'], prepared: ['one', 'two', 'cover'] });
});

it('asks again for every chapter with text that another walk prepared, and keeps its saved audio to delete', async () => {
  await open(null);
  expect(await shown()).toEqual({ downloaded: [], manage: ['one', 'two'], prepared: ['cover'] });
  expect(await catalog.preparedWalk()).toBe(BLOCK_WALK);
  expect(runtime.planOf('book')!.preparedSections).toEqual([2]);
  expect(disk.size).toBe(4);
});

it('downloads such a chapter again by asking the Provider only for the sentences whose text changed', async () => {
  await open(null);
  runtime.enqueue('book', voice, ['one']);
  await vi.waitFor(() => expect(runtime.preparationRequest()).not.toBeNull());
  const request = runtime.preparationRequest()!;
  expect(request.section).toBe(0);
  runtime.finishPreparation(request.token, [{ id: 'one', title: 'one', depth: 0, parent: null, texts: ['Chapter 1:\nNightmare Begins', 'It was late.'] }]);
  await vi.waitFor(async () => expect((await shown()).downloaded).toEqual(['one']));
  expect(mock.asked).toEqual(['Chapter 1:\nNightmare Begins']);
});

it('asks again only once: the next launch finds the walk recorded', async () => {
  await open(null);
  await shown();
  stop();
  vi.resetModules();
  runtime = await import('../../src/offline/runtime');
  runtime.configureDownloads(settings);
  const spy = vi.spyOn(catalog, 'prepareAgain');
  stop = runtime.startDownloads();
  await vi.waitFor(() => expect(runtime.downloadsReady()).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(spy).not.toHaveBeenCalled();
});
