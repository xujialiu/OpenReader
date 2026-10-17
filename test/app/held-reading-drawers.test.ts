import { createElement, useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentId, LibraryEntry } from '../../src/core/document';
import type { ReportedBlock } from '../../src/renderer/messages';
import { ReadingHost, useHeldReading, type ReadingHandle } from '../../src/app/reading-host';
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';

/**
 * Contents or Voice, open when the Reader is left (#214): `reader-screen.tsx`'s
 * cleanup calls `left(id)` for the back arrow and the edge swipe alike, and a
 * playing Reading keeps its view, parked behind the navigator (ADR 0049).
 *
 * Real: ReadingHost, ReadingView, useReading, useLookup and the playback engine.
 * Doubled: the shell's Library and sync, the page (the WebView bridge), the
 * native audio graph, the Provider, the lock screen module, and the view's
 * children. ContentsSheet and VoiceSheet are probes that record the `visible`
 * they are given, which is what `drawer.tsx` turns into `isPresented` for the
 * phone. The portal renders its children in place, so nothing here says what
 * iOS does with a Drawer whose host view is moved.
 */
const sheets = vi.hoisted(() => ({ contents: false, voices: false }));
const world = vi.hoisted(() => ({
  shell: null as unknown,
  handle: null as unknown,
  page: null as null | { onBlocks?(blocks: readonly unknown[], section: { index: number; href: string; spine: number }): void },
  player: null as null | { onPlay(): void; onPause(): void; onContents(): void; onVoices(): void },
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
        returnToReading: nothing, setFollowOnly: nothing, releaseSelection: nothing, restart: () => null, readerProps: {},
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
  releaseProgress: () => {}, requestProgress: () => {}, requestInventory: async () => {}, useDownloads: () => 0, setReadingPlays: () => {},
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
// The view's children. Contents and Voice record the `visible` they are given.
vi.mock('../../src/app/contents-sheet', () => ({ ContentsSheet: (props: { visible: boolean }) => { sheets.contents = props.visible; return null; } }));
vi.mock('../../src/app/voice-sheet', () => ({ VoiceSheet: (props: { visible: boolean }) => { sheets.voices = props.visible; return null; } }));
vi.mock('../../src/app/lookup-drawer', () => ({ LookupDrawer: () => null }));
vi.mock('../../src/app/player', () => ({ Player: (props: NonNullable<typeof world.player>) => { world.player = props; return null; } }));
vi.mock('../../src/app/document-cover', () => ({ useDocumentCover: () => null }));
vi.mock('../../src/app/reader-file-system', () => ({ useReaderFileSystem: () => ({}) }));
vi.mock('../../src/app/use-voices', () => ({ useVoiceLists: () => ({ voicesOf: () => null, ask() {}, asking: () => false, noteOf: () => null }) }));
vi.mock('../../src/app/voice-catalog', () => ({ knownVoice: () => null }));
vi.mock('../../src/app/controls', () => ({ INK: { page: '#fff', quiet: '#888' } }));
vi.mock('../../src/app/text-styles', () => ({ TEXT: { subhead: {} } }));
vi.mock('../../src/app/walkthrough-harness', () => ({ hlog() {}, probeScript: () => '', statusLine: () => '', useHarnessCommands() {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const DOCUMENT = ('sha256:' + 'd'.repeat(64)) as DocumentId;
const SETTINGS: AppSettings = { ...DEFAULT_SETTINGS, provider: 'local', enabledProviders: ['local'], voice: 'af_bella' };
const ENTRY: LibraryEntry = {
  id: DOCUMENT, format: 'epub', publicationId: null, publicationIdSource: 'none', title: 'A novel', position: null,
  voice: { provider: 'local', voice: 'af_bella' }, stamp: { at: 1, device: 'iPhone-test0001' },
};
world.shell = {
  settings: SETTINGS, setSettings() {}, secretRevisions: {},
  sync: { poke() {}, wait: async () => null },
  library: { entries: [ENTRY], adoptedAt: {}, current: () => ENTRY, opened() {}, voiced() {}, reached() {}, heard() {}, retitled() {} },
};

/** One section's Blocks as the page reports them, a sentence to a paragraph. */
const BLOCKS: ReportedBlock[] = ['Sentence one.', 'Sentence two.', 'Sentence three.'].map((text, at) => ({
  id: `0.${at}`, text, role: 'paragraph' as const, section: 's0.xhtml', sectionIndex: 0, cfi: `epubcfi(/6/2[s0]!/4/${2 * (at + 1)})`,
}));

/** The Reader screen: it asks for the Document's Reading as it arrives. */
function Reader() {
  const handle = useHeldReading();
  useEffect(() => { world.handle = handle; });
  const { show } = handle;
  useEffect(() => { show(DOCUMENT); }, [show]);
  return null;
}
const held = () => (world.handle as ReadingHandle).current;
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
};

/** The Document open in the Reader, its section reported, and Play pressed. */
async function playing(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(ReadingHost, null, createElement(Reader))); });
  await settle();
  await act(async () => { world.page!.onBlocks!(BLOCKS, { index: 0, href: 's0.xhtml', spine: 1 }); });
  await settle();
  await act(async () => { world.player!.onPlay(); });
  await settle();
  expect(held()?.playing).toBe(true);
  return tree;
}
/** The back arrow or the edge swipe: the Reader screen unmounts and says it has gone. */
const leave = async () => {
  await act(async () => { (world.handle as ReadingHandle).left(DOCUMENT); });
  await settle();
};

beforeEach(() => { world.page = null; world.player = null; sheets.contents = false; sheets.voices = false; });

/** Back to the Reader: the Reading Button or the Document's row shows the held Reading again. */
const comeBack = async () => {
  await act(async () => { (world.handle as ReadingHandle).show(DOCUMENT); });
  await settle();
};

describe('a Drawer of the Reader, open when the Reader is left (#214)', () => {
  it('while the Reading plays, Contents is closed as the page is parked, and stays closed on coming back', async () => {
    const tree = await playing();
    await act(async () => { world.player!.onContents(); });
    expect(sheets.contents).toBe(true);
    await leave();
    expect(held()).toMatchObject({ id: DOCUMENT, playing: true });
    expect(sheets.contents).toBe(false);
    await comeBack();
    expect(held()).toMatchObject({ id: DOCUMENT, playing: true });
    expect(sheets.contents).toBe(false);
    await act(async () => { tree.unmount(); });
  });

  it('while the Reading plays, Voice is closed as the page is parked, and stays closed on coming back', async () => {
    const tree = await playing();
    await act(async () => { world.player!.onVoices(); });
    expect(sheets.voices).toBe(true);
    await leave();
    expect(held()).toMatchObject({ id: DOCUMENT, playing: true });
    expect(sheets.voices).toBe(false);
    await comeBack();
    expect(sheets.voices).toBe(false);
    await act(async () => { tree.unmount(); });
  });

  it('opens Contents again after coming back, when asked', async () => {
    const tree = await playing();
    await act(async () => { world.player!.onContents(); });
    await leave();
    await comeBack();
    await act(async () => { world.player!.onContents(); });
    expect(sheets.contents).toBe(true);
    await act(async () => { tree.unmount(); });
  });

  it('paused, leaving ends the Reading, and the view goes with its Drawers', async () => {
    const tree = await playing();
    await act(async () => { world.player!.onPause(); });
    await settle();
    await act(async () => { world.player!.onContents(); });
    expect(sheets.contents).toBe(true);
    await leave();
    expect(held()).toBeNull();
    expect(tree.toJSON()).toBeNull();
    await act(async () => { tree.unmount(); });
  });
});
