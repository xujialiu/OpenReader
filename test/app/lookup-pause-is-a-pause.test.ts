import { createElement, useEffect, useMemo } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentId, LibraryEntry } from '../../src/core/document';
import { createFolderStore } from '../../src/core/folders';
import { WebDAVError } from '../../src/core/sync/webdav';
import type { ReportedBlock } from '../../src/renderer/messages';
import { ReadingHost, useHeldReading } from '../../src/app/reading-host';
import { ShellContext, type Shell } from '../../src/app/routes';
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';
import { useLibrary } from '../../src/app/use-library';
import { useSync, type SyncDeps } from '../../src/app/use-sync';

/**
 * A Reading paused by a Word Lookup, against one paused from Now Playing, with
 * the Player collapsed.
 *
 * #216: the lookup's pause is the screen's own pause, so it re-opens the Player
 * and the navigation bar (design 0020), and like every stop it writes the place
 * and starts a sync (#155).
 *
 * Real: ReadingHost, ReadingView, useReading, useLookup, the playback engine,
 * useSync and its Positions File transport, useLibrary. Doubled: the page (the
 * WebView bridge, which keeps the selection callback useLookup gives it), the
 * native audio graph, the Provider, the Library's disk, the WebDAV folder, the
 * Keychain, the Now Playing module and the view's child controls (the Player
 * and the lookup Drawer record their props). The clock is pinned.
 */
const world = vi.hoisted(() => ({
  page: null as null | { onBlocks?(blocks: readonly unknown[], section: { index: number; href: string; spine: number }): void },
  audio: {
    handlers: null as null | { onPosition(p: number): void; onBufferEnded(id: string): void; onOutputLost(): void; onError(e: unknown): void },
    queue: [] as { id: string; utterance: number }[],
    serial: 0,
  },
  provider: { refuse: null as string | null },
  remote: null as null | ((intent: 'play' | 'pause') => void),
  player: null as null | { playing: boolean; collapsed: boolean; notes: { said: string }[]; onPlay(): void; onPause(): void; onCollapsed(collapsed: boolean): void },
  /** Whether the navigation bar is shown, as the host tells the Reader's screen (`HeldReading.chrome`). */
  bar: null as null | boolean,
  disk: { entries: [] as unknown[], folders: null as string | null },
  folder: { file: null as string | null, runs: [] as string[] },
  drawer: null as null | { close(resume?: boolean): void },
  select: null as null | ((m: unknown) => void), closed: 0,
}));

vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'ios' }, StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text', View: 'View', useColorScheme: () => 'light',
}));
vi.mock('@react-navigation/native', () => ({ createNavigationContainerRef: () => ({}) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }) }));
vi.mock('react-native-teleport', () => ({ Portal: ({ children }: { children: unknown }) => children, PortalHost: () => null }));
vi.mock('@epubjs-react-native/core', () => ({
  Reader: () => null,
  useReader: () => ({ getMeta: () => ({}), toc: [], injectJavascript() {}, currentLocation: null }),
}));
// The page: the WebView bridge. The test reports a section's Blocks as the page would.
vi.mock('../../src/renderer', async () => {
  const cursor = await vi.importActual<typeof import('../../src/renderer/cursor')>('../../src/renderer/cursor');
  return {
    ...cursor,
    useReaderBridge: (options: typeof world.page) => {
      world.page = options;
      const nothing = () => {};
      return {
        goTo: nothing, goToSection: nothing, browse: nothing, show: nothing, clock: { onClip: nothing, onPosition: nothing },
        setUtterances: nothing, setInset: nothing, setOpenPlayer: nothing, setLinePosition: nothing, setScrolling: nothing, setBar: nothing,
        setAppearance: nothing, setTheme: nothing, resumeFollowing: nothing, snapshot: nothing, hold: nothing, clear: nothing,
        returnToReading: nothing, setFollowOnly: nothing, releaseSelection: nothing, setLookupEnabled: nothing, closeLookup: () => { world.closed += 1; }, onSelection: (cb: (m: unknown) => void) => { world.select = cb; return () => {}; }, restart: () => null, readerProps: {},
      };
    },
  };
});
// The native audio graph: it queues buffers, and the test ends them or loses the output.
vi.mock('../../src/playback/audio-graph', () => ({
  createAudioGraph: async (_first: unknown, handlers: NonNullable<typeof world.audio.handlers>) => {
    world.audio.handlers = handlers;
    return {
      sampleRate: 24000,
      prepare: async (clip: { utterance: number }) => ({ clip, samples: new Float32Array(2400), duration: 0.1 }),
      enqueue: (audio: { clip: { utterance: number }; duration: number }, gap: number, from = 0, to = audio.duration) => {
        const id = `b${world.audio.serial++}`;
        world.audio.queue.push({ id, utterance: audio.clip.utterance });
        return [{ bufferId: id, speech: to - from, gap, offset: from, duration: audio.duration }];
      },
      remove() {}, setRate() {}, resume() {}, pause() {}, clear() { world.audio.queue = []; }, dispose: async () => {},
    };
  },
}));
// The Provider: silence for every sentence, or a refusal for one.
vi.mock('../../src/offline/runtime', async () => {
  const { SynthesisError: Refusal } = await vi.importActual<typeof import('../../src/core/providers/errors')>('../../src/core/providers/errors');
  return {
    hasSavedVoice: () => false, inventoryReady: () => true, inventoryError: () => null, planOf: () => null, chapterProgress: () => new Map(),
    releaseProgress: () => {}, requestProgress: () => {}, requestInventory: async () => {}, useDownloads: () => 0, setReadingPlays: () => {},
    offlineProvider: () => ({
      id: 'local', capabilities: { wordTimestamps: false }, listVoices: async () => [],
      synthesize: async (text: string) => {
        if (text === world.provider.refuse) throw new Refusal('network', 'local: the server did not answer');
        return { audio: 'pcm' as const, samples: new Uint8Array(4800), sampleRate: 24000 };
      },
    }),
  };
});
// Now Playing: the test presses its buttons through the handler the view gave.
vi.mock('../../src/now-playing', () => ({
  lockScreenPosition: () => {}, restateNowPlaying: () => {}, chapterOf: () => null,
  useNowPlaying: (now: { onIntent(intent: 'play' | 'pause'): void }) => { world.remote = now.onIntent; },
}));
// The Library's disk.
vi.mock('../../src/app/library', () => ({
  thisDevice: () => 'iPhone-test0001',
  readLibrary: () => ({ entries: world.disk.entries, problems: [], ignored: [], frozen: false, note: null }),
  migrateDocumentIds: (loaded: { entries: unknown[] }) => ({ entries: loaded.entries, note: null }),
  writeLibrary: (entries: unknown[]) => { world.disk.entries = entries; },
}));
vi.mock('../../src/app/folder-storage', () => ({ openFolderStore: () => {
  let n = 0;
  return createFolderStore({ read: () => world.disk.folders, write: (text) => { world.disk.folders = text; }, id: () => `folder-${++n}` });
} }));
vi.mock('../../src/app/display-names', () => ({ displayNames: () => ({}), saveDisplayName: () => {} }));
vi.mock('../../src/app/document', () => ({
  addDocument: async () => { throw new Error('not in this test'); },
  openDocument: async (entry: { id: string; format: string; title: string }) => ({ identity: { id: entry.id, format: entry.format }, title: entry.title, base64: '' }),
}));
vi.mock('../../src/keys/store', () => ({ readSyncPassword: async () => ({ outcome: 'absent' }) }));
vi.mock('../../src/app/use-provider-secrets', () => ({ useProviderKey: () => ({ presence: { state: 'held' } }) }));
// The view's own children, which draw and decide nothing here.
vi.mock('../../src/app/body-text-sizes', () => ({ readBodyTextSize: () => null, writeBodyTextSize: () => {} }));
vi.mock('../../src/app/lookup-drawer', () => ({ LookupDrawer: (props: { lookup: { close(resume?: boolean): void } }) => { world.drawer = props.lookup; return null; } }));
vi.mock('../../src/translation/pronunciation-audio', () => ({ playPronunciation: async () => {} }));
vi.mock('../../src/app/contents-sheet', () => ({ ContentsSheet: () => null }));
vi.mock('../../src/app/voice-sheet', () => ({ VoiceSheet: () => null }));
vi.mock('../../src/app/player', () => ({ Player: (props: NonNullable<typeof world.player>) => { world.player = props; return null; } }));
vi.mock('../../src/app/document-cover', () => ({ useDocumentCover: () => null }));
vi.mock('../../src/app/reader-file-system', () => ({ useReaderFileSystem: () => ({}) }));
vi.mock('../../src/app/use-voices', () => ({ useVoiceLists: () => ({ voicesOf: () => null, ask() {}, asking: () => false, note: null }) }));
vi.mock('../../src/app/voice-catalog', () => ({ knownVoice: () => null }));
vi.mock('../../src/app/controls', () => ({ INK: { page: '#fff', quiet: '#888' } }));
vi.mock('../../src/app/text-styles', () => ({ TEXT: { subhead: {} } }));
vi.mock('../../src/app/walkthrough-harness', () => ({ hlog() {}, probeScript: () => '', statusLine: () => '', useHarnessCommands() {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const DOCUMENT = ('sha256:' + 'd'.repeat(64)) as DocumentId;
const SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS, lookup: { ...DEFAULT_SETTINGS.lookup, enabled: true, pauseReading: true }, provider: 'local', enabledProviders: ['local'], voice: 'af_bella',
  sync: { url: 'https://dav.example/openreader', username: 'owner', enabled: true },
};
const SENTENCES = ['Sentence one.', 'Sentence two.', 'Sentence three.', 'Sentence four.', 'Sentence five.', 'Sentence six.', 'Sentence seven.', 'Sentence eight.'];
/** How long each sentence is taken to last. The interval between two writes of the place to the Library is ten seconds (`reading-view.tsx`). */
const SENTENCE_MS = 4_000;

/** One section's Blocks as the page reports them, a sentence to a paragraph. */
function blocks(texts: readonly string[]): ReportedBlock[] {
  return texts.map((text, at) => ({
    id: `0.${at}`, text, role: 'paragraph' as const, section: 's0.xhtml', sectionIndex: 0, cfi: `epubcfi(/6/2[s0]!/4/${2 * (at + 1)})`,
  }));
}

/** The WebDAV folder: one file, kept as the last upload left it. */
const WEBDAV: SyncDeps = {
  client: () => ({
    check: async () => {},
    download: async () => { if (world.folder.file === null) throw new WebDAVError('not-found', 'no file', 404); return world.folder.file; },
    upload: async (_name: string, text: string) => { world.folder.file = text; },
  }),
  now: () => Date.now(),
};

/** The sentence the Positions File in the folder holds for the Document, or null. */
function inTheFolder(): string | null {
  if (world.folder.file === null) return null;
  const items = (JSON.parse(world.folder.file) as { items: { id: string; anchor: { exact: string } }[] }).items;
  return items.find((item) => item.id === DOCUMENT)?.anchor.exact ?? null;
}
/** The sentence the Library on disk holds for the Document, or null. */
function onDisk(): string | null {
  return (world.disk.entries as LibraryEntry[]).find((entry) => entry.id === DOCUMENT)?.position?.anchor.exact ?? null;
}

const shell = { sync: null as null | Shell['sync'] };
function Open() {
  const { show, current } = useHeldReading();
  const chrome = current?.chrome ?? null;
  useEffect(() => { world.bar = chrome; }, [chrome]);
  useEffect(() => { show(DOCUMENT); }, [show]);
  return null;
}
/** What `shell.tsx` holds for every screen: the Library, the sync transport and the settings, in the real context. */
function ShellProbe() {
  const library = useLibrary();
  const { sync, last } = useSync(SETTINGS, library, WEBDAV);
  useEffect(() => { shell.sync = sync; }, [sync]);
  const value = useMemo<Shell>(
    () => ({ settings: SETTINGS, setSettings() {}, library, secretsWritten: 0, secretRevisions: {}, noteSecretWritten() {}, sync, syncLast: last }),
    [library, sync, last],
  );
  useEffect(() => { if (last) world.folder.runs.push(last.trigger); }, [last]);
  return createElement(ShellContext.Provider, { value }, createElement(ReadingHost, null, createElement(Open)));
}

const settle = async (turns = 6) => {
  for (let i = 0; i < turns; i++) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
};

/**
 * The Document open, its one section reported, Play pressed, one sync run (the
 * shell's `background` moment, so that the Sync Folder holds a place before
 * the pause), and `heard` sentences heard since.
 */
async function reading(options: { sentences?: readonly string[]; heard: number }) {
  const sentences = options.sentences ?? SENTENCES;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(ShellProbe)); });
  await settle();
  await act(async () => { world.page!.onBlocks!(blocks(sentences), { index: 0, href: 's0.xhtml', spine: 1 }); });
  await settle();
  await act(async () => { world.player!.onPlay(); });
  await settle();
  // One sync moment early in the Reading, the one `shell.tsx` makes when the app goes to the background.
  await act(async () => { shell.sync!.poke('background'); });
  await settle();
  const hear = async () => {
    vi.setSystemTime(Date.now() + SENTENCE_MS);
    const front = world.audio.queue.shift();
    if (!front) throw new Error('nothing is queued to be heard');
    await act(async () => { world.audio.handlers!.onBufferEnded(front.id); });
    await settle();
  };
  for (let i = 0; i < options.heard; i++) await hear();
  world.folder.runs.length = 0;
  return { hear, down: async () => { await act(async () => { tree.unmount(); }); } };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 9, 11, 9, 0, 0) });
  world.select = null; world.closed = 0; world.page = null; world.remote = null; world.player = null; world.bar = null;
  world.audio.handlers = null; world.audio.queue = []; world.audio.serial = 0;
  world.provider.refuse = null;
  world.disk.folders = null;
  world.disk.entries = [{
    id: DOCUMENT, format: 'epub', publicationId: null, publicationIdSource: 'none', title: 'A novel', position: null,
    voice: { provider: 'local', voice: 'af_bella' }, stamp: { at: 1, device: 'iPhone-test0001' },
  } satisfies LibraryEntry];
  world.folder.file = null; world.folder.runs = [];
});
afterEach(() => { vi.useRealTimers(); });

const state = () => `playing ${world.player!.playing} | collapsed ${world.player!.collapsed} | bar shown ${world.bar} | Library: ${onDisk()} | folder: ${inTheFolder()} | runs: ${JSON.stringify(world.folder.runs)}`;

describe('a Word Lookup pauses a Reading while the Player is collapsed', () => {
  /** Five sentences heard, the sixth being spoken, and the Player collapsed with its arrow. */
  async function collapsed() {
    const r = await reading({ heard: 5 });
    await act(async () => { world.player!.onCollapsed(true); });
    await settle();
    expect(world.player!.collapsed).toBe(true);
    expect(world.bar).toBe(false);
    return r;
  }
  it('control: the owner presses Pause in Now Playing', async () => {
    const r = await collapsed();
    await act(async () => { world.remote!('pause'); });
    await settle();
    console.log('Now Playing pause ->', state());
    expect.soft(world.player!.playing).toBe(false);
    expect.soft(world.player!.collapsed).toBe(false);
    expect.soft(world.bar).toBe(true);
    expect.soft(onDisk()).toBe('Sentence six.');
    expect.soft(world.folder.runs).toContain('pause');
    await r.down();
  });
  it('a long-pressed word pauses the Reading and the Drawer is closed', async () => {
    const r = await collapsed();
    // The page's first message for a long-pressed word, as the bridge hands it to useLookup.
    await act(async () => { world.select!({ text: 'word', expanded: false, selecting: true }); });
    await settle();
    // The owner swipes the Drawer away.
    await act(async () => { world.drawer!.close(); });
    await settle();
    console.log('lookup, Drawer closed ->', state());
    expect.soft(world.player!.playing).toBe(false);
    expect.soft(world.player!.collapsed).toBe(false);
    expect.soft(world.bar).toBe(true);
    expect.soft(onDisk()).toBe('Sentence six.');
    expect.soft(world.folder.runs).toContain('pause');
    // The owner locks the phone with the Reader still open.
    await act(async () => { shell.sync!.poke('background'); });
    await settle();
    console.log('then the phone is locked ->', state());
    expect.soft(inTheFolder()).toBe('Sentence six.');
    await r.down();
  });
});
