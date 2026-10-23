import { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, it, vi } from 'vitest';
import { OfflineCatalog, type SqlDatabase, type SqlSession } from '../../src/offline/catalog';
import { OfflineRepository } from '../../src/offline/repository';
import { audioFiles } from '../../src/offline/audio-files';
import { documentKey, voiceKey } from '../../src/offline/catalog-keys';

const fake = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), made: 0, exists: 0, deleted: 0 }));
vi.mock('expo-file-system', () => {
  const uriOf = (parts: ({ uri: string } | string)[]) => parts.map((p) => typeof p === 'string' ? p : p.uri).join('/');
  // Synchronous, as `exists` and `delete` are in expo-file-system 57 (ios/FileSystemModule.swift: Property, Function).
  class File {
    uri: string;
    constructor(...parts: ({ uri: string } | string)[]) { fake.made++; this.uri = uriOf(parts); }
    get exists() { fake.exists++; return fake.files.has(this.uri); }
    get size() { return fake.files.get(this.uri)?.length ?? 0; }
    write(value: string | Uint8Array) { fake.files.set(this.uri, typeof value === 'string' ? new TextEncoder().encode(value) : value); }
    async text() { return new TextDecoder().decode(fake.files.get(this.uri)); }
    async bytes() { return fake.files.get(this.uri); }
    delete() { fake.deleted++; fake.files.delete(this.uri); }
    moveSync(target: File) { const b = fake.files.get(this.uri)!; fake.files.set(target.uri, b); fake.files.delete(this.uri); this.uri = target.uri; }
  }
  class Directory {
    uri: string;
    constructor(...parts: ({ uri: string } | string)[]) { fake.made++; this.uri = uriOf(parts); }
    create() {}
    get exists() { return true; }
    delete() { for (const key of fake.files.keys()) if (key.startsWith(this.uri + '/')) fake.files.delete(key); }
  }
  return { File, Directory, Paths: { document: 'file://documents', availableDiskSpace: 1e12 } };
});
vi.mock('../../modules/open-reader-offline', () => ({
  offlineNative: {
    excludeFromBackup: () => {},
    writeJson: (uri: string, value: string) => fake.files.set(uri, new TextEncoder().encode(value)),
    compress: async (_input: string, output: string) => { fake.files.set(output, new Uint8Array([7, 8, 9])); },
  },
}));

const voice = { provider: 'fish' as const, voice: 'A', label: 'A' };
const pcm = { audio: 'pcm' as const, samples: new Uint8Array([0, 1, 0, 2]), sampleRate: 24000 };
const CHAPTERS = 4, PER = 95, CLIPS = CHAPTERS * PER; // 380 Clips, two files each
const book = Array.from({ length: CHAPTERS }, (_, c) => ({ id: `c${c}`, texts: Array.from({ length: PER }, (_, i) => `Chapter ${c} line ${i}.`) }));

function open() {
  const db = new DatabaseSync(':memory:');
  const session: SqlSession = {
    execAsync: async (sql) => { db.exec(sql); },
    runAsync: async (sql, ...params) => { db.prepare(sql).run(...params); },
    getAllAsync: async <T>(sql: string, ...params: (string | number | null)[]) => db.prepare(sql).all(...params) as T[],
  };
  // As on the phone: every catalogue call is a native round trip, so it settles on a later macrotask.
  const later = <T>(value: () => T) => new Promise<T>((resolve) => setTimeout(() => resolve(value()), 0));
  const connection: SqlDatabase = {
    execAsync: (sql) => later(() => { db.exec(sql); }),
    runAsync: (sql, ...params) => later(() => { db.prepare(sql).run(...params); }),
    getAllAsync: <T>(sql: string, ...params: (string | number | null)[]) => later(() => db.prepare(sql).all(...params) as T[]),
    withExclusiveTransactionAsync: async (run) => {
      await later(() => db.exec('BEGIN'));
      try { await run(session); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  return { db, catalog: new OfflineCatalog(connection) };
}
async function download(repository: OfflineRepository) {
  await repository.savePlan('book', { version: 2, sections: [{ href: '0', path: '0' }], preparedSections: [],
    chapters: book.map(({ id }) => ({ id, title: id, depth: 0, parent: null, section: 0, fragment: id, prepared: false, texts: [] })) });
  await repository.saveSection('book', 0, book.map(({ id, texts }) => ({ id, title: id, depth: 0, parent: null, texts })));
  for (const { texts } of book) for (const text of texts) await repository.saveClip('book', voice, text, pcm, () => true);
  expect((await repository.inventory('book'))[0].count).toBe(CLIPS);
}
beforeEach(() => { fake.files.clear(); });

it('Delete selected lets a timer run before the last selected Clip file is gone', async () => {
  const { db, catalog } = open();
  await catalog.initialize();
  const repository = new OfflineRepository(catalog, audioFiles);
  await repository.recover();
  await download(repository);

  fake.made = 0; fake.exists = 0; fake.deleted = 0;
  const seen: number[] = [];
  const watch = setInterval(() => { seen.push(fake.deleted); }, 1);
  await repository.deleteChapters('book', voice, book.map((c) => c.id), []);
  clearInterval(watch);
  db.close();

  const partWay = seen.filter((n) => n > 0 && n < CLIPS * 2).length;
  expect(fake.deleted).toBe(CLIPS * 2);
  expect(partWay).toBeGreaterThan(0);
}, 120_000);

it('after an interrupted deletion, a Clip of another Document asked for at launch is answered before the cleanup ends', async () => {
  const { db, catalog } = open();
  await catalog.initialize();
  const before = new OfflineRepository(catalog, audioFiles);
  await before.recover();
  await download(before);
  await before.saveClip('other', voice, 'A kept line.', pcm, () => true);
  // The marking transaction ran; the app was closed before the files went.
  await catalog.beginDelete(documentKey('book'), voiceKey(voice), book.map((c) => c.id), []);
  const marked = (await catalog.pendingDeletes()).length;

  fake.made = 0; fake.exists = 0; fake.deleted = 0;
  const repository = new OfflineRepository(catalog, audioFiles); // the next launch
  await repository.recover();
  const answer = await repository.readClip('other', voice, 'A kept line.');
  const atAnswer = { probes: fake.exists, deleted: fake.deleted };
  await repository.cleanup;
  const atEnd = { probes: fake.exists, deleted: fake.deleted };
  db.close();

  expect(marked).toBe(CLIPS);
  expect(answer.clip).not.toBeNull();
  expect(atAnswer.deleted).toBeLessThan(atEnd.deleted);
}, 120_000);
