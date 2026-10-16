import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';
import type { ProviderId, SynthesisResult } from '../../src/core/providers/types';
import { audioAddress, audioKey, voiceKey } from '../../src/offline/catalog-keys';
import type { StoredAudio } from '../../src/offline/catalog';
import { OfflineRepository, type AudioFiles } from '../../src/offline/repository';
import type { OfflineVoice } from '../../src/offline/model';
import { narrationIdentity } from '../../src/offline/narration-voice';
import { speechKeying } from '../../src/offline/speech';
import { BLOCK_WALK } from '../../src/renderer/highlighter';
import { testCatalog } from './sqlite';

const mock = vi.hoisted(() => ({
  repository: null as OfflineRepository | null,
  synthesize: vi.fn<(model: string, text: string) => Promise<SynthesisResult>>(),
}));
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'ios' } }));
vi.mock('expo-file-system', () => ({ FileMode: { ReadOnly: 'r' } }));
vi.mock('../../modules/open-reader-offline', () => ({ offlineNative: {
  addListener: () => ({ remove() {} }), beginBackground: async () => true, endBackground: async () => {},
} }));
vi.mock('../../src/app/library', () => ({ documentFile: () => { throw new Error('Already prepared'); } }));
vi.mock('../../src/keys/store', () => ({ readProviderKey: async () => ({ outcome: 'found', secret: 'test-only' }), readGatewayHeaders: async () => ({ outcome: 'found', secret: '' }) }));
vi.mock('../../src/offline/database', () => ({ offlineRepository: async () => mock.repository! }));
vi.mock('../../src/core/providers/factory', () => ({
  createProvider: (id: ProviderId, configuration: { fish: { model: string } }) => ({
    id, capabilities: { wordTimestamps: false }, listVoices: async () => [],
    synthesize: (text: string) => mock.synthesize(id === 'fish' ? configuration.fish.model : id, text),
  }),
}));
const FREE = 's2.1-pro-free';
const voice: OfflineVoice = { provider: 'fish', voice: 'en/A', label: 'A long Voice name' };
const paid = { ...voice, model: 'drama-3' };
const settings = (model = FREE): AppSettings => ({ ...DEFAULT_SETTINGS, provider: 'fish', voice: voice.voice,
  enabledProviders: ['fish', 'speechify'], fish: { ...DEFAULT_SETTINGS.fish, model },
  sentencesAtOnce: { ...DEFAULT_SETTINGS.sentencesAtOnce, fish: 1 },
});
const clip = (model: string): SynthesisResult => ({ audio: 'encoded', bytes: new Uint8Array([1, 2, 3]), mediaType: 'audio/mp3', note: model });
const options = { voice: voice.voice, signal: new AbortController().signal };
let close = () => {};
let stop = () => {};
beforeEach(() => { vi.resetModules(); mock.synthesize.mockReset().mockImplementation(async (model) => clip(model)); });
afterEach(() => { stop(); close(); });

async function fixture() {
  const database = testCatalog();
  close = database.close;
  const { catalog } = database;
  await catalog.initialize();
  await catalog.recordSpeechKeying(speechKeying(settings()));
  await catalog.recordWalk(BLOCK_WALK);
  const audio = new Map<string, { row: StoredAudio; clip: SynthesisResult }>();
  const addressKey = (address: { document: string; voice: string; key: string }) => JSON.stringify([address.document, address.voice, address.key]);
  const files: AudioFiles = {
    lookup: async (address) => audio.get(addressKey(address))?.row ?? null,
    present: async (row) => audio.has(addressKey(row)),
    read: async (row) => audio.get(addressKey(row))?.clip ?? null,
    write: async (document, voice, text, result, wanted) => {
      if (!wanted()) return false;
      const address = audioAddress(document, voice, text);
      audio.set(addressKey(address), { row: { ...address, size: 3, format: 'encoded', path: 'test-audio' }, clip: result });
      return true;
    },
    remove: async (address) => { audio.delete(addressKey(address)); },
    cleanTemporary: async () => {},
    removeDocumentFiles: async (document) => { for (const [key, item] of audio) if (item.row.document === document) audio.delete(key); },
  };
  const repository = new OfflineRepository(catalog, files);
  mock.repository = repository;
  for (const document of ['book', 'other']) {
    const chapter = { id: 'a', title: 'A', depth: 0, parent: null, section: 0, texts: ['One.', 'Two.'], prepared: true };
    await repository.savePlan(document, { version: 2, sections: [{ href: 'a.xhtml', path: 'a.xhtml' }], chapters: [{ ...chapter, texts: [], prepared: false }] });
    await repository.saveSection(document, 0, [chapter], audioKey);
  }
  (await import('../../src/app/consent')).configureConsent({ kept: () => true, keep: () => {}, ask: async () => true });
  const runtime = await import('../../src/offline/runtime');
  runtime.configureDownloads(settings());
  return { ...database, repository, runtime, audio };
}
async function start(runtime: typeof import('../../src/offline/runtime')) {
  stop = runtime.startDownloads();
  await vi.waitFor(() => expect(runtime.downloadsReady()).toBe(true));
}

it('keeps a switch-away-and-back paused even before saved tasks have loaded', async () => {
  const { runtime, catalog } = await fixture();
  await catalog.saveTasks([{ id: 'old', document: 'book', voice, chapters: ['a'], state: 'queued', error: null, failed: [] }]);
  runtime.configureDownloads(settings('drama-3'));
  runtime.configureDownloads(settings());
  await start(runtime);
  expect(runtime.downloadTasks('book')[0].state).toBe('paused');
  expect(mock.synthesize).not.toHaveBeenCalled();
});

it('isolates both in-flight and memory audio by Model; switching back reuses the original', async () => {
  const { runtime } = await fixture();
  const free = runtime.offlineProvider('book', settings());
  const drama = runtime.offlineProvider('book', settings('drama-3'));
  const [first, same, second] = await Promise.all([
    free.synthesize('One.', options), free.synthesize('One.', options), drama.synthesize('One.', options),
  ]);
  expect(first.note).toBe(FREE);
  expect(same).toBe(first);
  expect(second.note).toBe('drama-3');
  expect(mock.synthesize).toHaveBeenCalledTimes(2);
  expect(await free.synthesize('One.', options)).toBe(first);
  expect(mock.synthesize).toHaveBeenCalledTimes(2);
});

it('keeps old free addresses through a real SQLite upgrade, scopes chapter deletion and deletes all Models together', async () => {
  const { repository, catalog, connection, runtime } = await fixture();
  await repository.saveClip('book', voice, 'One.', clip(FREE), () => true);
  // Simulate the installed v1 schema, with its existing voice row and payload.
  await connection.execAsync('ALTER TABLE voices DROP COLUMN model; PRAGMA user_version = 1;');
  await catalog.initialize();
  await catalog.initialize(); // idempotent on another open
  expect(voiceKey(voice)).toBe(voiceKey({ ...voice, model: FREE }));
  expect(voiceKey(voice)).not.toBe(voiceKey(paid));
  expect((await repository.readClip('book', { ...voice, model: FREE }, 'One.')).clip?.note).toBe(FREE);
  expect((await repository.readClip('book', paid, 'One.')).clip).toBeNull();
  await repository.saveClip('book', paid, 'One.', clip('drama-3'), () => true);
  expect(await repository.savedVoices('book')).toEqual(expect.arrayContaining([voice, paid]));
  await runtime.requestInventory('book');
  expect(runtime.hasSavedVoice('book', 'fish', voice.voice, FREE)).toBe(true);
  expect(runtime.hasSavedVoice('book', 'fish', voice.voice, 's2-pro')).toBe(false);
  expect(runtime.occupied('book', voice)).toBe(3);
  expect(runtime.occupied('book', paid)).toBe(3);
  expect(runtime.occupied('book')).toBe(6);
  await repository.deleteChapters('book', paid, ['a'], []);
  expect((await repository.readClip('book', paid, 'One.')).clip).toBeNull();
  expect((await repository.readClip('book', voice, 'One.')).clip?.note).toBe(FREE);
  await repository.saveClip('book', paid, 'One.', clip('drama-3'), () => true);
  await runtime.removeDownloads('book');
  expect(await repository.inventory('book')).toEqual([]);
});

it('pauses all Fish Downloads, files late replies under the old Model, keeps other Providers running and requires explicit resume', async () => {
  const { runtime, repository, catalog } = await fixture();
  let release!: () => void;
  mock.synthesize.mockImplementationOnce((model) => new Promise((resolve) => { release = () => resolve(clip(model)); }));
  await start(runtime);
  runtime.enqueue('book', voice, ['a']);
  await vi.waitFor(() => expect(mock.synthesize).toHaveBeenCalledTimes(1));
  runtime.enqueue('other', { ...voice, voice: 'en/B' }, ['a']);
  runtime.enqueue('other', { provider: 'speechify', voice: 'G', label: 'G' }, ['a']);
  runtime.configureDownloads(settings('drama-3'));
  const old = runtime.downloadTasks('book')[0];
  expect(old.state).toBe('paused');
  expect(runtime.downloadTasks('other').find((t) => t.voice.provider === 'fish')?.state).toBe('paused');
  expect(runtime.downloadTasks('other').find((t) => t.voice.provider === 'speechify')?.state).toBe('queued');
  runtime.toggleTask(old); runtime.toggleChapter(old, 'a');
  expect(old.state).toBe('paused'); // stale callback cannot resume a hidden Model
  release();
  await vi.waitFor(() => expect(runtime.downloadTasks('other').find((t) => t.voice.provider === 'speechify')?.state).toBe('done'));
  expect((await repository.readClip('book', voice, 'One.')).clip?.note).toBe(FREE);
  expect((await repository.readClip('book', paid, 'One.')).clip).toBeNull();
  expect(mock.synthesize.mock.calls.filter(([model]) => model === FREE)).toHaveLength(1);
  runtime.enqueue('book', paid, ['a']);
  await vi.waitFor(() => expect(runtime.downloadTasks('book').find((t) => t.voice.model === 'drama-3')?.state).toBe('done'));
  expect(runtime.downloadTasks('book')).toHaveLength(2);
  expect((await repository.readClip('book', paid, 'One.')).clip?.note).toBe('drama-3');
  runtime.configureDownloads(settings());
  expect(old.state).toBe('paused');
  await vi.waitFor(async () => expect((await catalog.readTasks())?.find((t) => t.id === old.id)?.state).toBe('paused'));
  // A fresh runtime reads the persisted pause; choosing the old Model resumes nothing.
  stop();
  vi.resetModules();
  (await import('../../src/app/consent')).configureConsent({ kept: () => true, keep: () => {}, ask: async () => true });
  const restarted = await import('../../src/offline/runtime');
  restarted.configureDownloads(settings());
  await start(restarted);
  const restored = restarted.downloadTasks('book').find((t) => narrationIdentity(t.voice) === narrationIdentity(voice))!;
  expect(restored.state).toBe('paused');
  restarted.toggleTask(restored);
  await vi.waitFor(() => expect(restored.state).toBe('done'));
  expect(mock.synthesize.mock.calls.filter(([model]) => model === FREE).map(([, text]) => text)).toEqual(['One.', 'Two.']);
});
