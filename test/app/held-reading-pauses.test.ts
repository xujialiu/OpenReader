import { createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentId, LibraryEntry } from '../../src/core/document';
import type { ReportedBlock } from '../../src/renderer/messages';
import { GeneralScreen } from '../../src/app/general-screen';
import { ReadingHost, useHeldReading, type ReadingHandle } from '../../src/app/reading-host';
import { ShellContext, type Shell } from '../../src/app/routes';
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';

/**
 * A pause chosen in General while a Reading is held (#159). Since #68 a
 * Reading left playing keeps its view and its engine behind the Library, so
 * the pauses reach it live, from the next Clip queued (ADR 0047's amendment).
 *
 * Real: ReadingHost, GeneralScreen, ReadingView, useReading, the playback
 * engine, the shell's context.
 * Doubled: the navigator (a component that mounts the Reader's `show`/`left`
 * effect or General, one at a time), the shell's settings state (kept as
 * `shell.tsx` keeps it, without the write to the settings file), the Library,
 * sync, the page (the WebView bridge), the native audio graph, the Provider,
 * the Keychain, the lock screen module and the screens' own child controls.
 * The clock is pinned.
 */
type Route = 'Library' | 'Reader' | 'General';
type Row = { chosen: number | string; onChoose(value: number | string): void };
const world = vi.hoisted(() => ({
  page: null as null | { onBlocks?(blocks: readonly unknown[], section: { index: number; href: string; spine: number }): void },
  /** Every Line Position the page was sent. */
  linePositions: [] as number[],
  audio: {
    handlers: null as null | { onBufferEnded(id: string): void },
    /** The silence appended to each Clip the engine queued, in seconds at Natural Pace, in the order they were queued. */
    pauses: [] as number[],
    /** The buffers not yet heard. */
    queue: [] as string[],
    graphs: 0,
  },
  player: null as null | { onPlay(): void; onPause(): void },
  /** General's menu rows, by label. */
  rows: {} as Record<string, Row>,
  go: null as null | ((route: Route) => void),
  reading: null as null | ReadingHandle,
  settings: null as null | AppSettings,
}));

vi.mock('react-native', () => ({
  AppState: { currentState: 'active' }, Platform: { OS: 'ios' }, StyleSheet: { create: <T,>(styles: T) => styles },
  Pressable: 'Pressable', Text: 'Text', View: 'View', useColorScheme: () => 'light',
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
        setUtterances: nothing, setInset: nothing, setOpenPlayer: nothing, setScrolling: nothing, setBar: nothing,
        setLinePosition: (percent: number) => { world.linePositions.push(percent); },
        setAppearance: nothing, setTheme: nothing, resumeFollowing: nothing, snapshot: nothing, hold: nothing, clear: nothing,
        returnToReading: nothing, setFollowOnly: nothing, releaseSelection: nothing, restart: () => null, readerProps: {},
      };
    },
  };
});
// The native audio graph. It records the silence each Clip is queued with, which is the pause the owner hears after it.
vi.mock('../../src/playback/audio-graph', () => ({
  createAudioGraph: async (_first: unknown, handlers: NonNullable<typeof world.audio.handlers>) => {
    world.audio.handlers = handlers;
    world.audio.queue = [];
    const graph = ++world.audio.graphs;
    let serial = 0;
    return {
      sampleRate: 24000,
      prepare: async (clip: unknown) => ({ clip, samples: new Float32Array(2400), duration: 0.1 }),
      enqueue: (audio: { duration: number }, gap: number, from = 0, to = audio.duration) => {
        const id = `graph${graph}-buffer${serial++}`;
        world.audio.queue.push(id);
        world.audio.pauses.push(gap);
        return [{ bufferId: id, speech: to - from, gap, offset: from, duration: audio.duration }];
      },
      remove(ids: readonly string[]) { world.audio.queue = world.audio.queue.filter((id) => !ids.includes(id)); },
      setRate() {}, resume() {}, pause() {}, clear() { world.audio.queue = []; }, dispose: async () => {},
    };
  },
}));
// The Provider: a tenth of a second of silence for every sentence.
vi.mock('../../src/offline/runtime', () => ({
  hasSavedVoice: () => false, inventoryReady: () => true, inventoryError: () => null, planOf: () => null, chapterProgress: () => new Map(),
  releaseProgress: () => {}, requestProgress: () => {}, requestInventory: async () => {}, useDownloads: () => 0, setReadingPlays: () => {},
  offlineProvider: () => ({
    id: 'local', capabilities: { wordTimestamps: false }, listVoices: async () => [],
    synthesize: async () => ({ audio: 'pcm' as const, samples: new Uint8Array(4800), sampleRate: 24000 }),
  }),
}));
vi.mock('../../src/now-playing', () => ({
  lockScreenPosition: () => {}, restateNowPlaying: () => {}, chapterOf: () => null, useNowPlaying: () => {},
}));
vi.mock('../../src/app/document', () => ({
  openDocument: async (entry: { id: string; format: string; title: string }) => ({ identity: { id: entry.id, format: entry.format }, title: entry.title, base64: '' }),
}));
vi.mock('../../src/app/use-provider-secrets', () => ({ useProviderKey: () => ({ presence: { state: 'held' } }) }));
// The screens' own children, which draw and decide nothing here. General's menu rows hand the test their `onChoose`.
vi.mock('../../src/app/controls', () => ({
  INK: { page: '#fff', quiet: '#888' },
  SettingsPage: ({ children }: { children: unknown }) => children,
  SettingsGroup: ({ children }: { children: unknown }) => children,
  ValueRow: (props: Row & { label: string }) => { world.rows[props.label] = props; return null; },
  SwitchRow: () => null, TextRow: () => null, Footnote: () => null, useAccent: () => ({ reading: '#000' }),
}));
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
vi.mock('../../src/app/walkthrough-harness', () => ({ hlog() {}, probeScript: () => '', statusLine: () => '', useHarnessCommands() {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const DOCUMENT = ('sha256:' + 'd'.repeat(64)) as DocumentId;
/** A new install's pauses: none after a sentence, a fifth of a second at a paragraph. */
const START: AppSettings = { ...DEFAULT_SETTINGS, provider: 'local', enabledProviders: ['local'], voice: 'af_bella' };
const ENTRY: LibraryEntry = {
  id: DOCUMENT, format: 'epub', publicationId: null, publicationIdSource: 'none', title: 'A book',
  position: null, voice: { provider: 'local', voice: 'af_bella' }, stamp: { at: 1, device: 'iPhone-test' },
};
/** One section of eight paragraphs, a sentence each, so every sentence is followed by the Pause between paragraphs. */
const PARAGRAPHS: ReportedBlock[] = Array.from({ length: 8 }, (_, at) => ({
  id: `0.${at}`, text: `Paragraph number ${at + 1} is one sentence.`, role: 'paragraph' as const, section: 's0.xhtml', sectionIndex: 0,
  cfi: `epubcfi(/6/2[s0]!/4/${2 * (at + 1)})`,
}));

/** What `shell.tsx` holds for every screen. The settings are kept as it keeps them, without the write to the settings file. */
function ShellStandIn({ children }: { children: ReactNode }) {
  const [settings, updateSettings] = useState(START);
  const settingsRef = useRef(settings);
  const setSettings = useCallback<Shell['setSettings']>((next) => {
    const value = typeof next === 'function' ? next(settingsRef.current) : next;
    settingsRef.current = value;
    updateSettings(value);
  }, []);
  useEffect(() => { world.settings = settings; });
  const value = useMemo(() => ({
    settings, setSettings, secretsWritten: 0, secretRevisions: {}, noteSecretWritten() {}, syncLast: null,
    sync: { poke() {}, wait: async () => null },
    library: { entries: [ENTRY], adoptedAt: {}, current: () => ENTRY, opened() {}, voiced() {}, reached() {}, heard() {}, retitled() {} },
  }) as unknown as Shell, [settings, setSettings]);
  return createElement(ShellContext.Provider, { value }, children);
}
/** The Reader screen's part in the Reading: the effect at `reader-screen.tsx:72-76`. */
function ReaderStandIn() {
  const { show, left } = useHeldReading();
  useEffect(() => {
    show(DOCUMENT);
    return () => left(DOCUMENT);
  }, [show, left]);
  return null;
}
/** The navigator: the screen on top. The Reader unmounts when the owner goes back, and General is the real screen. */
function NavigatorStandIn() {
  const [route, setRoute] = useState<Route>('Library');
  const reading = useHeldReading();
  useEffect(() => { world.go = setRoute; world.reading = reading; }, [reading]);
  return route === 'Reader' ? createElement(ReaderStandIn) : route === 'General' ? createElement(GeneralScreen) : null;
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
};
const go = async (route: Route) => {
  await act(async () => { world.go!(route); });
  await settle();
};
/** The owner chooses a value from the menu of one of General's rows. */
const choose = async (label: string, value: number) => {
  await act(async () => { world.rows[label]!.onChoose(value); });
  await settle();
};
const press = async (button: 'onPlay' | 'onPause') => {
  await act(async () => { world.player![button](); });
  await settle();
};
/** The front buffer of the native queue ends, as it does when a sentence and the pause after it have been heard. */
const hear = async (sentences: number) => {
  for (let i = 0; i < sentences; i++) {
    const front = world.audio.queue.shift();
    if (!front) throw new Error('Nothing is queued to be heard.');
    await act(async () => { world.audio.handlers!.onBufferEnded(front); });
    await settle();
  }
};

let tree: ReactTestRenderer;
/** The app at the Library, with one Document in it. */
async function launch() {
  await act(async () => { tree = create(createElement(ShellStandIn, null, createElement(ReadingHost, null, createElement(NavigatorStandIn)))); });
  await settle();
}
/** The Document's row is tapped, its one section reports, and the owner presses Play. */
async function openAndPlay() {
  await go('Reader');
  await act(async () => { world.page!.onBlocks!(PARAGRAPHS, { index: 0, href: 's0.xhtml', spine: 1 }); });
  await settle();
  await press('onPlay');
}
/**
 * The Reading plays; the owner goes back to the Library, where it is held and
 * goes on (#68); then Settings, General and a row's menu. Answers how many
 * Clips had been queued by then.
 */
async function chooseWhileTheReadingPlaysInTheLibrary(label: string, value: number) {
  await launch();
  await openAndPlay();
  expect(world.audio.pauses).toEqual([0.2, 0.2, 0.2, 0.2]);
  await go('Library');
  expect(world.reading!.current).toMatchObject({ id: DOCUMENT, playing: true });
  await go('General');
  await choose(label, value);
  expect(world.rows[label]!.chosen).toBe(value);
  return world.audio.pauses.length;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-11T08:00:00Z') });
  Object.assign(world, { page: null, linePositions: [], player: null, rows: {}, go: null, reading: null, settings: null });
  world.audio = { handlers: null, pauses: [], queue: [], graphs: 0 };
});
afterEach(async () => {
  await act(async () => { tree.unmount(); });
  vi.useRealTimers();
});

describe('a Pause between paragraphs chosen with no Reading held, or once it has ended', () => {
  it('is the pause the next Reading plays with', async () => {
    await launch();
    await go('General');
    await choose('Pause between paragraphs', 2000);
    await go('Library');
    await openAndPlay();

    expect(world.audio.pauses).toEqual([2, 2, 2, 2]);
  });

  it('chosen while the Reading plays in the Library, is played once that Reading has ended and the Document is opened again', async () => {
    const before = await chooseWhileTheReadingPlaysInTheLibrary('Pause between paragraphs', 2000);
    await go('Library');
    await go('Reader');
    await press('onPause');
    // Back while paused: the Reading ends.
    await go('Library');
    expect(world.reading!.current).toBeNull();
    await openAndPlay();

    expect(world.audio.pauses.slice(before)).toEqual([2, 2, 2, 2]);
  });
});

describe('a pause chosen in General while the Reading plays in the Library (#159)', () => {
  it('is the pause of the Clips queued after returning to the Reader and pressing Pause and Play', async () => {
    const before = await chooseWhileTheReadingPlaysInTheLibrary('Pause between paragraphs', 2000);
    expect(world.settings!.pauses).toEqual({ sentenceMs: 0, paragraphMs: 2000 });

    // Back to the Library and into the book by the Reading Button, then Pause and Play, and two more sentences.
    await go('Library');
    await go('Reader');
    await press('onPause');
    await press('onPlay');
    await hear(2);

    // Every Clip queued since the choice, however many the Reading queued to get there.
    const since = world.audio.pauses.slice(before);
    expect(since).not.toHaveLength(0);
    expect(since).toEqual(since.map(() => 2));
  });

  it('is the pause of the Clips queued while it goes on in the Library, with nothing pressed', async () => {
    const before = await chooseWhileTheReadingPlaysInTheLibrary('Pause between paragraphs', 2000);
    await go('Library');
    await hear(2);

    expect(world.reading!.current).toMatchObject({ id: DOCUMENT, playing: true });
    expect(world.audio.graphs).toBe(1);
    expect(world.audio.pauses.slice(0, before)).toEqual([0.2, 0.2, 0.2, 0.2]);
    expect(world.audio.pauses.slice(before)).toEqual([2, 2]);
  });

  it('keeps the Reading playing and its engine, rather than building another', async () => {
    await chooseWhileTheReadingPlaysInTheLibrary('Pause between paragraphs', 2000);

    expect(world.reading!.current).toMatchObject({ id: DOCUMENT, playing: true });
    expect(world.audio.graphs).toBe(1);
  });

  it('a Line position chosen the same way reaches its page at once, as it did before', async () => {
    await chooseWhileTheReadingPlaysInTheLibrary('Line position', 30);

    expect(world.linePositions.at(-1)).toBe(30);
  });
});
