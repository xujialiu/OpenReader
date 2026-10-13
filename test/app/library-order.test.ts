import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { File } from 'expo-file-system';
import { asDocumentId, createLocator, readingPlaceAt, readingPositionAt, type DocumentId, type LibraryEntry } from '../../src/core/document';
import { createFolderStore } from '../../src/core/folders';
import { useLibrary, type Library } from '../../src/app/use-library';

/**
 * What moves a Document up the Library (#228): being added, being heard, and a
 * place heard on another device. Opening it, a place written without speech
 * (#96) and a rename leave it where it was.
 */

const disk = vi.hoisted(() => ({ entries: [] as LibraryEntry[], identify: vi.fn() }));
vi.mock('expo-file-system', () => ({ File: class { name = 'new.epub'; } }));
vi.mock('react-native', () => ({ Alert: { alert: vi.fn() } }));
vi.mock('../../src/app/document', () => ({ addDocument: disk.identify }));
vi.mock('../../src/app/display-names', () => ({ displayNames: () => ({}), saveDisplayName: vi.fn() }));
vi.mock('../../src/app/library', () => ({
  thisDevice: () => 'test-phone',
  readLibrary: () => ({ entries: disk.entries, problems: [], ignored: [], frozen: false, note: null }),
  migrateDocumentIds: (loaded: { entries: LibraryEntry[] }) => ({ entries: loaded.entries, note: null }),
  writeLibrary: (entries: LibraryEntry[]) => { disk.entries = entries; },
}));
vi.mock('../../src/app/folder-storage', () => ({ openFolderStore: () => {
  let text: string | null = null;
  let n = 0;
  return createFolderStore({ read: () => text, write: (next) => { text = next; }, id: () => `folder-${++n}` });
} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const A = asDocumentId(`sha256:${'a'.repeat(64)}`)!;
const B = asDocumentId(`sha256:${'b'.repeat(64)}`)!;
const C = asDocumentId(`sha256:${'c'.repeat(64)}`)!;
const locator = createLocator('epub', 'epubcfi(/6/8!/4/2/4)');

function entry(id: DocumentId, at: number): LibraryEntry {
  return {
    id, format: 'epub', publicationId: null, publicationIdSource: 'none', title: `Book ${id.slice(7, 8)}`,
    position: readingPositionAt(locator, 'Saved sentence.', 0, 15, { at, device: 'test' }),
    voice: null, stamp: { at, device: 'test' },
  };
}

async function mount() {
  let library: Library;
  let renderer: ReactTestRenderer;
  function Probe() { library = useLibrary(); return null; }
  await act(async () => { renderer = create(createElement(Probe)); });
  return { get library() { return library!; }, unmount: () => act(async () => renderer!.unmount()) };
}

const order = (library: Library) => library.entries.map((one) => one.id);

beforeEach(() => {
  // A was heard last; B before it.
  disk.entries = [entry(A, 30), entry(B, 20)];
  disk.identify.mockReset();
  disk.identify.mockResolvedValue({ identity: { id: C, format: 'epub', publicationId: null, publicationIdSource: 'none' }, title: 'Book C' });
});

describe('what moves a Document up the Library (#228)', () => {
  it('puts a Document just added first', async () => {
    const mounted = await mount();
    await act(async () => { await mounted.library.add(new File('new.epub'), { move: false }); });
    expect(order(mounted.library)).toEqual([C, A, B]);
    await mounted.unmount();
  });

  it('has nothing that moves a Document for being opened', async () => {
    const mounted = await mount();
    expect('opened' in mounted.library).toBe(false);
    await mounted.unmount();
  });

  it('leaves a Document where it was when a place is written without speech, as a paused tap does (#96)', async () => {
    const mounted = await mount();
    await act(async () => { mounted.library.reached(B, readingPlaceAt(locator, 'Another sentence.', 0, 17)); });
    expect(order(mounted.library)).toEqual([A, B]);
    const b = mounted.library.current(B)!;
    expect(b.stamp).toEqual({ at: 20, device: 'test' });
    // The Reading Position itself moved, with its own Stamp (ADR 0031).
    expect(b.position!.anchor.exact).toBe('Another sentence.');
    expect(b.position!.stamp.at).toBeGreaterThan(20);
    await mounted.unmount();
  });

  it('leaves a Document where it was when it is renamed', async () => {
    const mounted = await mount();
    await act(async () => { mounted.library.rename(B, 'A new name'); });
    expect(order(mounted.library)).toEqual([A, B]);
    expect(mounted.library.current(B)!.stamp).toEqual({ at: 20, device: 'test' });
    expect(mounted.library.current(B)!.title).toBe('A new name');
    await mounted.unmount();
  });

  it('puts a Document heard first, stamped by this device, and writes it', async () => {
    const mounted = await mount();
    const before = Date.now();
    await act(async () => { mounted.library.heard(B); });
    expect(order(mounted.library)).toEqual([B, A]);
    expect(mounted.library.current(B)!.stamp.device).toBe('test-phone');
    expect(mounted.library.current(B)!.stamp.at).toBeGreaterThanOrEqual(before);
    expect(disk.entries.map((one) => one.id)).toEqual([B, A]);
    await mounted.unmount();
  });

  it('still raises a Document to the time of a place heard on another device', async () => {
    const mounted = await mount();
    await act(async () => {
      mounted.library.adopt([{ id: B, format: 'epub', publicationId: null, locator: 'epubcfi(/6/8!/4/2/6)',
        anchor: { exact: 'Heard on the desktop.', prefix: '', suffix: '' }, stamp: { at: 40, device: 'desktop' } }]);
    });
    expect(order(mounted.library)).toEqual([B, A]);
    expect(mounted.library.current(B)!.stamp).toEqual({ at: 40, device: 'desktop' });
    await mounted.unmount();
  });
});
