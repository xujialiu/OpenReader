import { createElement, useEffect, useMemo } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parsePositionsFile, serializePositionsFile, usableItems } from '../../src/core/sync/positions-file';
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
  page: null as null | { onTap?(utterance: number): void; onBlocks?(blocks: readonly unknown[], section: { index: number; href: string; spine: number }): void },
  audio: {
    handlers: null as null | { onBufferEnded(id: string): void; onOutputLost(): void; onInterrupted(): void; onInterruptionEnded(shouldResume: boolean): void },
    queue: [] as string[],
  },
  provider: { refuse: null as string | null, hold: null as string | null, answer: null as (() => void) | null },
  shown: [] as number[],
  remote: null as null | ((intent: 'play' | 'pause') => void),
  player: null as null | { playing: boolean; onPlay(): void; onSkip(target: 'next-sentence' | 'previous-sentence' | 'next-paragraph' | 'previous-paragraph'): void },
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
        goTo: nothing, goToSection: nothing, prepareSection: nothing, browse: nothing, show: (at: number) => world.shown.push(at), clock: { onClip: nothing, onPosition: nothing },
        setUtterances: nothing, setInset: nothing, setOpenPlayer: nothing, setLinePosition: nothing, setScrolling: nothing, setBar: nothing,
        setAppearance: nothing, setTheme: nothing, resumeFollowing: nothing, snapshot: nothing, hold: nothing, clear: nothing,
        returnToReading: nothing, setFollowOnly: nothing, setTapLock: nothing, releaseSelection: nothing, restart: () => null, readerProps: {},
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
    releaseProgress: () => {}, requestProgress: () => {}, requestInventory: async () => {}, useDownloads: () => 0, prioritizeRecheck: () => {}, setReadingPlays: () => {},
    offlineProvider: () => ({
      id: 'local', capabilities: { wordTimestamps: false }, listVoices: async () => [],
      synthesize: async (text: string) => {
        if (text === world.provider.hold) await new Promise<void>((resolve) => { world.provider.answer = resolve; });
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
async function playing(sentences: readonly string[] = TWO, start = true) {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(ShellProbe)); });
  await settle();
  await act(async () => { world.page!.onBlocks!(blocks(sentences), { index: 0, href: 's0.xhtml', spine: 1 }); });
  await settle();
  if (start) {
    await act(async () => { world.player!.onPlay(); });
    await settle();
  }
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
  world.provider.refuse = null; world.provider.hold = null; world.provider.answer = null;
  world.shown = [];
  world.disk.entries = [{
    id: DOCUMENT, format: 'epub', publicationId: null, publicationIdSource: 'none', title: 'A novel', position: null,
    stamp: { at: 1, device: 'iPhone-test0001' },
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

  it('iOS takes the audio away: another app starts playing sound, Siri, a call (#303)', async () => {
    const reading = await playing();
    await reading.hear();
    await act(async () => { world.audio.handlers!.onInterrupted(); });
    await settle();
    expect(world.player!.playing).toBe(false);
    expect(held()).toEqual(STOPPED);
    // iOS gives the audio back saying the Reading may resume, as after a call: the Player shows it playing again.
    await act(async () => { world.audio.handlers!.onInterruptionEnded(true); });
    await settle();
    expect(world.player!.playing).toBe(true);
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
    // The refused sentence was cued to explain the stop, but never spoken (#96).
    expect(held()).toEqual({ library: 'Sentence one.', folder: 'Sentence one.' });
    await reading.down();
  });
});

describe('repeated sentences are different Reading Positions (#250)', () => {
  const position = () => (world.disk.entries as LibraryEntry[]).find((entry) => entry.id === DOCUMENT)!.position!;

  it.each(['Go. Go. Stop now.', 'Go. Go. Go. Stop now.', 'One here. Two here. Three here. Four here.'])(
    'saves, uploads and resumes the last heard copy in %s', async (text) => {
      const reading = await playing([text]);
      const heard = text === 'Go. Go. Stop now.' ? 1 : 2;
      try {
        for (let i = 0; i < heard; i++) await reading.hear();
        await act(async () => { world.remote!('pause'); });
        await settle();
        const saved = position();
        expect(saved.anchor.prefix).toBe(text.slice(0, text.lastIndexOf(saved.anchor.exact)));
        const uploaded = parsePositionsFile(world.folder.file!);
        expect(uploaded.ok && usableItems(uploaded.items).find((item) => item.id === DOCUMENT)?.anchor).toEqual(saved.anchor);
        // A second Pause and leaving do not restamp this same occurrence.
        vi.setSystemTime(Date.now() + 20_000);
        await act(async () => { world.remote!('pause'); });
        await settle();
        expect(position()).toEqual(saved);
      } finally { await reading.down(); }
      const reopened = await playing([text], false);
      try { expect(world.shown.at(-1)).toBe(heard); } finally { await reopened.down(); }
    },
  );

  it('takes a remote place on the next identical sentence instead of calling it already being read', async () => {
    const reading = await playing(['Go. Go. Stop now.']);
    try {
      await act(async () => { world.remote!('pause'); });
      await settle();
      const file = parsePositionsFile(world.folder.file!);
      if (!file.ok) throw new Error(file.reason);
      const items = usableItems(file.items);
      items[0] = { ...items[0], anchor: { exact: 'Go.', prefix: 'Go. ', suffix: ' Stop now.' }, stamp: { at: Date.now() + 1, device: 'desktop' } };
      world.folder.file = serializePositionsFile(items);
      await act(async () => { world.sync!.poke('foreground'); });
      await settle();
      expect(world.shown.at(-1)).toBe(1);
      expect(position().anchor.prefix).toBe('Go. ');
    } finally { await reading.down(); }
  });

  it('saves a later nonadjacent copy even inside the periodic-write throttle', async () => {
    const reading = await playing(['Go. Wait here. Go. Stop now.']);
    try {
      await act(async () => { world.remote!('pause'); });
      await settle();
      const first = position();
      await act(async () => { world.player!.onPlay(); });
      await settle();
      await reading.hear(); await reading.hear();
      await act(async () => { world.remote!('pause'); });
      await settle();
      expect(position().anchor.prefix).toBe('Go. Wait here. ');
      expect(position().stamp.at).toBeGreaterThan(first.stamp.at);
    } finally { await reading.down(); }
  });
});

describe('only speech moves the Reading Position (#96)', () => {
  it.each(['tap', 'next-sentence', 'previous-sentence', 'next-paragraph', 'previous-paragraph'] as const)(
    'a paused %s, another Pause, background sync and leaving keep the last spoken place and Stamp', async (action) => {
      const reading = await playing(SIX);
      await reading.hear();
      await act(async () => { world.remote!('pause'); });
      await settle();
      const stored = world.disk.entries;
      const uploaded = world.folder.file;
      vi.setSystemTime(Date.now() + 20_000);
      await act(async () => {
        if (action === 'tap') world.page!.onTap!(4);
        else world.player!.onSkip(action);
      });
      await settle(); // Includes the paused seek's Clip arriving.
      await act(async () => { world.remote!('pause'); world.sync!.poke('background'); });
      await settle();
      await reading.down();
      await settle();
      expect(world.disk.entries).toEqual(stored);
      expect(world.folder.file).toBe(uploaded);
      const reopened = await playing(SIX, false);
      expect(world.shown.at(-1)).toBe(1);
      await reopened.down();
    },
  );

  it('a never-played Document stores no position after a tap and leave', async () => {
    const reading = await playing(SIX, false);
    await act(async () => { world.page!.onTap!(4); });
    await settle();
    await reading.down();
    await settle();
    expect(held()).toEqual({ library: null, folder: null });
  });

  it('a pending Play paused before its Clip arrives writes no unheard sentence, even after the late reply', async () => {
    const reading = await playing(SIX);
    await act(async () => { world.remote!('pause'); });
    await settle();
    world.provider.hold = SIX[4];
    vi.setSystemTime(Date.now() + 20_000);
    await act(async () => { world.page!.onTap!(4); });
    await settle();
    await act(async () => { world.player!.onPlay(); });
    await settle();
    expect(world.provider.answer).not.toBeNull();
    expect(held().library).toBe(SIX[0]);
    await act(async () => { world.remote!('pause'); });
    await settle();
    await act(async () => { world.provider.answer!(); });
    await settle();
    await reading.down();
    await settle();
    expect(held()).toEqual({ library: SIX[0], folder: SIX[0] });
  });

  it('Play after a paused tap establishes that sentence, even though the displayed cursor does not change', async () => {
    const reading = await playing(SIX);
    await act(async () => { world.remote!('pause'); });
    await settle();
    await act(async () => { world.page!.onTap!(4); });
    await settle();
    expect(held().library).toBe(SIX[0]);
    vi.setSystemTime(Date.now() + 20_000);
    await act(async () => { world.player!.onPlay(); });
    await settle();
    expect(held().library).toBe(SIX[4]); // Periodic write without another cursor change.
    await act(async () => { world.remote!('pause'); });
    await settle();
    expect(held()).toEqual({ library: SIX[4], folder: SIX[4] });
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
