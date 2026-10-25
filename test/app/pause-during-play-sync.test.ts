import Module from 'node:module';

import { createElement, useEffect, useMemo } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentId, LibraryEntry } from '../../src/core/document';
import { createFolderStore } from '../../src/core/folders';
import { WebDAVError } from '../../src/core/sync/webdav';
import type { ReportedBlock } from '../../src/renderer/messages';
import { ReadingHost, useHeldReading } from '../../src/app/reading-host';
import { ShellContext, type Shell } from '../../src/app/routes';
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';
import { useLibrary } from '../../src/app/use-library';
import { useSync, WAIT_MS, type SyncDeps } from '../../src/app/use-sync';

/**
 * Play in Now Playing, then Pause before Play's sync has answered: does the
 * Reading stay paused?
 *
 * #160: a Pause during the wait takes the press of Play back, as it does in the
 * three other waits a press of Play can be in.
 *
 * Real: ReadingHost, ReadingView, useReading, the playback engine, useSync and
 * its Positions File transport, useLibrary, the shell's context, and
 * src/now-playing (useNowPlaying and intentOf), which is what turns a press in
 * Now Playing into the view's play or pause.
 * Doubled: the native Now Playing module, the page (the WebView bridge), the
 * native audio graph, the Provider, the Library's disk, the Sync Folder, the
 * Keychain and the view's own child controls. The clock and the timers are pinned.
 */
const world = vi.hoisted(() => ({
  page: null as null | { onBlocks?(blocks: readonly unknown[], section: { index: number; href: string; spine: number }): void },
  /** What the audio graph was last told: whether sound is coming out. */
  sounding: false,
  nowPlaying: {
    /** Whether the commands are claimed: the native module claims them in `show`, and not before. */
    claimed: false,
    listener: null as null | ((event: { command: 'play' | 'pause' | 'toggle' }) => void),
    /** The state Now Playing was last told. */
    playing: null as null | boolean,
  },
  player: null as null | { playing: boolean; buffering: boolean; onPlay(): void; onPause(): void },
  disk: { entries: [] as unknown[] },
  /**
   * The Sync Folder: while `slow`, a download waits in `waiting` until the test
   * lets it answer; while `unreachable`, it fails as a server that cannot be reached.
   */
  folder: { slow: false, unreachable: false, waiting: [] as (() => void)[] },
  /** The shell's sync handle, for a sync moment the test starts itself, such as the app coming to the foreground. */
  sync: null as null | { poke(trigger: string): void },
  /** What the network path monitor would tell the sync (#304). */
  connectivity: null as null | ((connected: boolean) => void),
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
        goTo: nothing, goToSection: nothing, prepareSection: nothing, browse: nothing, show: nothing, clock: { onClip: nothing, onPosition: nothing },
        setUtterances: nothing, setInset: nothing, setOpenPlayer: nothing, setLinePosition: nothing, setScrolling: nothing, setBar: nothing,
        setAppearance: nothing, setTheme: nothing, resumeFollowing: nothing, snapshot: nothing, hold: nothing, clear: nothing,
        returnToReading: nothing, setFollowOnly: nothing, setTapLock: nothing, releaseSelection: nothing, restart: () => null, readerProps: {},
      };
    },
  };
});
// The native audio graph: it records when the engine starts and stops the sound.
vi.mock('../../src/playback/audio-graph', () => ({
  createAudioGraph: async () => {
    let serial = 0;
    return {
      sampleRate: 24000,
      prepare: async (clip: { utterance: number }) => ({ clip, samples: new Float32Array(2400), duration: 0.1 }),
      enqueue: (audio: { duration: number }, gap: number, from = 0, to = audio.duration) =>
        [{ bufferId: `b${serial++}`, speech: to - from, gap, offset: from, duration: audio.duration }],
      remove() {}, setRate() {}, clear() {}, dispose: async () => {},
      resume() { world.sounding = true; },
      pause() { world.sounding = false; },
    };
  },
}));
// The Provider: silence for every sentence.
vi.mock('../../src/offline/runtime', () => ({
  hasSavedVoice: () => false, inventoryReady: () => true, inventoryError: () => null, planOf: () => null, chapterProgress: () => new Map(),
  releaseProgress: () => {}, requestProgress: () => {}, requestInventory: async () => {}, useDownloads: () => 0, prioritizeRecheck: () => {}, setReadingPlays: () => {},
  offlineProvider: () => ({
    id: 'local', capabilities: { wordTimestamps: false }, listVoices: async () => [],
    synthesize: async () => ({ audio: 'pcm' as const, samples: new Uint8Array(4800), sampleRate: 24000 }),
  }),
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
  identifyFile: async () => { throw new Error('not in this test'); },
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
vi.mock('../../src/app/use-voices', () => ({ useVoiceLists: () => ({ voicesOf: () => null, ask() {}, asking: () => false, noteOf: () => null }) }));
vi.mock('../../src/app/voice-catalog', () => ({ knownVoice: () => null }));
vi.mock('../../src/app/controls', () => ({ INK: { page: '#fff', quiet: '#888' } }));
vi.mock('../../src/app/walkthrough-harness', () => ({ hlog() {}, probeScript: () => '', statusLine: () => '', useHarnessCommands() {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/**
 * The native Now Playing module. `src/now-playing/index.ts` asks for it with a
 * `require` at its first use, which `vi.mock` does not reach, so Node's loader
 * hands this over instead. Like the Swift (`OpenReaderNowPlayingModule.swift`,
 * `show` calls `register()`), it claims the commands only once a reading is shown.
 */
const nativeNowPlaying = {
  addListener(_event: 'remoteCommand', listener: NonNullable<typeof world.nowPlaying.listener>) {
    world.nowPlaying.listener = listener;
    return { remove() { world.nowPlaying.listener = null; } };
  },
  show(reading: { playing: boolean }) { world.nowPlaying.claimed = true; world.nowPlaying.playing = reading.playing; },
  setPosition() {},
  hide() { world.nowPlaying.claimed = false; world.nowPlaying.playing = null; },
};
const loader = Module as unknown as { _load(request: string, ...rest: unknown[]): unknown };
const nodeLoad = loader._load;
loader._load = function (request: string, ...rest: unknown[]) {
  if (request.endsWith('modules/open-reader-now-playing')) return { default: nativeNowPlaying };
  return nodeLoad.call(this, request, ...rest);
};
afterAll(() => { loader._load = nodeLoad; });

const DOCUMENT = ('sha256:' + 'd'.repeat(64)) as DocumentId;
const SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS, provider: 'local', enabledProviders: ['local'], voice: 'af_bella',
  sync: { url: 'https://dav.example/openreader', username: 'owner', enabled: true },
};
const SENTENCE: ReportedBlock = {
  id: '0.0', text: 'Sentence one.', role: 'paragraph', section: 's0.xhtml', sectionIndex: 0, cfi: 'epubcfi(/6/2[s0]!/4/2)',
};

/** The Sync Folder: it holds no Positions File, and answers at once unless it is slow or cannot be reached. */
const WEBDAV: SyncDeps = {
  client: () => ({
    check: async () => {},
    download: async () => {
      if (world.folder.slow) await new Promise<void>((answer) => { world.folder.waiting.push(answer); });
      if (world.folder.unreachable) throw new WebDAVError('network', 'No reply from https://dav.example/openreader/ within 15 s.');
      throw new WebDAVError('not-found', 'no file', 404);
    },
    upload: async () => {},
  }),
  now: () => Date.now(),
  onConnectivity: (listener) => {
    world.connectivity = listener;
    return () => { world.connectivity = null; };
  },
};

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
/** A press in Now Playing (the Lock Screen, Control Centre, the Dynamic Island), as the native module reports it. */
async function press(command: 'play' | 'pause') {
  if (!world.nowPlaying.claimed) throw new Error('Now Playing has not been shown a Reading, so no press can reach the app.');
  await act(async () => { world.nowPlaying.listener!({ command }); });
  await settle();
}
/** What the owner would hear and see. */
const reading = () => ({ sounding: world.sounding, player: world.player!.playing, nowPlaying: world.nowPlaying.playing });
const PAUSED = { sounding: false, player: false, nowPlaying: false };
const PLAYING = { sounding: true, player: true, nowPlaying: true };
/** A press taken and waiting for its sync: nothing sounds yet, and the Player shows it starting (#304). */
const STARTING = { sounding: false, player: true, nowPlaying: false };

/** A Reading that has spoken and was paused from Now Playing, with a Sync Folder that has turned slow. */
let tree: ReactTestRenderer | null = null;
async function pausedWithSlowFolder() {
  await act(async () => { tree = create(createElement(ShellProbe)); });
  await settle();
  await act(async () => { world.page!.onBlocks!([SENTENCE], { index: 0, href: 's0.xhtml', spine: 1 }); });
  await settle();
  await act(async () => { world.player!.onPlay(); });
  await settle();
  await press('pause');
  expect(reading()).toEqual(PAUSED);
  world.folder.slow = true;
}
async function folderAnswers() {
  world.folder.slow = false;
  for (const answer of world.folder.waiting.splice(0)) answer();
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: Date.UTC(2026, 9, 11, 9, 0, 0) });
  world.page = null; world.player = null; world.sounding = false;
  world.nowPlaying.claimed = false; world.nowPlaying.listener = null; world.nowPlaying.playing = null;
  world.disk.entries = [{
    id: DOCUMENT, format: 'epub', publicationId: null, publicationIdSource: 'none', title: 'A novel', position: null,
    voice: { provider: 'local', voice: 'af_bella' }, stamp: { at: 1, device: 'iPhone-test0001' },
  } satisfies LibraryEntry];
  world.folder.slow = false; world.folder.unreachable = false; world.folder.waiting.length = 0;
  world.sync = null; world.connectivity = null;
});
afterEach(async () => {
  await act(async () => { tree?.unmount(); });
  tree = null;
  vi.useRealTimers();
});

describe('Play in Now Playing, with a Sync Folder that takes a moment to answer', () => {
  it('nothing sounds while Play waits for its sync, the Player shows the press as starting at once (#304), and the Reading starts when the folder answers', async () => {
    await pausedWithSlowFolder();
    await press('play');
    expect(world.folder.waiting).toHaveLength(1);
    expect(reading()).toEqual(STARTING);
    expect(world.player!.buffering).toBe(true);
    await folderAnswers();
    expect(reading()).toEqual(PLAYING);
  });

  it("the Player's own Play shows the press at once too, and its Pause takes the press back (#304)", async () => {
    await pausedWithSlowFolder();
    await act(async () => { world.player!.onPlay(); });
    await settle();
    expect(reading()).toEqual(STARTING);
    await act(async () => { world.player!.onPause(); });
    await settle();
    expect(reading()).toEqual(PAUSED);
    expect(world.player!.buffering).toBe(false);
    await folderAnswers();
    expect(reading()).toEqual(PAUSED);
  });

  it('a Pause pressed before the folder answers leaves the Reading paused once it does', async () => {
    await pausedWithSlowFolder();
    await press('play');
    await press('pause');
    expect(world.folder.waiting).toHaveLength(1);
    expect(reading()).toEqual(PAUSED);
    await folderAnswers();
    expect(reading()).toEqual(PAUSED);
  });

  it('a Pause pressed before the folder answers leaves the Reading paused when the wait runs out instead', async () => {
    await pausedWithSlowFolder();
    await press('play');
    await press('pause');
    await act(async () => { vi.advanceTimersByTime(WAIT_MS - 1); });
    await settle();
    expect(reading()).toEqual(PAUSED);
    await act(async () => { vi.advanceTimersByTime(1); });
    await settle();
    expect(reading()).toEqual(PAUSED);
  });
});

describe('Play when the Sync Folder has just shown it cannot be reached (#304)', () => {
  /** A sync moment the app takes by itself, such as coming to the foreground, against a server that does not answer. */
  async function aRunFindsTheServerUnreachable() {
    world.folder.slow = false;
    world.folder.unreachable = true;
    await act(async () => { world.sync!.poke('foreground'); });
    await settle();
    // From here on its requests hang, as they did on the owner's phone.
    world.folder.unreachable = false;
    world.folder.slow = true;
  }

  it('after a run that could not reach the server, Play starts the Reading at once, and still asks the folder behind it', async () => {
    await pausedWithSlowFolder();
    await aRunFindsTheServerUnreachable();
    await press('play');
    expect(reading()).toEqual(PLAYING);
    expect(world.folder.waiting).toHaveLength(1);
  });

  it('with a run already out at the server for as long as Play would wait, Play starts the Reading at once', async () => {
    await pausedWithSlowFolder();
    await act(async () => { world.sync!.poke('foreground'); });
    await settle();
    expect(world.folder.waiting).toHaveLength(1);
    await act(async () => { vi.advanceTimersByTime(WAIT_MS); });
    await press('play');
    expect(reading()).toEqual(PLAYING);
  });

  it('control: with a run out at the server for less than that, Play waits for its sync', async () => {
    await pausedWithSlowFolder();
    await act(async () => { world.sync!.poke('foreground'); });
    await settle();
    await act(async () => { vi.advanceTimersByTime(WAIT_MS - 500); });
    await press('play');
    expect(reading()).toEqual(STARTING);
  });

  it('once a run has reached the server again, Play waits for its sync again', async () => {
    await pausedWithSlowFolder();
    await aRunFindsTheServerUnreachable();
    // The network is back: the run behind the next Play gets through.
    world.folder.slow = false;
    await press('play');
    expect(reading()).toEqual(PLAYING);
    await press('pause');
    world.folder.slow = true;
    await press('play');
    expect(reading()).toEqual(STARTING);
  });

  it('a minute after the failure, Play waits for its sync again', async () => {
    await pausedWithSlowFolder();
    await aRunFindsTheServerUnreachable();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    await press('play');
    expect(reading()).toEqual(STARTING);
  });

  it('when the phone reports its network back, Play waits for its sync again', async () => {
    await pausedWithSlowFolder();
    await aRunFindsTheServerUnreachable();
    await act(async () => { world.connectivity!(false); });
    await act(async () => { world.connectivity!(true); });
    await press('play');
    expect(reading()).toEqual(STARTING);
  });
});
