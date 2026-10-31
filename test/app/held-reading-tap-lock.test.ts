import { createElement, useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentId, LibraryEntry } from '../../src/core/document';
import type { ReportedBlock } from '../../src/renderer/messages';
import { ReadingHost, useHeldReading, type ReadingHandle } from '../../src/app/reading-host';
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';

/**
 * **The Tap Lock ends with the visit to the reader (#336).** Turned on in the
 * Player, it holds while the Reader is on screen; leaving the Reader turns it
 * off, whether the Reading goes on playing behind the navigator (the view is
 * parked, ADR 0049) or ends; another Document, or a new launch, starts with it
 * off. The Debug Log says when it was turned on and off, and why.
 *
 * Real: ReadingHost, ReadingView, useReading, useLookup and the playback engine.
 * Doubled as in `held-reading-drawers.test.ts`: the shell's Library and sync,
 * the page (the WebView bridge, which records what it is told about the lock),
 * the native audio graph, the Provider, the lock screen module and the view's
 * children; the Player is a probe that records its props, and the Debug Log
 * keeps its lines here.
 */
const world = vi.hoisted(() => ({
  shell: null as unknown,
  handle: null as unknown,
  page: null as null | { onBlocks?(blocks: readonly unknown[], section: { index: number; href: string; spine: number }): void },
  player: null as null | { onPlay(): void; onPause(): void; tapLock: boolean; onTapLock(on: boolean): void },
  /** What the page was told about the lock, in order. */
  told: [] as boolean[],
  /** The Debug Log's lines, `[category] message`. */
  log: [] as string[],
}));

vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'ios' },
  StyleSheet: { create: <T,>(styles: T) => styles }, Text: 'Text', View: 'View', useColorScheme: () => 'light',
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }) }));
vi.mock('react-native-teleport', () => ({ Portal: ({ children }: { children: unknown }) => children, PortalHost: () => null }));
vi.mock('@epubjs-react-native/core', () => ({
  Reader: () => null,
  useReader: () => ({ getMeta: () => ({}), toc: [], injectJavascript() {}, currentLocation: null }),
}));
vi.mock('../../src/app/routes', () => ({ useShell: () => world.shell }));
// The page: the test reports a section's Blocks as the WebView would.
vi.mock('../../src/renderer', async () => {
  const cursor = await vi.importActual<typeof import('../../src/renderer/cursor')>('../../src/renderer/cursor');
  const nothing = () => {};
  return {
    ...cursor,
    useReaderBridge: (options: typeof world.page) => {
      world.page = options;
      return {
        goTo: nothing, goToSection: nothing, browse: nothing, show: nothing, clock: { onClip: nothing, onPosition: nothing },
        setUtterances: nothing, setInset: nothing, setOpenPlayer: nothing, setLinePosition: nothing, setScrolling: nothing, setBar: nothing,
        setAppearance: nothing, setTheme: nothing, resumeFollowing: nothing, snapshot: nothing, hold: nothing, clear: nothing,
        returnToReading: nothing, setFollowOnly: nothing, setTapLock: (on: boolean) => { world.told.push(on); }, releaseSelection: nothing, restart: () => null, readerProps: {},
        setLookupEnabled: nothing, closeLookup: nothing, onSelection: () => nothing,
      };
    },
  };
});
// The native audio graph: it takes every Clip and never ends one, so the Reading stays on its first sentence, playing.
vi.mock('../../src/playback/audio-graph', () => ({
  createAudioGraph: async () => {
    let serial = 0;
    return {
      sampleRate: 24000,
      prepare: async (clip: unknown) => ({ clip, samples: new Float32Array(2400), duration: 0.1 }),
      enqueue: (audio: { duration: number }, gap: number, from = 0, to = audio.duration) =>
        [{ bufferId: `b${serial++}`, speech: to - from, gap, offset: from, duration: audio.duration }],
      remove() {}, setRate() {}, resume() {}, pause() {}, clear() {}, dispose: async () => {},
    };
  },
}));
// The Provider: silence for every sentence. Nothing leaves the machine.
vi.mock('../../src/offline/runtime', () => ({
  hasSavedVoice: () => false, inventoryReady: () => true, inventoryError: () => null, planOf: () => null, chapterProgress: () => new Map(),
  releaseProgress: () => {}, requestProgress: () => {}, requestInventory: async () => {}, useDownloads: () => 0, prioritizeRecheck: () => {}, setReadingPlays: () => {},
  offlineProvider: () => ({
    id: 'local', capabilities: { wordTimestamps: false }, listVoices: async () => [],
    synthesize: async () => ({ audio: 'pcm' as const, samples: new Uint8Array(4800), sampleRate: 24000 }),
  }),
}));
vi.mock('../../src/now-playing', () => ({ lockScreenPosition: () => {}, restateNowPlaying: () => {}, chapterOf: () => null, useNowPlaying: () => {} }));
vi.mock('../../src/app/document', () => ({
  openDocument: async (entry: { id: string; format: string; title: string }) => ({ identity: { id: entry.id, format: entry.format }, title: entry.title, base64: '' }),
}));
vi.mock('../../src/keys/store', () => ({ readTranslationKey: async () => ({ outcome: 'absent' }) }));
vi.mock('../../src/app/use-provider-secrets', () => ({ useProviderKey: () => ({ presence: { state: 'held' } }) }));
vi.mock('../../src/app/body-text-sizes', () => ({ readBodyTextSize: () => null, writeBodyTextSize: () => {} }));
vi.mock('../../src/translation/services', () => ({ lookup: async () => { throw new Error('not in this test'); } }));
vi.mock('../../src/translation/pronunciation-audio', () => ({ playPronunciation: async () => {} }));
// The view's children.
vi.mock('../../src/app/contents-sheet', () => ({ ContentsSheet: () => null }));
vi.mock('../../src/app/voice-sheet', () => ({ VoiceSheet: () => null }));
vi.mock('../../src/app/lookup-drawer', () => ({ LookupDrawer: () => null }));
vi.mock('../../src/app/player', () => ({ Player: (props: NonNullable<typeof world.player>) => { world.player = props; return null; } }));
// The Debug Log: its lines, kept here.
vi.mock('../../src/debug/debug-log', async () => ({
  ...(await vi.importActual<typeof import('../../src/debug/debug-log')>('../../src/debug/debug-log')),
  debugLog: (category: string, message: string) => { world.log.push(`[${category}] ${message}`); },
}));
vi.mock('../../src/app/document-cover', () => ({ useDocumentCover: () => null }));
vi.mock('../../src/app/reader-file-system', () => ({ useReaderFileSystem: () => ({}) }));
vi.mock('../../src/app/use-voices', () => ({ useVoiceLists: () => ({ voicesOf: () => null, ask() {}, asking: () => false, noteOf: () => null }) }));
vi.mock('../../src/app/voice-catalog', () => ({ knownVoice: () => null }));
vi.mock('../../src/app/controls', () => ({ INK: { page: '#fff', quiet: '#888' } }));
vi.mock('../../src/app/text-styles', () => ({ TEXT: { subhead: {} } }));
vi.mock('../../src/app/walkthrough-harness', () => ({ hlog() {}, probeScript: () => '', statusLine: () => '', useHarnessCommands() {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const DOCUMENT = ('sha256:' + 'd'.repeat(64)) as DocumentId;
const OTHER = ('sha256:' + 'e'.repeat(64)) as DocumentId;
const SETTINGS: AppSettings = { ...DEFAULT_SETTINGS, provider: 'local', enabledProviders: ['local'], voice: 'af_bella' };
const entry = (id: DocumentId, title: string): LibraryEntry => ({
  id, format: 'epub', publicationId: null, publicationIdSource: 'none', title, position: null,
  stamp: { at: 1, device: 'iPhone-test0001' },
});
const ENTRIES = [entry(DOCUMENT, 'A novel'), entry(OTHER, 'Another novel')];
world.shell = {
  settings: SETTINGS, setSettings() {}, secretRevisions: {},
  sync: { poke() {}, wait: async () => null },
  library: {
    entries: ENTRIES, adoptedAt: {}, current: (id: DocumentId) => ENTRIES.find((one) => one.id === id) ?? null,
    opened() {}, reached() {}, heard() {}, retitled() {},
  },
};

/** One section's Blocks as the page reports them, a sentence to a paragraph. */
const BLOCKS: ReportedBlock[] = ['Sentence one.', 'Sentence two.', 'Sentence three.'].map((text, at) => ({
  id: `0.${at}`, text, role: 'paragraph' as const, section: 's0.xhtml', sectionIndex: 0, cfi: `epubcfi(/6/2[s0]!/4/${2 * (at + 1)})`,
}));

/** The Reader screen: it asks for its Document's Reading as it arrives. */
function Reader() {
  const handle = useHeldReading();
  useEffect(() => { world.handle = handle; });
  const { show } = handle;
  useEffect(() => { show(DOCUMENT); }, [show]);
  return null;
}
const handle = () => world.handle as ReadingHandle;
const held = () => handle().current;
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
};

/** The Document open in the Reader, its section reported. */
async function open(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(ReadingHost, null, createElement(Reader))); });
  await settle();
  await act(async () => { world.page!.onBlocks!(BLOCKS, { index: 0, href: 's0.xhtml', spine: 1 }); });
  await settle();
  return tree;
}
/** One press of the Player's Tap Lock button, which it reads back as pressed. */
const press = async (on: boolean) => {
  await act(async () => { world.player!.onTapLock(on); });
  await settle();
  expect(world.player!.tapLock).toBe(on);
};
const play = async () => {
  await act(async () => { world.player!.onPlay(); });
  await settle();
  expect(held()?.playing).toBe(true);
};
/** The back arrow or the edge swipe: the Reader screen unmounts and says it has gone. */
const leave = async (id = DOCUMENT) => {
  await act(async () => { handle().left(id); });
  await settle();
};
/** The Reader for `id` on screen again: the Reading Button, or the Document's row. */
const show = async (id = DOCUMENT) => {
  await act(async () => { handle().show(id); });
  await settle();
};
const lockLines = () => world.log.filter((line) => line.includes('tap lock'));
/** What the page was told, each change once: the doubled bridge is a new object every render, so the view tells it again. */
const told = () => world.told.filter((on, at) => at === 0 || on !== world.told[at - 1]);

beforeEach(() => { world.page = null; world.player = null; world.told = []; world.log = []; });

describe('the Tap Lock, for one visit to the reader (#336)', () => {
  it('starts off, and the button turns it on and off, telling the page and the Debug Log', async () => {
    const tree = await open();
    expect(world.player!.tapLock).toBe(false);
    await press(true);
    expect(world.player!.tapLock).toBe(true);
    await press(false);
    expect(world.player!.tapLock).toBe(false);
    expect(told()).toEqual([false, true, false]);
    expect(lockLines()).toEqual(['[reading] tap lock on', '[reading] tap lock off']);
    await act(async () => { tree.unmount(); });
  });

  it('holds while the Reader stays on screen, playing or paused', async () => {
    const tree = await open();
    await press(true);
    await play();
    await act(async () => { world.player!.onPause(); });
    await settle();
    expect(world.player!.tapLock).toBe(true);
    expect(told().at(-1)).toBe(true);
    await act(async () => { tree.unmount(); });
  });

  it('is turned off by leaving the Reader while the Reading plays, and is off on coming back', async () => {
    const tree = await open();
    await press(true);
    await play();
    await leave();
    expect(held()).toMatchObject({ id: DOCUMENT, playing: true });
    expect(told().at(-1)).toBe(false);
    await show();
    expect(held()).toMatchObject({ id: DOCUMENT, playing: true });
    expect(world.player!.tapLock).toBe(false);
    expect(lockLines()).toEqual(['[reading] tap lock on', '[reading] tap lock off: left the reader']);
    await act(async () => { tree.unmount(); });
  });

  it('says nothing about the lock when the Reader is left with it off', async () => {
    const tree = await open();
    await play();
    await leave();
    await show();
    expect(lockLines()).toEqual([]);
    await act(async () => { tree.unmount(); });
  });

  it('paused, leaving ends the Reading, and the Document opened again starts with the lock off', async () => {
    const tree = await open();
    await press(true);
    await leave();
    expect(held()).toBeNull();
    // The view goes in the same commit, before an effect on `shown` could run,
    // and still says why the lock went with it (#336, found on the simulator).
    expect(lockLines()).toEqual(['[reading] tap lock on', '[reading] tap lock off: left the reader']);
    await show();
    await settle();
    expect(held()).toMatchObject({ id: DOCUMENT });
    expect(world.player!.tapLock).toBe(false);
    expect(lockLines()).toHaveLength(2);
    await act(async () => { tree.unmount(); });
  });

  it('another Document opened starts with the lock off', async () => {
    const tree = await open();
    await press(true);
    await play();
    await show(OTHER);
    await settle();
    expect(held()).toMatchObject({ id: OTHER });
    expect(world.player!.tapLock).toBe(false);
    expect(lockLines()).toEqual(['[reading] tap lock on', '[reading] tap lock off: left the reader']);
    await act(async () => { tree.unmount(); });
  });
});

describe('the Tap Lock is not a setting (#336)', () => {
  it('has no place in the settings, so nothing carries it to the next launch', () => {
    expect(Object.keys(DEFAULT_SETTINGS)).not.toContain('tapLock');
  });
});
