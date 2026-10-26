import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { File } from 'expo-file-system';

import { asDocumentId, createLocator, readingPositionAt, type LibraryEntry } from '../../src/core/document';
import { createFolderStore } from '../../src/core/folders';
import { importDocument } from '../../src/app/import-document';
import { useLibrary, type Library } from '../../src/app/use-library';

const disk = vi.hoisted(() => ({
  entries: [] as LibraryEntry[], full: false, note: null as string | null,
  alert: vi.fn(), identify: vi.fn(),
}));
vi.mock('expo-file-system', () => ({ File: class { name = 'new.epub'; } }));
vi.mock('react-native', () => ({ Alert: { alert: disk.alert } }));
vi.mock('../../src/app/document', () => ({ identifyFile: disk.identify, keepFile: vi.fn() }));
vi.mock('../../src/app/display-names', () => ({ displayNames: () => ({}), saveDisplayName: vi.fn(), forgetDisplayName: vi.fn() }));
vi.mock('../../src/app/library', () => ({
  thisDevice: () => 'test-phone',
  readLibrary: () => ({ entries: disk.entries, problems: [], ignored: [], frozen: false, note: disk.note }),
  migrateDocumentIds: (loaded: { entries: LibraryEntry[] }) => ({ entries: loaded.entries, note: null }),
  writeLibrary: (entries: LibraryEntry[]) => {
    if (disk.full) throw new Error('No space left');
    disk.entries = entries;
  },
}));
vi.mock('../../src/app/folder-storage', () => ({ openFolderStore: () => createFolderStore({
  read: () => null, write: () => {}, id: () => 'folder',
}) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const id = asDocumentId(`sha256:${'a'.repeat(64)}`)!;
const other = asDocumentId(`sha256:${'b'.repeat(64)}`)!;
const place = (text: string) => readingPositionAt(createLocator('epub', 'epubcfi(/6/2!/4/4)'), text, 0, text.length, { at: 1, device: 'phone' });
const entry: LibraryEntry = {
  id, format: 'epub', publicationId: null, publicationIdSource: 'none', title: 'Existing Document',
  position: place('First sentence.'), stamp: { at: 1, device: 'phone' },
};
const message = '“Refused.epub” was not added: not an EPUB.';
const launchWarning = '1 entry in the Library file could not be read and is not shown.';
const trees: ReactTestRenderer[] = [];

async function mount() {
  let value!: Library;
  function Probe() { value = useLibrary(); return null; }
  await act(async () => { trees.push(create(createElement(Probe))); });
  return { get library() { return value; } };
}
beforeEach(() => {
  disk.entries = [entry]; disk.full = false; disk.note = null;
  disk.alert.mockReset(); disk.identify.mockReset();
  disk.identify.mockResolvedValue({ identity: { ...entry, id: other }, title: 'Another Document' });
});
afterEach(async () => { await act(async () => { for (const tree of trees.splice(0)) tree.unmount(); }); });

describe('Library note ownership (#179)', () => {
  it('retains a reported failure after a playing Reading saves a new position', async () => {
    const app = await mount();
    await act(async () => { app.library.report(message); });
    await act(async () => { app.library.reached(id, place('Second sentence.')); });
    expect(disk.entries[0].position?.anchor.exact).toBe('Second sentence.');
    expect(app.library.note).toBe(message);
  });

  it('retains it when sync adopts a newer position', async () => {
    const app = await mount();
    await act(async () => { app.library.report(message); });
    await act(async () => {
      app.library.adopt([{ ...app.library.positionsItems()[0], anchor: { exact: 'Desktop sentence.', prefix: '', suffix: '' }, stamp: { at: 10, device: 'desktop' } }]);
    });
    expect(disk.entries[0].position?.anchor.exact).toBe('Desktop sentence.');
    expect(app.library.note).toBe(message);
  });

  it('retains launch warnings through unrelated writes', async () => {
    disk.note = launchWarning;
    const app = await mount();
    await act(async () => { app.library.heard(id); });
    expect(app.library.note).toBe(launchWarning);
  });

  it('clears a write failure after a successful write (control)', async () => {
    const app = await mount();
    disk.full = true;
    await act(async () => { app.library.reached(id, place('Second sentence.')); });
    expect(app.library.note).toContain('No space left');
    disk.full = false;
    await act(async () => { app.library.reached(id, place('Third sentence.')); });
    expect(app.library.note).toBeNull();
  });

  it('restores the reported note after a write failure recovers instead of swallowing it', async () => {
    const app = await mount();
    await act(async () => { app.library.report(message); });
    disk.full = true;
    await act(async () => { app.library.heard(id); });
    expect(app.library.note).toContain('No space left');
    expect(app.library.dismissNote).toBeNull();
    disk.full = false;
    await act(async () => { app.library.heard(id); });
    expect(app.library.note).toBe(message);
  });

  it('clears only the report that the successful operation set out to resolve', async () => {
    const app = await mount();
    await act(async () => { app.library.report(message, 'import'); });
    const deletionSucceeded = app.library.beginOperation('delete');
    await act(async () => { deletionSucceeded(); });
    expect(app.library.note).toBe(message);
    const importSucceeded = app.library.beginOperation('import');
    await act(async () => { importSucceeded(); });
    expect(app.library.note).toBeNull();
  });

  it('does not let a stale success clear a newer failure of the same kind', async () => {
    const app = await mount();
    await act(async () => { app.library.report(message, 'import'); });
    const oldSuccess = app.library.beginOperation('import');
    await act(async () => { app.library.report('Another import failed.', 'import'); });
    await act(async () => { oldSuccess(); });
    expect(app.library.note).toBe('Another import failed.');
  });

  it('requires explicit dismissal of a launch warning, even through a later operation report', async () => {
    disk.note = launchWarning;
    const app = await mount();
    const complete = app.library.beginOperation('import');
    await act(async () => { complete(); });
    expect(app.library.note).toBe(launchWarning);
    await act(async () => { app.library.report(message, 'import'); });
    const retryComplete = app.library.beginOperation('import');
    await act(async () => { retryComplete(); });
    expect(app.library.note).toBe(launchWarning);
    expect(app.library.dismissNote).toBeTypeOf('function');
    await act(async () => { app.library.dismissNote?.(); });
    expect(app.library.note).toBeNull();
  });

  it('dismisses the visible report but not a newer one after a delayed press', async () => {
    const app = await mount();
    await act(async () => { app.library.report(message); });
    const dismiss = app.library.dismissNote;
    expect(dismiss).toBeTypeOf('function');
    await act(async () => { app.library.report('A newer failure.'); });
    await act(async () => { dismiss?.(); });
    expect(app.library.note).toBe('A newer failure.');
    await act(async () => { app.library.dismissNote?.(); });
    expect(app.library.note).toBeNull();
  });

  it('clears a prior import failure through a successful real import', async () => {
    const app = await mount();
    await act(async () => { app.library.report(message, 'import'); });
    const opened = vi.fn();
    await act(async () => { await importDocument(app.library, new File('new.epub'), { move: false }, opened); });
    expect(opened).toHaveBeenCalledWith(other);
    expect(app.library.note).toBeNull();
  });

  it('does not clear a deletion failure through a successful import', async () => {
    const app = await mount();
    await act(async () => { app.library.report('Deletion stopped.', 'delete'); });
    await act(async () => { await importDocument(app.library, new File('new.epub'), { move: false }, vi.fn()); });
    expect(app.library.note).toBe('Deletion stopped.');
  });

  it('does not clear an import failure when a duplicate is cancelled', async () => {
    disk.identify.mockResolvedValue({ identity: entry, title: entry.title });
    disk.alert.mockImplementation((_title, _message, buttons) => buttons[0].onPress());
    const app = await mount();
    await act(async () => { app.library.report(message, 'import'); });
    await act(async () => { await importDocument(app.library, new File('again.epub'), { move: false }, vi.fn()); });
    expect(app.library.note).toBe(message);
  });
});
