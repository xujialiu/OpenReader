import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PreparedChapter } from '../../src/offline/catalog';
import { testCatalog } from './sqlite';

let store: ReturnType<typeof testCatalog>;
const chapter = (texts = ['One.', 'Two.']): PreparedChapter => ({ id: 'one', title: 'One', depth: 0, parent: null, texts, keys: texts });
beforeEach(async () => {
  store = testCatalog();
  await store.catalog.initialize();
  await store.catalog.savePlan('book', { version: 2, sections: [{ path: 'one', href: 'one' }], preparedSections: [],
    chapters: [{ ...chapter([]), section: 0, prepared: false }] });
  await store.catalog.saveSection('book', 0, [chapter()]);
  for (const voice of ['A', 'B']) {
    await store.catalog.rememberVoice('book', voice, { provider: 'fish', voice, label: voice });
    for (const key of voice === 'A' ? ['One.', 'Two.'] : ['One.']) {
      await store.catalog.beginWrite('book', voice, key);
      await store.catalog.commitWrite({ document: 'book', voice, key, path: key, format: 'encoded', size: 3 });
    }
  }
});
afterEach(() => store.close());

it('summarizes last-known completeness separately from pending Recheck, and excludes unowned chapters', async () => {
  await store.catalog.prepareAgain(2, 1);
  expect(await store.catalog.summary('book', 'A', ['one'])).toEqual({
    chapters: 1, downloaded: 1, awaiting: 1, partial: 0, unprepared: 0, allSaved: 1, clips: 2, orphans: 0,
  });
  expect(await store.catalog.summary('book', 'B', ['one'])).toMatchObject({ downloaded: 0, awaiting: 1, partial: 1 });
  expect(await store.catalog.summary('book', 'A', [])).toMatchObject({ chapters: 0, downloaded: 0, awaiting: 0, clips: 2 });
});

it('keeps completeness and counts until Rechecked; unchanged checks stay, partial chapters remain partial', async () => {
  await store.catalog.prepareAgain(2, 1);
  expect(await store.catalog.progress('book', 'A')).toEqual([{ id: 'one', count: 2, complete: true }]);
  expect((await store.catalog.plan('book'))?.chapters[0]).toMatchObject({ prepared: true, recheck: true });
  expect(await store.catalog.recheckSections()).toEqual([{ document: 'book', section: 0 }]);
  await store.catalog.saveSection('book', 0, [chapter()]);
  expect(await store.catalog.recheckSections()).toEqual([]);
  expect(await store.catalog.progress('book', 'A')).toEqual([{ id: 'one', count: 2, complete: true }]);
  expect(await store.catalog.progress('book', 'B')).toEqual([{ id: 'one', count: 1, complete: false }]);
  expect(await store.catalog.recheckHolds('book', 'A')).toEqual([]);
});

it('commits lost completeness and the no-auto-download hold together, scoped to the Voice', async () => {
  await store.catalog.prepareAgain(2, 1);
  await store.catalog.saveSection('book', 0, [chapter(['One.', 'Two changed.'])]);
  expect(await store.catalog.progress('book', 'A')).toEqual([{ id: 'one', count: 1, complete: false }]);
  expect(await store.catalog.recheckHolds('book', 'A')).toEqual(['one']);
  // B was already incomplete; its unfinished Download keeps its authorization.
  expect(await store.catalog.recheckHolds('book', 'B')).toEqual([]);
  await store.catalog.saveTasks([]); // an unrelated stale task snapshot cannot clear the hold
  await store.catalog.initialize();
  expect(await store.catalog.recheckHolds('book', 'A')).toEqual(['one']);
  await store.catalog.allowRechecked('book', 'B', ['one']);
  expect(await store.catalog.recheckHolds('book', 'A')).toEqual(['one']);
  await store.catalog.allowRechecked('book', 'A', ['one']);
  expect(await store.catalog.recheckHolds('book', 'A')).toEqual([]);
});

it('rolls the check and hold back together when the section write fails', async () => {
  await store.catalog.prepareAgain(2, 1);
  const transact = store.connection.withExclusiveTransactionAsync.bind(store.connection);
  vi.spyOn(store.connection, 'withExclusiveTransactionAsync').mockImplementationOnce((run) => transact((tx) => run({
    ...tx, runAsync: async (sql, ...params) => {
      if (sql.includes('UPDATE plans SET prepared_sections')) throw new Error('disk full');
      return tx.runAsync(sql, ...params);
    },
  })));
  await expect(store.catalog.saveSection('book', 0, [chapter(['Changed.'])])).rejects.toThrow('disk full');
  expect(await store.catalog.progress('book', 'A')).toEqual([{ id: 'one', count: 2, complete: true }]);
  expect(await store.catalog.recheckHolds('book', 'A')).toEqual([]);
  expect(await store.catalog.recheckSections()).toHaveLength(1);
});

it('restores schema-2 invalidated text exactly once, but never marks an empty/unprepared chapter Downloaded', async () => {
  await store.connection.execAsync(`ALTER TABLE chapters DROP COLUMN recheck; PRAGMA user_version=2;
    UPDATE chapters SET prepared=0; UPDATE plans SET prepared_sections='[]';`);
  await store.catalog.initialize();
  expect((await store.catalog.plan('book'))?.chapters[0]).toMatchObject({ prepared: true, recheck: true });
  expect((await store.catalog.plan('book'))?.preparedSections).toEqual([0]);
  expect((await store.catalog.progress('book', 'A'))[0].complete).toBe(true);
  await store.catalog.saveSection('book', 0, [chapter(['Changed.'])]);
  await store.catalog.initialize();
  expect((await store.catalog.progress('book', 'A'))[0].complete).toBe(false);
});

it('does not schedule deleted audio or metadata-only chapters, and cleans holds on Document removal', async () => {
  await store.catalog.prepareAgain(2, 1);
  await store.catalog.saveSection('book', 0, [chapter(['Changed.'])]);
  await store.catalog.removeDocument('book');
  expect(await store.catalog.recheckSections()).toEqual([]);
  expect(await store.catalog.recheckHolds('book', 'A')).toEqual([]);
});
