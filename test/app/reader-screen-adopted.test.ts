import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { createLocator, readingPlaceAt, stampPlace, type DocumentId, type LibraryEntry, type ReadingPosition } from '../../src/core/document';
import { ReaderScreen } from '../../src/app/reader-screen';
import { ReadingHost } from '../../src/app/reading-host';
import { DEFAULT_SETTINGS } from '../../src/app/settings';

/**
 * Which place taken from another device the Reading hands `<ReadingView>` as
 * `adopted` (#55): the real screen inside the real shell-level host that holds
 * the Reading since #68, with their neighbours stubbed and `<ReadingView>`
 * replaced by a probe that records the props of every render.
 *
 * `adopted` means a place that arrived **while this book is open**, and
 * `<ReadingView>` moves the paused reading to it — through `resumeAt`, which asks
 * the renderer to display its section. Before the fix the screen handed over the
 * session's last adoption for the Document whenever it had one, so reopening a
 * book adopted at launch asked for the section a second time, on top of the
 * display `initialLocation` had already started (measured 2026-09-24).
 */

interface Seen {
  id: string;
  position: ReadingPosition | null;
  adopted: { at: number; position: ReadingPosition } | null;
}

const seen = vi.hoisted(() => [] as Seen[]);
/** Each open waits here until the test lets it finish, as reading a 34 MB file does. */
const opening = vi.hoisted(() => new Map<string, () => void>());
const shell = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('react-native', () => ({ StyleSheet: { create: <T,>(styles: T) => styles }, Text: 'Text', View: 'View' }));
vi.mock('../../src/app/reading-view', () => ({
  ReadingView: (props: { document: { identity: { id: string } }; position: Seen['position']; adopted: Seen['adopted'] }) => {
    seen.push({ id: props.document.identity.id, position: props.position, adopted: props.adopted });
    return null;
  },
}));
vi.mock('../../src/app/document', () => ({
  openDocument: (entry: { id: string; format: string; title: string }) =>
    new Promise((resolve) => {
      opening.set(entry.id, () => resolve({ identity: { id: entry.id, format: entry.format }, title: entry.title, base64: '' }));
    }),
}));
vi.mock('../../src/app/routes', () => ({ useShell: () => shell.current }));
vi.mock('../../src/app/appearance-sheet', () => ({ AppearanceSheet: () => null }));
vi.mock('../../src/app/reader-actions', () => ({ ReaderActions: () => null }));
vi.mock('../../src/app/controls', () => ({ HeaderButton: () => null, Note: () => null, INK: { page: '#fff', quiet: '#888' } }));
vi.mock('../../src/app/use-provider-secrets', () => ({ useProviderKey: () => ({ presence: { state: 'held' } }) }));
vi.mock('../../src/app/walkthrough-harness', () => ({ useHarnessCommands: () => {} }));
vi.mock('../../src/offline/runtime', () => ({ setReadingPlays: () => {} }));
// The bar's height (#67), as native-stack reports it on an iPhone 17: a 62-point
// status bar and a 54-point bar.
vi.mock('@react-navigation/elements', () => ({ useHeaderHeight: () => 116 }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }) }));
// The move itself is native; here the page is simply rendered where the host is.
vi.mock('react-native-teleport', () => ({ Portal: ({ children }: { children: unknown }) => children, PortalHost: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const A = ('sha256:' + 'a'.repeat(64)) as DocumentId;
const B = ('sha256:' + 'b'.repeat(64)) as DocumentId;

/** A place in the Document, stamped by `device` at `at`. */
function place(at: number, device: string, sentence: string): ReadingPosition {
  return stampPlace(readingPlaceAt(createLocator('epub', 'epubcfi(/6/4!/4/2)'), sentence, 0, sentence.length), { at, device });
}

function entry(id: DocumentId, position: ReadingPosition | null): LibraryEntry {
  return {
    id,
    format: 'epub',
    publicationId: null,
    publicationIdSource: 'none',
    title: id === A ? 'Book A' : 'Book B',
    position,
    voice: { provider: 'local', voice: 'af_bella' },
    stamp: { at: 1, device: 'iPhone-test' },
  };
}

/** The shell as `useShell` hands it out: the Library's entries and when each was last adopted, everything else inert. */
function library(entries: readonly LibraryEntry[], adoptedAt: Partial<Record<DocumentId, number>>) {
  shell.current = {
    settings: DEFAULT_SETTINGS,
    setSettings: () => {},
    secretRevisions: {},
    sync: { poke: () => {}, wait: async () => null, check: async () => ({ ok: true, folderMissing: false }) },
    library: {
      entries,
      adoptedAt,
      current: (id: DocumentId) => entries.find((one) => one.id === id) ?? null,
      opened: () => {},
      voiced: () => {},
      reached: () => {},
      retitled: () => {},
    },
  };
}

function reader() {
  let tree: ReactTestRenderer;
  const screen = (id: DocumentId) =>
    createElement(ReadingHost, null, createElement(ReaderScreen, { route: { params: { id } }, navigation: { setOptions: () => {} } } as never));
  return {
    async open(id: DocumentId) {
      await act(async () => {
        if (tree) tree.update(screen(id));
        else tree = create(screen(id));
      });
    },
    /** The Library changed — a sync adopted something — and the screen renders again. */
    async rerender(id: DocumentId) {
      await act(async () => { tree.update(screen(id)); });
    },
    /** The bytes have been read, so the Document is shown. */
    async opened(id: DocumentId) {
      await act(async () => { opening.get(id)!(); });
    },
    async close() {
      await act(async () => { tree.unmount(); });
    },
  };
}

describe('the place the Reader hands over as adopted (#55)', () => {
  it('hands over nothing at the open when the adoption came before the open', async () => {
    seen.length = 0;
    const desktop = place(2_000, 'desktop', 'The sentence the desktop stopped on.');
    // The launch sync took the desktop's place for this book; the owner opens it later.
    library([entry(A, desktop)], { [A]: 1_500 });
    const r = reader();
    await r.open(A);
    await r.opened(A);
    expect(seen.at(-1)).toEqual({ id: A, position: desktop, adopted: null });
    await r.close();
  });

  it('hands over a place taken while the Document was being opened', async () => {
    seen.length = 0;
    const phone = place(1_000, 'iPhone-test', 'The sentence the phone stopped on.');
    const desktop = place(2_000, 'desktop', 'The sentence the desktop stopped on.');
    library([entry(A, phone)], {});
    const r = reader();
    await r.open(A);
    // The sync the open pokes answers while the bytes are still being read.
    library([entry(A, desktop)], { [A]: 3_000 });
    await r.rerender(A);
    await r.opened(A);
    expect(seen.at(-1)).toEqual({ id: A, position: phone, adopted: { at: 3_000, position: desktop } });
    await r.close();
  });

  it('carries nothing across a hand-over to another Document adopted by the same sync', async () => {
    seen.length = 0;
    library([entry(A, place(1_000, 'iPhone-test', 'Where A stopped.')), entry(B, place(1_000, 'iPhone-test', 'Where B stopped.'))], {});
    const r = reader();
    await r.open(A);
    await r.opened(A);
    // One run takes the desktop's places for both books while A is open: A moves.
    const deskA = place(2_000, 'desktop', 'Where the desktop left A.');
    const deskB = place(2_000, 'desktop', 'Where the desktop left B.');
    library([entry(A, deskA), entry(B, deskB)], { [A]: 5_000, [B]: 5_000 });
    await r.rerender(A);
    expect(seen.at(-1)).toEqual({ id: A, position: expect.anything(), adopted: { at: 5_000, position: deskA } });

    // Then B is handed over in the same screen, and opens at the place already taken for it.
    await r.open(B);
    await r.opened(B);
    expect(seen.at(-1)).toEqual({ id: B, position: deskB, adopted: null });
    await r.close();
  });
});
