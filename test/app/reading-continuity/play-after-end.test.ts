import { createElement, useEffect, useMemo } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentId, LibraryEntry } from '../../../src/core/document';
import { createFolderStore } from '../../../src/core/folders';
import type { ReportedBlock } from '../../../src/renderer/messages';
import { ReadingHost, useHeldReading } from '../../../src/app/reading-host';
import { ShellContext, type Shell } from '../../../src/app/routes';
import { DEFAULT_SETTINGS, type AppSettings } from '../../../src/app/settings';
import { useLibrary } from '../../../src/app/use-library';
import { useSync } from '../../../src/app/use-sync';

/**
 * Play pressed again after the last sentence of a Document has been spoken.
 *
 * Run at test/_repro/app-reading--play-after-book-end-silent/ (the relative
 * imports are three levels below the repository root).
 *
 * Real: ReadingHost, ReadingView, useReading, the playback engine, useSync (sync
 * is off), useLibrary, the shell's context.
 * Doubled: the page (the WebView bridge), the native audio graph, the Provider,
 * the Library's disk, the Keychain, the Now Playing module and the view's own
 * child controls (the Player and the Drawers). Timers and the clock are pinned.
 */
const world = vi.hoisted(() => ({
  page: null as null | {
    onBlocks?(blocks: readonly unknown[], section: { index: number; href: string; spine: number }): void;
    onTap?(utterance: number): void;
  },
  audio: {
    handlers: null as null | { onBufferEnded(id: string): void },
    /** The native queue: what was handed to it and has not been heard yet. */
    queue: [] as string[],
    /** Whether the engine last asked the native graph to resume (true) or to pause (false). */
    running: false,
    resumes: 0,
  },
  /** How many sentences the Provider was asked for. */
  asked: 0,
  restated: 0,
  /** Now Playing, which the Lock Screen and the headphones reach: what it is told, and the handler a press there calls. */
  remote: null as null | { playing: boolean; press(intent: 'play' | 'pause'): void },
  player: null as null | { playing: boolean; buffering: boolean; notes: readonly { said: string }[]; onPlay(): void },
  disk: { entries: [] as unknown[] },
  /** The Reading the host holds, as the Reading Button is told, and the Reader's way out. */
  held: null as null | { playing: boolean; buffering: boolean },
  leave: null as null | (() => void),
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
// The page: the WebView bridge. The test reports a section's Blocks, and taps a sentence, as the page would.
vi.mock('../../../src/renderer', async () => {
  const cursor = await vi.importActual<typeof import('../../../src/renderer/cursor')>('../../../src/renderer/cursor');
  return {
    ...cursor,
    useReaderBridge: (options: typeof world.page) => {
      world.page = options;
      const nothing = () => {};
      return {
        goTo: nothing, goToSection: nothing, prepareSection: nothing, browse: nothing, show: nothing, clock: { onClip: nothing, onPosition: nothing },
        setUtterances: nothing, setInset: nothing, setOpenPlayer: nothing, setLinePosition: nothing, setScrolling: nothing, setBar: nothing,
        setAppearance: nothing, setTheme: nothing, resumeFollowing: nothing, snapshot: nothing, hold: nothing, clear: nothing,
        returnToReading: nothing, setFollowOnly: nothing, releaseSelection: nothing, restart: () => null, readerProps: {},
      };
    },
  };
});
// The native audio graph: it queues what it is given, and the test ends the front of the queue (a sentence heard).
vi.mock('../../../src/playback/audio-graph', () => ({
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
      remove() {}, setRate() {},
      resume() { world.audio.running = true; world.audio.resumes++; },
      pause() { world.audio.running = false; },
      clear() { world.audio.queue = []; }, dispose: async () => {},
    };
  },
}));
// The Provider: silence for every sentence it is asked for.
vi.mock('../../../src/offline/runtime', () => ({
  hasSavedVoice: () => false, inventoryReady: () => true, inventoryError: () => null, planOf: () => null, chapterProgress: () => new Map(),
  releaseProgress: () => {}, requestProgress: () => {}, requestInventory: async () => {}, useDownloads: () => 0, setReadingPlays: () => {},
  offlineProvider: () => ({
    id: 'local', capabilities: { wordTimestamps: false }, listVoices: async () => [],
    synthesize: async () => {
      world.asked++;
      return { audio: 'pcm' as const, samples: new Uint8Array(4800), sampleRate: 24000 };
    },
  }),
}));
// Now Playing: the test presses its Play through the handler the view gave, and reads what it was told.
vi.mock('../../../src/now-playing', () => ({
  lockScreenPosition: () => {}, restateNowPlaying: () => { world.restated++; }, chapterOf: () => null,
  useNowPlaying: (now: { playing: boolean; onIntent(intent: 'play' | 'pause'): void }) => { world.remote = { playing: now.playing, press: now.onIntent }; },
}));
// The Library's disk.
vi.mock('../../../src/app/library', () => ({
  thisDevice: () => 'iPhone-test0001',
  readLibrary: () => ({ entries: world.disk.entries, problems: [], ignored: [], frozen: false, note: null }),
  migrateDocumentIds: (loaded: { entries: unknown[] }) => ({ entries: loaded.entries, note: null }),
  writeLibrary: (entries: unknown[]) => { world.disk.entries = entries; },
}));
vi.mock('../../../src/app/folder-storage', () => ({
  openFolderStore: () => createFolderStore({ read: () => null, write: () => {}, id: () => 'folder-1' }),
}));
vi.mock('../../../src/app/display-names', () => ({ displayNames: () => ({}), saveDisplayName: () => {} }));
vi.mock('../../../src/app/document', () => ({
  identifyFile: async () => { throw new Error('not in this test'); },
  openDocument: async (entry: { id: string; format: string; title: string }) => ({ identity: { id: entry.id, format: entry.format }, title: entry.title, base64: '' }),
}));
vi.mock('../../../src/keys/store', () => ({ readSyncPassword: async () => ({ outcome: 'absent' }) }));
vi.mock('../../../src/app/use-provider-secrets', () => ({ useProviderKey: () => ({ presence: { state: 'held' } }) }));
// The view's own children, which draw and decide nothing here. Each is doubled because it does not load under Node.
vi.mock('../../../src/app/body-text-sizes', () => ({ readBodyTextSize: () => null, writeBodyTextSize: () => {} }));
vi.mock('../../../src/app/use-lookup', () => ({ useLookup: () => ({ selection: null, stopPronunciation() {} }) }));
vi.mock('../../../src/app/lookup-drawer', () => ({ LookupDrawer: () => null }));
vi.mock('../../../src/app/contents-sheet', () => ({ ContentsSheet: () => null }));
vi.mock('../../../src/app/voice-sheet', () => ({ VoiceSheet: () => null }));
vi.mock('../../../src/app/player', () => ({ Player: (props: NonNullable<typeof world.player>) => { world.player = props; return null; } }));
vi.mock('../../../src/app/document-cover', () => ({ useDocumentCover: () => null }));
vi.mock('../../../src/app/reader-file-system', () => ({ useReaderFileSystem: () => ({}) }));
vi.mock('../../../src/app/use-voices', () => ({ useVoiceLists: () => ({ voicesOf: () => null, ask() {}, asking: () => false, noteOf: () => null }) }));
vi.mock('../../../src/app/voice-catalog', () => ({ knownVoice: () => null }));
vi.mock('../../../src/app/controls', () => ({ INK: { page: '#fff', quiet: '#888' } }));
vi.mock('../../../src/app/walkthrough-harness', () => ({ hlog() {}, probeScript: () => '', statusLine: () => '', useHarnessCommands() {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const DOCUMENT = ('sha256:' + 'd'.repeat(64)) as DocumentId;
const SETTINGS: AppSettings = { ...DEFAULT_SETTINGS, provider: 'local', enabledProviders: ['local'], voice: 'af_bella' };
const END = 'That was the last of this document. The reading has stopped at the end of the book.';
/** The whole Document: one section, which is the whole spine, holding one sentence. */
const BLOCKS: ReportedBlock[] = [{
  id: '0.0', text: 'The only sentence.', role: 'paragraph', section: 's0.xhtml', sectionIndex: 0, cfi: 'epubcfi(/6/2[s0]!/4/2)',
}];

function Open() {
  const { show, left, current } = useHeldReading();
  useEffect(() => { show(DOCUMENT); }, [show]);
  useEffect(() => {
    world.held = current ? { playing: current.playing, buffering: current.buffering } : null;
    world.leave = () => left(DOCUMENT);
  }, [current, left]);
  return null;
}
/** What `shell.tsx` holds for every screen: the Library, the sync transport and the settings, in the real context. */
function ShellProbe() {
  const library = useLibrary();
  // Sync is off in these settings. A client asked for anyway would be a network request, and the test would fail on it.
  const { sync, last } = useSync(SETTINGS, library, { client: () => { throw new Error('no network in this test'); }, now: () => Date.now() });
  const value = useMemo<Shell>(
    () => ({ settings: SETTINGS, setSettings() {}, library, secretsWritten: 0, secretRevisions: {}, noteSecretWritten() {}, sync, syncLast: last }),
    [library, sync, last],
  );
  return createElement(ShellContext.Provider, { value }, createElement(ReadingHost, null, createElement(Open)));
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
};
async function press(what: () => void) {
  await act(async () => { what(); });
  await settle();
}
/** Time passes, with nobody touching the phone. */
async function wait(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  await settle();
}
/** The native queue finishes its front: a sentence has been heard. */
async function hear() {
  const front = world.audio.queue.shift();
  if (!front) throw new Error('nothing is queued to be heard');
  await press(() => world.audio.handlers!.onBufferEnded(front));
}
/** What the owner is shown, and what the phone was asked to do. */
function shown() {
  return {
    button: world.player!.playing ? (world.player!.buffering ? 'Pause, with the spinner' : 'Pause') : 'Play',
    note: world.player!.notes.map((note) => note.said).join(' | ') || null,
    nowPlaying: world.remote!.playing ? 'playing' : 'paused',
    queued: world.audio.queue.length,
    audioRunning: world.audio.running,
    asked: world.asked,
  };
}

/** The Document open, Play pressed and its sentence heard: the Reading has stopped at the end. */
async function atTheEnd(spine = 1) {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(ShellProbe)); });
  await settle();
  await press(() => world.page!.onBlocks!(BLOCKS, { index: 0, href: 's0.xhtml', spine }));
  await press(() => world.player!.onPlay());
  await hear();
  return { async down() { await act(async () => { tree.unmount(); }); } };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], now: Date.UTC(2026, 9, 11, 9, 0, 0) });
  world.page = null; world.remote = null; world.player = null; world.held = null; world.leave = null;
  world.audio.handlers = null; world.audio.queue = []; world.audio.running = false; world.audio.resumes = 0;
  world.asked = 0; world.restated = 0;
  world.disk.entries = [{
    id: DOCUMENT, format: 'epub', publicationId: null, publicationIdSource: 'none', title: 'A novel', position: null,
    voice: { provider: 'local', voice: 'af_bella' }, stamp: { at: 1, device: 'iPhone-test0001' },
  } satisfies LibraryEntry];
});
afterEach(() => { vi.useRealTimers(); });

describe('after the last sentence of the Document has been spoken', () => {
  it('Pause and Play while waiting for another section retain the waiting explanation', async () => {
    const reading = await atTheEnd(2);
    expect(shown().note).toContain('waiting for more');
    await press(() => world.remote!.press('pause'));
    await press(() => world.remote!.press('play'));
    expect(shown()).toMatchObject({ button: 'Pause, with the spinner', queued: 0 });
    expect(shown().note).toContain('waiting for more');
    await reading.down();
  });
  it('control: the Reading has stopped, and the Player says why', async () => {
    const reading = await atTheEnd();
    expect(shown()).toEqual({ button: 'Play', note: END, nowPlaying: 'paused', queued: 0, audioRunning: false, asked: 1 });
    await reading.down();
  });

  it('control: the sentence tapped and then Play, and it is spoken again and ends the Reading again', async () => {
    const reading = await atTheEnd();
    await press(() => world.page!.onTap!(0));
    await press(() => world.player!.onPlay());
    expect(shown()).toEqual({ button: 'Pause', note: null, nowPlaying: 'playing', queued: 1, audioRunning: true, asked: 1 });
    await hear();
    expect(shown()).toEqual({ button: 'Play', note: END, nowPlaying: 'paused', queued: 0, audioRunning: false, asked: 1 });
    await reading.down();
  });

  for (const [name, play] of [
    ['Play on the Player', () => world.player!.onPlay()],
    ['Play in Now Playing or on the headphones', () => world.remote!.press('play')],
  ] as const) {
    it(`${name}: ten minutes on, a sentence is waiting to be heard, or the Reading is stopped with a note saying why`, async () => {
      const reading = await atTheEnd();
      const resumes = world.audio.resumes;
      const restated = world.restated;
      await press(play);
      expect(world.restated).toBe(restated + 1);
      expect(world.audio.resumes, 'Play at the end must not start an empty audio session').toBe(resumes);
      await wait(10 * 60_000);
      const after = shown();
      const speaking = after.queued > 0;
      const stoppedAndSaidSo = after.button === 'Play' && after.note !== null;
      expect(speaking || stoppedAndSaidSo, JSON.stringify(after)).toBe(true);
      await reading.down();
    });
  }

  it('Play, then back to the Library: no Reading is kept as playing with nothing to be heard', async () => {
    const reading = await atTheEnd();
    await press(() => world.player!.onPlay());
    await press(() => world.leave!());
    await wait(10 * 60_000);
    const kept = { readingButton: world.held, queued: world.audio.queue.length, audioRunning: world.audio.running };
    expect(kept.readingButton === null || kept.queued > 0, JSON.stringify(kept)).toBe(true);
    await reading.down();
  });
});
