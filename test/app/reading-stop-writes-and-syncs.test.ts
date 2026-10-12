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
 * A Reading that stops by itself, against one the owner pauses: is the place
 * written to the Library, and does it reach the Sync Folder?
 *
 * #155: every stop, not only the owner's Pause, is a sync moment (ADR 0031),
 * so `useReading`'s one stop exit writes the place and starts the run.
 *
 * Real: ReadingHost, ReadingView, useReading, the playback engine, useSync and
 * its Positions File transport, useLibrary, the shell's context.
 * Doubled: the page (the WebView bridge), the native audio graph, the Provider,
 * the Library's disk, the WebDAV folder, the Keychain, the lock screen module
 * and the view's own child controls. The clock is pinned.
 */
const world = vi.hoisted(() => ({
  page: null as null | { onBlocks?(blocks: readonly unknown[], section: { index: number; href: string; spine: number }): void },
  audio: {
    handlers: null as null | { onBufferEnded(id: string): void; onOutputLost(): void },
    queue: [] as string[],
  },
  provider: { refuse: null as string | null },
  remote: null as null | ((intent: 'play' | 'pause') => void),
  player: null as null | { playing: boolean; onPlay(): void },
  disk: { entries: [] as unknown[] },
  folder: { file: null as string | null },
  /** The shell's sync handle, for the one sync moment the shell itself owns: the app going to the background. */
  sync: null as null | { poke(trigger: string): void },
}));

vi.mock('react-native', () => ({
  AppState: { currentState: 'active' }, Platform: { OS: 'ios' }, StyleSheet: { create: <T,>(styles: T) => styles },
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
        returnToReading: nothing, setFollowOnly: nothing, releaseSelection: nothing, restart: () => null, readerProps: {},
      };
    },
  };
});
// The native audio graph: it queues buffers; the test ends the front one (a sentence heard) or loses the output.
vi.mock('../../src/playback/audio-graph', () => ({
  createAudioGraph: async (_first: unknown, handlers: NonNullable<typeof world.audio.handlers>) => {
    world.audio.handlers = handlers;
    let serial = 0;
    return {
      sampleRate: 24000,
      prepare: async (clip: { utterance: number }) => ({ clip, samples: new Float32Array(2400), duration: 0.1 }),
      enqueue: (audio: { duration: number }, gap: number, from = 0, to = audio.duration) => {
        const id = `b${serial++}`;
        world.audio.queue.push(id);
        return [{ bufferId: id, speech: to - from, gap, offset: from, duration: audio.duration }];
      },
      remove() {}, setRate() {}, resume() {}, pause() {}, clear() { world.audio.queue = []; }, dispose: async () => {},
    };
  },
}));
// The Provider: silence for every sentence, or a refusal for one.
vi.mock('../../src/offline/runtime', async () => {
  const { SynthesisError } = await vi.importActual<typeof import('../../src/core/providers/errors')>('../../src/core/providers/errors');
  return {
    hasSavedVoice: () => false, inventoryReady: () => true, inventoryError: () => null, planOf: () => null, chapterProgress: () => new Map(),
    releaseProgress: () => {}, requestProgress: () => {}, requestInventory: async () => {}, useDownloads: () => 0, setReadingPlays: () => {},
    offlineProvider: () => ({
      id: 'local', capabilities: { wordTimestamps: false }, listVoices: async () => [],
      synthesize: async (text: string) => {
        if (text === world.provider.refuse) throw new SynthesisError('network', 'local: the server did not answer');
        return { audio: 'pcm' as const, samples: new Uint8Array(4800), sampleRate: 24000 };
      },
    }),
  };
});
// The lock screen: the test presses its buttons through the handler the view gave.
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
vi.mock('../../src/app/folder-storage', () => ({
  openFolderStore: () => createFolderStore({ read: () => null, write: () => {}, id: () => 'folder-1' }),
}));
vi.mock('../../src/app/display-names', () => ({ displayNames: () => ({}), saveDisplayName: () => {} }));
vi.mock('../../src/app/document', () => ({
  addDocument: async () => { throw new Error('not in this test'); },
  openDocument: async (entry: { id: string; format: string; title: string }) => ({ identity: { id: entry.id, format: entry.format }, title: entry.title, base64: '' }),
}));
vi.mock('../../src/keys/store', () => ({ readSyncPassword: async () => ({ outcome: 'absent' }) }));
vi.mock('../../src/app/use-provider-secrets', () => ({ useProviderKey: () => ({ presence: { state: 'held' } }) }));
// The view's own children, which draw and decide nothing here.
vi.mock('../../src/app/body-text-sizes', () => ({ readBodyTextSize: () => null, writeBodyTextSize: () => {} }));
vi.mock('../../src/app/use-lookup', () => ({ useLookup: () => ({ selection: null, stopPronunciation() {} }) }));
vi.mock('../../src/app/lookup-drawer', () => ({ LookupDrawer: () => null }));
vi.mock('../../src/app/contents-sheet', () => ({ ContentsSheet: () => null }));
vi.mock('../../src/app/voice-sheet', () => ({ VoiceSheet: () => null }));
vi.mock('../../src/app/player', () => ({ Player: (props: NonNullable<typeof world.player>) => { world.player = props; return null; } }));
vi.mock('../../src/app/document-cover', () => ({ useDocumentCover: () => null }));
vi.mock('../../src/app/reader-file-system', () => ({ useReaderFileSystem: () => ({}) }));
vi.mock('../../src/app/use-voices', () => ({ useVoiceLists: () => ({ voicesOf: () => null, ask() {}, asking: () => false, note: null }) }));
vi.mock('../../src/app/voice-catalog', () => ({ knownVoice: () => null }));
vi.mock('../../src/app/controls', () => ({ INK: { page: '#fff', quiet: '#888' } }));
vi.mock('../../src/app/walkthrough-harness', () => ({ hlog() {}, probeScript: () => '', statusLine: () => '', useHarnessCommands() {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const DOCUMENT = ('sha256:' + 'd'.repeat(64)) as DocumentId;
const SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS, provider: 'local', enabledProviders: ['local'], voice: 'af_bella',
  sync: { url: 'https://dav.example/openreader', username: 'owner', enabled: true },
};
/** The Document's one section, a sentence to a paragraph. It is the whole spine, so its last sentence ends the Document. */
function blocks(texts: readonly string[]): ReportedBlock[] {
  return texts.map((text, at) => ({
    id: `0.${at}`, text, role: 'paragraph' as const, section: 's0.xhtml', sectionIndex: 0, cfi: `epubcfi(/6/2[s0]!/4/${2 * (at + 1)})`,
  }));
}
const TWO = ['Sentence one.', 'Sentence two.'];
const SIX = [...TWO, 'Sentence three.', 'Sentence four.', 'Sentence five.', 'Sentence six.'];

/** The WebDAV folder: one file, kept as the last upload left it. */
const WEBDAV: SyncDeps = {
  client: () => ({
    check: async () => {},
    download: async () => { if (world.folder.file === null) throw new WebDAVError('not-found', 'no file', 404); return world.folder.file; },
    upload: async (_name: string, text: string) => { world.folder.file = text; },
  }),
  now: () => Date.now(),
};

/** The sentence each store holds as the Document's Reading Position, or null. */
function held(): { library: string | null; folder: string | null } {
  const library = (world.disk.entries as LibraryEntry[]).find((entry) => entry.id === DOCUMENT)?.position?.anchor.exact ?? null;
  const items = world.folder.file === null ? [] : (JSON.parse(world.folder.file) as { items: { id: string; anchor: { exact: string } }[] }).items;
  return { library, folder: items.find((item) => item.id === DOCUMENT)?.anchor.exact ?? null };
}

function Open() {
  const { show } = useHeldReading();
  useEffect(() => { show(DOCUMENT); }, [show]);
  return null;
}
/** What `shell.tsx` holds for every screen: the Library, the sync transport and the settings, in the real context. */
function ShellProbe() {
  const library = useLibrary();
  const { sync, last } = useSync(SETTINGS, library, WEBDAV);
  useEffect(() => { world.sync = sync; }, [sync]);
  const value = useMemo<Shell>(
    () => ({ settings: SETTINGS, setSettings() {}, library, secretsWritten: 0, secretRevisions: {}, noteSecretWritten() {}, sync, syncLast: last }),
    [library, sync, last],
  );
  return createElement(ShellContext.Provider, { value }, createElement(ReadingHost, null, createElement(Open)));
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
};

/** The Document open, its section reported and Play pressed: the Reading plays, on the first sentence. */
async function playing(sentences: readonly string[] = TWO) {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(ShellProbe)); });
  await settle();
  await act(async () => { world.page!.onBlocks!(blocks(sentences), { index: 0, href: 's0.xhtml', spine: 1 }); });
  await settle();
  await act(async () => { world.player!.onPlay(); });
  await settle();
  return {
    /** The native queue finishes its front buffer: a sentence has been heard, `ms` later, and speech is on the next. */
    async hear(ms = 0) {
      vi.setSystemTime(Date.now() + ms);
      const front = world.audio.queue.shift();
      if (!front) throw new Error('nothing is queued to be heard');
      await act(async () => { world.audio.handlers!.onBufferEnded(front); });
      await settle();
    },
    async down() { await act(async () => { tree.unmount(); }); },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 9, 11, 9, 0, 0) });
  world.page = null; world.remote = null; world.player = null;
  world.audio.handlers = null; world.audio.queue = [];
  world.provider.refuse = null;
  world.disk.entries = [{
    id: DOCUMENT, format: 'epub', publicationId: null, publicationIdSource: 'none', title: 'A novel', position: null,
    voice: { provider: 'local', voice: 'af_bella' }, stamp: { at: 1, device: 'iPhone-test0001' },
  } satisfies LibraryEntry];
  world.folder.file = null; world.sync = null;
});
afterEach(() => { vi.useRealTimers(); });

describe('a Reading that stops on its second sentence: the place is written to the Library and reaches the Sync Folder', () => {
  const STOPPED = { library: 'Sentence two.', folder: 'Sentence two.' };

  it('control: the owner presses Pause on the lock screen', async () => {
    const reading = await playing();
    await reading.hear();
    await act(async () => { world.remote!('pause'); });
    await settle();
    expect(world.player!.playing).toBe(false);
    expect(held()).toEqual(STOPPED);
    await reading.down();
  });

  it('the output is lost: headphones out, or AirPods switched to another device', async () => {
    const reading = await playing();
    await reading.hear();
    await act(async () => { world.audio.handlers!.onOutputLost(); });
    await settle();
    expect(world.player!.playing).toBe(false);
    expect(held()).toEqual(STOPPED);
    await reading.down();
  });

  it('the last sentence of the Document is spoken', async () => {
    const reading = await playing();
    await reading.hear();
    await reading.hear();
    expect(world.player!.playing).toBe(false);
    expect(held()).toEqual(STOPPED);
    await reading.down();
  });

  it('the Provider refuses the next Clip', async () => {
    world.provider.refuse = 'Sentence two.';
    const reading = await playing();
    await reading.hear();
    expect(world.player!.playing).toBe(false);
    expect(held()).toEqual(STOPPED);
    await reading.down();
  });
});

describe('as the owner meets it: the phone is locked on the first sentence, and the Reading stops five sentences on', () => {
  it('the AirPods switch away on the sixth sentence, and the Sync Folder holds that sentence', async () => {
    const reading = await playing(SIX);
    // The phone is locked: the app goes to the background, and all `shell.tsx` does then is this poke.
    await act(async () => { world.sync!.poke('background'); });
    await settle();
    expect(held()).toEqual({ library: 'Sentence one.', folder: 'Sentence one.' });
    // Four seconds a sentence: the Library is written at most every ten (`reading-view.tsx`, POSITION_INTERVAL_MS).
    for (let heard = 0; heard < 5; heard++) await reading.hear(4_000);
    await act(async () => { world.audio.handlers!.onOutputLost(); });
    await settle();
    expect(world.player!.playing).toBe(false);
    expect(held()).toEqual({ library: 'Sentence six.', folder: 'Sentence six.' });
    await reading.down();
  });
});
