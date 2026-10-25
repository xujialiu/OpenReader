import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLocator, readingPositionAt, type DocumentId, type LibraryEntry } from '../../src/core/document';
import { createFolderStore } from '../../src/core/folders';
import { mergePositions, parsePositionsFile, serializePositionsFile, type PositionsItem } from '../../src/core/sync/positions-file';
import { WebDAVError } from '../../src/core/sync/webdav';
import type { ReportedBlock } from '../../src/renderer/messages';
import { ReadingHost, useHeldReading, type ReadingHandle } from '../../src/app/reading-host';
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';
import { useLibrary, type Library } from '../../src/app/use-library';
import { useSync, WAIT_MS, type SyncDeps } from '../../src/app/use-sync';

/**
 * A newer place from the desktop arrives while the phone speaks, again, a
 * sentence it reached earlier in the same Reading, and the owner pauses inside
 * that sentence (#154). The newest place wins (design 0031), because nothing
 * new was spoken and nothing was moved after it arrived.
 *
 * Real: <ReadingHost>, <ReadingView>, useReading, useLibrary, useSync, the
 * Positions transport, the merge, the adoption and the Stamps.
 * Stand-ins: the WebDAV server (the file as a string, and a GET that can be
 * held), the Library's own file, the page (its bridge, and the Blocks it
 * reports), the playback engine (it records what it is asked and cues the
 * sentences the test says were heard) and the view's children. The clock and
 * `setTimeout` are pinned.
 */
const world = vi.hoisted(() => ({
  options: null as null | { onBlocks?(blocks: readonly unknown[], section: { index: number; href: string; spine: number }): void },
  engines: [] as { deps: { onState?(state: { playing: boolean; buffering: boolean }): void; clock: { onClip(cue: unknown): void } }; calls: string[] }[],
  /** The lock screen's Play and Pause: the same two handlers the Player's buttons call (`reading-view.tsx`, `useNowPlaying`). */
  intent: null as null | ((intent: 'play' | 'pause') => void),
  shell: null as unknown,
  disk: { entries: [] as unknown[] },
}));

vi.mock('react-native', () => ({
  AppState: { currentState: 'active' }, StyleSheet: { create: <T,>(styles: T) => styles }, Text: 'Text', View: 'View', useColorScheme: () => 'light',
}));
vi.mock('@epubjs-react-native/core', () => ({
  Reader: () => null,
  useReader: () => ({ getMeta: () => ({}), toc: [], injectJavascript() {}, currentLocation: null }),
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }) }));
vi.mock('react-native-teleport', () => ({ Portal: ({ children }: { children: unknown }) => children, PortalHost: () => null }));
vi.mock('../../src/renderer', async () => {
  const cursor = await vi.importActual<typeof import('../../src/renderer/cursor')>('../../src/renderer/cursor');
  return {
    ...cursor,
    useReaderBridge: (options: typeof world.options) => {
      world.options = options;
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
vi.mock('../../src/playback', async () => ({
  ...(await vi.importActual<typeof import('../../src/playback/navigation')>('../../src/playback/navigation')),
  createPlaybackEngine: (deps: (typeof world.engines)[number]['deps']) => {
    let playing = false;
    const engine = { deps, calls: [] as string[] };
    world.engines.push(engine);
    return {
      load(_list: unknown, from = 0) { engine.calls.push(`load:${from}`); }, extend() {}, silence() {}, setRate() {}, switchVoice() {}, cancelVoiceSwitch() {}, stopAfter() {},
      play() { playing = true; engine.calls.push('play'); deps.onState?.({ playing: true, buffering: false }); },
      pause() { playing = false; engine.calls.push('pause'); deps.onState?.({ playing: false, buffering: false }); },
      seek(at: number) { engine.calls.push(`seek:${at}`); },
      snapshot: () => ({ playing, utterance: 0, rate: 1, queued: 1, fetching: 0 }),
      dispose: async () => {},
    };
  },
}));
vi.mock('../../src/offline/runtime', () => ({
  hasSavedVoice: () => false, inventoryReady: () => true, inventoryError: () => null, planOf: () => null, chapterProgress: () => new Map(),
  releaseProgress: () => {}, requestProgress: () => {}, requestInventory: async () => {}, useDownloads: () => 0, prioritizeRecheck: () => {}, setReadingPlays: () => {},
  offlineProvider: () => ({ capabilities: { wordTimestamps: false } }),
}));
vi.mock('../../src/now-playing', () => ({
  lockScreenPosition: () => {}, restateNowPlaying: () => {}, chapterOf: () => null,
  useNowPlaying: (now: { onIntent(intent: 'play' | 'pause'): void }) => { world.intent = now.onIntent; },
}));
vi.mock('../../src/app/routes', () => ({ useShell: () => world.shell }));
vi.mock('../../src/app/body-text-sizes', () => ({ readBodyTextSize: () => null, writeBodyTextSize: () => {} }));
vi.mock('../../src/app/use-lookup', () => ({ useLookup: () => ({ selection: null, stopPronunciation() {} }) }));
vi.mock('../../src/app/lookup-drawer', () => ({ LookupDrawer: () => null }));
vi.mock('../../src/app/contents-sheet', () => ({ ContentsSheet: () => null }));
vi.mock('../../src/app/voice-sheet', () => ({ VoiceSheet: () => null }));
vi.mock('../../src/app/player', () => ({ Player: () => null }));
vi.mock('../../src/app/document-cover', () => ({ useDocumentCover: () => null }));
vi.mock('../../src/app/reader-file-system', () => ({ useReaderFileSystem: () => ({}) }));
vi.mock('../../src/app/use-voices', () => ({ useVoiceLists: () => ({ voicesOf: () => null, ask() {}, asking: () => false, noteOf: () => null }) }));
vi.mock('../../src/app/voice-catalog', () => ({ knownVoice: () => null }));
vi.mock('../../src/app/controls', () => ({ INK: { page: '#fff', quiet: '#888' } }));
vi.mock('../../src/app/text-styles', () => ({ TEXT: { subhead: {} } }));
vi.mock('../../src/app/walkthrough-harness', () => ({ hlog() {}, probeScript: () => '', statusLine: () => '', useHarnessCommands() {} }));
vi.mock('../../src/app/use-provider-secrets', () => ({ useProviderKey: () => ({ presence: { state: 'held' } }) }));
vi.mock('../../src/app/document', () => ({
  identifyFile: async () => { throw new Error('not in this test'); },
  openDocument: async (entry: { id: string; format: string }, title: string) => ({ identity: { id: entry.id, format: entry.format }, title, base64: '' }),
}));
vi.mock('../../src/app/display-names', () => ({ displayNames: () => ({}), saveDisplayName: () => {} }));
vi.mock('../../src/app/library', () => ({
  thisDevice: () => 'iPhone-test0001',
  readLibrary: () => ({ entries: world.disk.entries, problems: [], ignored: [], frozen: false, note: null }),
  migrateDocumentIds: (loaded: { entries: unknown[] }) => ({ entries: loaded.entries, note: null }),
  writeLibrary: (entries: unknown[]) => { world.disk.entries = entries; },
}));
vi.mock('../../src/app/folder-storage', () => ({ openFolderStore: () => {
  let text: string | null = null;
  let n = 0;
  return createFolderStore({ read: () => text, write: (next) => { text = next; }, id: () => `folder-${++n}` });
} }));
vi.mock('../../src/keys/store', () => ({ readSyncPassword: async () => ({ outcome: 'absent' }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const DOCUMENT = ('sha256:' + 'c'.repeat(64)) as DocumentId;
const OTHER = ('sha256:' + 'e'.repeat(64)) as DocumentId;
const PHONE = 'iPhone-test0001';
const DESKTOP = 'desktop-zotero';
const SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS, provider: 'local', enabledProviders: ['local'], voice: 'af_bella',
  sync: { url: 'https://dav.example/or', username: 'ann', enabled: true },
};
const START = 1_800_000_000_000;

/** One rendered section holding every sentence, so nothing has to be waited for. */
const SENTENCES = ['Phone old sentence.', 'Phone old continuation.', 'Desktop new sentence.', 'Desktop new continuation.'];
const PAGE: ReportedBlock[] = SENTENCES.map((text, at) => ({
  id: `0.${at}`, text, role: 'paragraph' as const, section: 's0.xhtml', sectionIndex: 0, cfi: `epubcfi(/6/2[s0]!/4/${2 * (at + 1)})`,
}));
const cue = (utterance: number) => ({ utterance, words: null, duration: 1, rate: 1 });

/** The Sync Folder: the Positions File as text, and a GET that, while `slow`, answers only when the test lets it. */
function folder() {
  const state = { text: null as string | null, slow: false, held: [] as (() => void)[] };
  const deps: SyncDeps = {
    client: () => ({
      check: async () => {},
      download: async () => {
        if (state.slow) await new Promise<void>((resolve) => { state.held.push(resolve); });
        if (state.text === null) throw new WebDAVError('not-found', 'no file', 404);
        return state.text;
      },
      upload: async (_name: string, text: string) => { state.text = text; },
    }),
    now: () => Date.now(),
  };
  const items = () => {
    const parsed = parsePositionsFile(state.text!);
    if (!parsed.ok) throw new Error('the stand-in server holds a file that does not parse');
    return parsed.items;
  };
  return {
    state,
    deps,
    /** What the file on the server says about the Document. */
    says: () => {
      const item = items().find((one) => one.id === DOCUMENT) as PositionsItem;
      return `${item.anchor.exact} @${item.stamp.device}`;
    },
    /** The desktop takes the file, reads on to `sentence` and uploads: the real merge, in which the newer Stamp wins. */
    desktopReads(sentence: number) {
      const theirs: PositionsItem = {
        id: DOCUMENT, format: 'epub', publicationId: null, locator: `epubcfi(/6/2!/4/${2 * (sentence + 1)})`,
        anchor: { exact: SENTENCES[sentence], prefix: '', suffix: '' }, stamp: { at: Date.now(), device: DESKTOP },
      };
      state.text = serializePositionsFile(mergePositions([theirs], items()));
    },
    answer() {
      state.slow = false;
      for (const letGo of state.held.splice(0)) letGo();
    },
  };
}

/** The app with one Document in its Library, opened in the Reader. */
async function open(stored: boolean, deps: SyncDeps, page: readonly ReportedBlock[] = PAGE) {
  world.engines.length = 0;
  world.intent = null;
  world.options = null;
  const entry: LibraryEntry = {
    id: DOCUMENT, format: 'epub', publicationId: null, publicationIdSource: 'none', title: 'A document',
    position: stored ? readingPositionAt(createLocator('epub', 'epubcfi(/6/2!/4/2)'), SENTENCES[0], 0, SENTENCES[0].length, { at: START - 60_000, device: PHONE }) : null,
    voice: { provider: 'local', voice: 'af_bella' }, stamp: { at: START - 60_000, device: PHONE },
  };
  world.disk.entries = [entry, { ...entry, id: OTHER, title: 'Another document', position: null }];
  const seen: { library: Library | null; handle: ReadingHandle | null } = { library: null, handle: null };
  function Opener() {
    seen.handle = useHeldReading();
    return null;
  }
  function Shell() {
    const library = useLibrary();
    const { sync } = useSync(SETTINGS, library, deps);
    seen.library = library;
    world.shell = { settings: SETTINGS, setSettings() {}, library, secretRevisions: {}, sync };
    return createElement(ReadingHost, null, createElement(Opener));
  }
  let tree!: ReactTestRenderer;
  /** Everything a step set off, drawn. `setImmediate` is left real; only the clock and `setTimeout` are pinned. */
  const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); }); };
  await act(async () => { tree = create(createElement(Shell)); });
  await settle();
  await act(async () => { seen.handle!.show(DOCUMENT); });
  await settle();
  await act(async () => { world.options!.onBlocks!(page, { index: 0, href: 's0.xhtml', spine: 1 }); });
  await settle();
  return {
    settle,
    /** What the Library holds for the Document. */
    holds: () => {
      const place = seen.library!.current(DOCUMENT)!.position;
      return place ? `${place.anchor.exact} @${place.stamp.device}` : null;
    },
    async press(intent: 'play' | 'pause') { await act(async () => { world.intent!(intent); }); await settle(); },
    /** The engine begins a sentence. */
    async hears(utterance: number) { await act(async () => { world.engines[0].deps.clock.onClip(cue(utterance)); }); await settle(); },
    async pass(ms: number) { await act(async () => { vi.advanceTimersByTime(ms); }); await settle(); },
    async down() { await act(async () => { tree.unmount(); }); },
    async openOther() { await act(async () => { seen.handle!.show(OTHER); }); await settle(); },
  };
}

/**
 * The phone listens and is paused with the Reader left open; the desktop reads
 * on to the third sentence; back on the phone, Play is pressed with a server
 * slower than the two seconds Play waits, the download answers while the
 * phone's sentence is spoken again, and the owner pauses inside that sentence.
 */
async function afternoon(options: { stored: boolean; heard: readonly number[] }) {
  const sync = folder();
  const m = await open(options.stored, sync.deps);

  await m.press('play');
  for (const sentence of options.heard) await m.hears(sentence);
  await m.press('pause');
  const phone = `${SENTENCES[options.heard.at(-1)!]} @${PHONE}`;
  // The phone's own place, in its Library and on the server.
  expect([m.holds(), sync.says()]).toEqual([phone, phone]);

  await m.pass(600_000);
  sync.desktopReads(2);

  const engine = world.engines[0];
  engine.calls.length = 0;
  sync.state.slow = true;
  await m.press('play');
  expect(engine.calls).toEqual([]);
  await m.pass(WAIT_MS);
  // Past the bound: the reading goes on from the phone's own sentence.
  expect(engine.calls).toEqual(['play']);
  sync.answer();
  await m.settle();
  // The download has answered while that sentence plays: the Library holds the desktop's place.
  expect(m.holds()).toBe(`Desktop new sentence. @${DESKTOP}`);

  await m.press('pause');
  const after = { library: m.holds(), positionsFile: sync.says() };
  await m.press('play');
  const result = { ...after, engineSincePlay: [...engine.calls] };
  await m.down();
  return result;
}

describe('ending a Reading while a newer desktop place is kept (#249)', () => {
  it.each(['pause', 'switch', 'unmount'] as const)('settles the place before %s writes back', async (ending) => {
    const sync = folder();
    const m = await open(true, sync.deps);
    try {
      await m.press('play');
      await m.hears(1);
      await m.press('pause');
      await m.pass(600_000);
      sync.desktopReads(2);
      sync.state.slow = true;
      await m.press('play');
      await m.pass(WAIT_MS);
      sync.answer();
      await m.settle();
      const adopted = world.disk.entries;
      const uploaded = sync.state.text;
      // A real engine can cue the resumed sentence again: that is not new speech.
      await m.hears(1);
      if (ending === 'pause') await m.press('pause');
      else if (ending === 'switch') await m.openOther();
      else { await m.down(); await m.settle(); }
      expect(world.disk.entries).toEqual(adopted); // Including the desktop's original Stamp.
      expect(sync.state.text).toBe(uploaded);
    } finally { if (ending !== 'unmount') await m.down(); }
  });

  it('releases a kept desktop place when the next identical sentence actually starts (#250)', async () => {
    const sync = folder();
    const m = await open(false, sync.deps, [{ ...PAGE[0], text: 'Go. Go. Stop now.' }]);
    try {
      await m.press('play'); await m.hears(0); await m.press('pause');
      await m.pass(600_000);
      sync.desktopReads(2);
      sync.state.slow = true;
      await m.press('play'); await m.pass(WAIT_MS);
      sync.answer(); await m.settle();
      await m.hears(1);
      await m.openOther();
      const entry = (world.disk.entries as LibraryEntry[]).find((one) => one.id === DOCUMENT)!;
      expect(entry.position?.anchor).toEqual({ exact: 'Go.', prefix: 'Go. ', suffix: ' Stop now.' });
      expect(sync.says()).toBe(`Go. @${PHONE}`);
    } finally { await m.down(); }
  });

  it('writes genuinely new phone speech when another Document is opened', async () => {
    const sync = folder();
    const m = await open(true, sync.deps);
    try {
      await m.press('play');
      await m.hears(1);
      await m.press('pause');
      await m.pass(600_000);
      sync.desktopReads(2);
      sync.state.slow = true;
      await m.press('play');
      await m.pass(WAIT_MS);
      sync.answer();
      await m.settle();
      await m.hears(3);
      await m.openOther();
      expect([m.holds(), sync.says()]).toEqual(Array(2).fill(`Desktop new continuation. @${PHONE}`));
    } finally { await m.down(); }
  });
});

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: START }); });
afterEach(() => { vi.useRealTimers(); });

/** Nothing new was spoken and nothing was moved after the place arrived, so the newest place wins (design 0031). */
const NEWEST_WINS = {
  library: `Desktop new sentence. @${DESKTOP}`,
  positionsFile: `Desktop new sentence. @${DESKTOP}`,
  engineSincePlay: ['play', 'pause', 'seek:2', 'play'],
};

describe('a newer place that arrives while the phone speaks, again, a sentence it already reached', () => {
  it('wins at a pause inside that sentence, when the phone had read on one sentence from where the Document opened', async () => {
    expect(await afternoon({ stored: true, heard: [0, 1] })).toEqual(NEWEST_WINS);
  });

  it('wins at a pause inside that sentence, when the Document opened with no place and its first sentence was played', async () => {
    expect(await afternoon({ stored: false, heard: [0] })).toEqual(NEWEST_WINS);
  });

  it('control, passing today (#105): wins when the phone is still on the sentence the Document opened at', async () => {
    expect(await afternoon({ stored: true, heard: [0] })).toEqual(NEWEST_WINS);
  });
});
