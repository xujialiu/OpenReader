import { DatabaseSync } from 'node:sqlite';
import { createElement, Fragment, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { type AppSettings, DEFAULT_SETTINGS } from '../../src/app/settings';
import type { SynthesisResult } from '../../src/core/providers/types';
import { SEGMENTATION } from '../../src/core/segmenter/revision';
import { OfflineCatalog, type SqlDatabase, type SqlSession, type StoredAudio } from '../../src/offline/catalog';
import { audioAddress, audioKey } from '../../src/offline/catalog-keys';
import { type AudioFiles, OfflineRepository } from '../../src/offline/repository';
import { downloadSpeech, speechKeying } from '../../src/offline/speech';
import { BLOCK_WALK } from '../../src/renderer/highlighter';

/**
 * A Download is written, then the owner turns "Remove enclosing brackets when
 * reading" off. The sentences it saved are named by the Speech Text the old
 * setting made (ADR 0028, design 0028): the chapter is no longer Downloaded.
 * The Download drawer is opened on that Document.
 *
 * Real: the offline runtime, the repository over a real SQLite catalogue, the
 * Download drawer's content (`DownloadContent`). Doubled: the Provider, the
 * audio files, the platform and the drawer's layout components, which render
 * their text only.
 */
const mock = vi.hoisted(() => ({ repository: null as unknown, settings: null as unknown, requests: 0 }));
vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'ios' },
  StyleSheet: { create: <T,>(styles: T) => styles }, Alert: { alert() {} },
  ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text', View: 'View',
}));
vi.mock('react-native-gesture-handler', () => ({ GestureDetector: ({ children }: { children: unknown }) => children }));
vi.mock('expo-file-system', () => ({ FileMode: { ReadOnly: 'r' } }));
vi.mock('../../modules/open-reader-offline', () => ({
  offlineNative: { addListener: () => ({ remove() {} }), beginBackground: async () => true, endBackground: async () => {} },
}));
vi.mock('../../src/app/library', () => ({ documentFile: () => { throw new Error('not here'); } }));
vi.mock('../../src/keys/store', () => ({
  readProviderKey: async () => ({ outcome: 'found', secret: 'k' }),
  readGatewayHeaders: async () => ({ outcome: 'found', secret: '' }),
}));
vi.mock('../../src/core/providers/factory', () => ({
  createProvider: () => ({
    id: 'speechify', capabilities: { wordTimestamps: true }, listVoices: async () => [],
    synthesize: async (): Promise<SynthesisResult> => {
      mock.requests++;
      return { audio: 'encoded', bytes: new Uint8Array([1, 2, 3]), mediaType: 'audio/mp4' };
    },
  }),
}));
vi.mock('../../src/offline/database', () => ({ offlineRepository: async () => mock.repository }));
vi.mock('../../src/app/routes', () => ({ useShell: () => ({ settings: mock.settings }) }));
vi.mock('../../src/app/controls', () => ({
  INK: { text: '#000', quiet: '#888', page: '#fff', attention: '#f00' },
  useAccent: () => ({ reading: '#00f', onMark: '#fff' }), useBorders: () => ({ quiet: '#ccc' }),
}));
vi.mock('../../src/app/download-ring', () => ({ DownloadRing: () => null }));
vi.mock('../../src/app/icon', () => ({ Icon: () => null }));
vi.mock('../../src/app/use-sweep', () => ({ useSweep: () => ({ list: { ref: null }, gesture: {}, guard: (action: unknown) => action }) }));
vi.mock('../../src/app/text-styles', () => ({ TEXT: new Proxy({}, { get: () => ({}) }) }));
vi.mock('../../src/app/drawer', () => ({
  DRAWER: { row: { textInset: 0, inset: 0 } },
  DrawerList: ({ data, renderItem }: { data: unknown[]; renderItem: (a: { item: unknown }) => unknown }) => data.map((item, index) => createElement(Fragment, { key: index }, renderItem({ item }) as ReactNode)),
  DrawerRow: ({ children }: { children: unknown }) => children,
  DrawerRowText: ({ children }: { children: unknown }) => children,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const settings: AppSettings = {
  ...DEFAULT_SETTINGS, provider: 'speechify', enabledProviders: ['speechify'], voice: 'v',
  sentencesAtOnce: { ...DEFAULT_SETTINGS.sentencesAtOnce, speechify: 2 },
};
const voice = { provider: 'speechify' as const, voice: 'v', label: 'V' };
const disk = new Map<string, StoredAudio>();
const at = (a: { document: string; voice: string; key: string }) => `${a.document}/${a.voice}/${a.key}`;
const files: AudioFiles = {
  lookup: async (a) => disk.get(at(a)) ?? null,
  present: async (a) => disk.has(at(a)),
  read: async () => null,
  write: async (document, v, text, _c, wanted) => {
    if (!wanted()) return false;
    const a = audioAddress(document, v, text);
    disk.set(at(a), { ...a, path: `${a.key}.audio`, format: 'encoded', size: 3, mediaType: 'audio/mp4' } as StoredAudio);
    return true;
  },
  remove: async (a) => { disk.delete(at(a)); },
  cleanTemporary: async () => {},
  removeDocumentFiles: async (d) => { for (const k of [...disk.keys()]) if (k.startsWith(`${d}/`)) disk.delete(k); },
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const texts = (node: unknown): string[] => {
  if (node === null || node === undefined) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(texts);
  const n = node as { children?: unknown };
  return texts(n.children);
};

it('the drawer says the selected chapters are downloaded, right under "0 chapters downloaded"', async () => {
  const db = new DatabaseSync(':memory:');
  const session: SqlSession = {
    execAsync: async (sql) => { db.exec(sql); },
    runAsync: async (sql, ...p) => { db.prepare(sql).run(...p); },
    getAllAsync: async <T,>(sql: string, ...p: (string | number | null)[]) => db.prepare(sql).all(...p) as T[],
  };
  const conn: SqlDatabase = { ...session, withExclusiveTransactionAsync: async (run) => { db.exec('BEGIN'); try { await run(session); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } } };
  const catalog = new OfflineCatalog(conn);
  await catalog.initialize();
  const repository = new OfflineRepository(catalog, files);
  await repository.recover();
  await catalog.recordSpeechKeying(speechKeying(settings));
  await catalog.recordSegmentation(SEGMENTATION);
  await catalog.recordWalk(BLOCK_WALK);
  mock.repository = repository;
  mock.settings = settings;
  const chapter = { id: 'c1', title: 'Chapter one', depth: 0, parent: null, section: 0, fragment: 'c1', prepared: false, texts: [] as string[] };
  await repository.savePlan('book', { version: 2, sections: [{ href: '0', path: '0' }], preparedSections: [], chapters: [chapter] });
  await repository.saveSection('book', 0, [{ ...chapter, texts: ['<Seven eta>.'] }], (t) => audioKey(downloadSpeech(t, settings)));
  (await import('../../src/app/consent')).configureConsent({ kept: () => true, keep: () => {}, ask: async () => true });
  const runtime = await import('../../src/offline/runtime');
  const { DownloadContent } = await import('../../src/app/download-sheet');
  runtime.configureDownloads(settings);
  const stop = runtime.startDownloads();
  await vi.waitFor(() => expect(runtime.downloadsReady()).toBe(true));
  runtime.requestPlan('book', 'Book');
  await vi.waitFor(() => expect(runtime.planOf('book')).not.toBeNull());

  const mount = async (shown: AppSettings) => {
    mock.settings = shown;
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(DownloadContent, { document: 'book', title: 'Book', voice, place: null, manage: false, onManage() {}, onSelectAll() {} }));
    });
    await act(async () => { await sleep(80); });
    return renderer;
  };

  // The owner downloads the chapter with the brackets setting on (the default).
  runtime.enqueue('book', voice, ['c1']);
  await vi.waitFor(() => expect(runtime.downloadTasks('book')[0]?.state).toBe('done'), { timeout: 3000 });
  let drawer = await mount(settings);
  const before = texts(drawer.toJSON());
  await act(async () => drawer.unmount());

  // Then turns the setting off: what is said is no longer what was saved (design 0028).
  const off = { ...settings, stripBrackets: false };
  runtime.configureDownloads(off);
  await act(async () => { await sleep(150); });
  drawer = await mount(off);
  const after = texts(drawer.toJSON());
  await act(async () => drawer.unmount());
  stop();
  db.close();

  // Control: while the chapter is Downloaded, the drawer has no state line at all.
  expect(before.join(' ')).toContain('1 chapter downloaded');
  expect(before.join(' ')).not.toContain('Selected chapters downloaded');
  expect(after.join(' ')).toContain('0 chapters downloaded');
  // The line under the count says the same as the count.
  expect(after.join(' ')).not.toContain('Selected chapters downloaded');
  expect(after.join(' ')).not.toContain('Resume all');
  expect(mock.requests).toBe(1); // A settings change updates coverage, never buys replacement audio.
}, 30_000);
