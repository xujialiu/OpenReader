import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { contentsOf } from '../../../src/core/document/contents';
import type { ReportedBlock } from '../../../src/renderer/messages';
import { DEFAULT_SETTINGS, type AppSettings } from '../../../src/app/settings';
import { useReading, type Reading } from '../../../src/app/use-reading';

/**
 * The Sleep Timer's request reaching the engine (#326): the Reading pauses by
 * itself at the end of the sentence being spoken, or of the chapter, says so
 * through `onSlept`, and the next Play reads on from the sentence after it.
 *
 * Real: `useReading`, the segmenter, `createPlaybackEngine`,
 * `src/playback/audio-graph.ts` and the Contents rule.
 *
 * Doubled as in `empty-end.test.ts`: the page, `react-native-audio-api` (a
 * queue whose buffers end when the test says so), the Provider, and
 * `react-native`'s `useColorScheme`, `src/now-playing`, `src/app/body-text-sizes`.
 */

interface FakeNode {
  queue: string[];
  onBufferEnded: ((e: { bufferId: string; isLastBufferInQueue: boolean }) => void) | null;
}

const world = vi.hoisted(() => ({
  nodes: [] as FakeNode[],
  nextBuffer: 0,
  onBlocks: null as null | ((blocks: readonly unknown[], section: { index: number; href: string; spine: number }) => void),
  /** The audio thread finishing every queued buffer, front first. */
  endAll() {
    const node = this.nodes[this.nodes.length - 1];
    for (let id = node?.queue.shift(); node && id !== undefined; id = node.queue.shift()) {
      node.onBufferEnded?.({ bufferId: id, isLastBufferInQueue: node.queue.length === 0 });
    }
  },
}));

vi.mock('react-native-audio-api', () => {
  class FakeBuffer {
    constructor(public channels: number, public length: number, public sampleRate: number) {}
    copyToChannel() {}
    getChannelData() { return new Float32Array(this.length); }
  }
  class AudioContext {
    sampleRate: number;
    destination = {};
    constructor(options: { sampleRate: number }) { this.sampleRate = options.sampleRate; }
    createBufferQueueSource() {
      const record: FakeNode = { queue: [], onBufferEnded: null };
      world.nodes.push(record);
      return {
        playbackRate: { value: 1 },
        onPositionChangedInterval: 0,
        set onPositionChanged(_cb: unknown) {},
        set onBufferEnded(cb: FakeNode['onBufferEnded']) { record.onBufferEnded = cb; },
        connect() {},
        disconnect() {},
        enqueueBuffer() { const id = String(++world.nextBuffer); record.queue.push(id); return id; },
        dequeueBuffer(id: string) { record.queue = record.queue.filter((queued) => queued !== id); },
        pause() {},
        stop() { record.queue = []; },
        node: { start() {} },
      };
    }
    createBuffer(channels: number, frames: number, hz: number) { return new FakeBuffer(channels, frames, hz); }
    async resume() {}
    async suspend() {}
    async close() {}
    decodeAudioData() { return Promise.resolve(new FakeBuffer(1, 2400, this.sampleRate)); }
  }
  const AudioManager = {
    setAudioSessionOptions() {},
    setAudioSessionActivity: () => Promise.resolve(),
    getDevicePreferredSampleRate: () => 48000,
    observeAudioInterruptions() {},
    addSystemEventListener: () => ({ remove() {} }),
  };
  return { AudioContext, AudioManager };
});
vi.mock('react-native', () => ({ useColorScheme: () => 'light' }));
vi.mock('../../../src/renderer', async () => {
  const cursor = await vi.importActual<typeof import('../../../src/renderer/cursor')>('../../../src/renderer/cursor');
  return {
    ...cursor,
    useReaderBridge: (options: { onBlocks?: typeof world.onBlocks }) => {
      world.onBlocks = options.onBlocks ?? null;
      return {
        goTo() {}, goToSection() {}, prepareSection() {}, browse() {}, show() {},
        clock: { onClip() {}, onPosition() {} },
        setUtterances() {}, setInset() {}, setOpenPlayer() {}, setLinePosition() {}, setScrolling() {}, setBar() {},
        setAppearance() {}, setTheme() {}, resumeFollowing() {}, hold() {}, clear() {},
        returnToReading() {}, setFollowOnly() {}, setTapLock() {}, snapshot() {}, readerProps: {},
      };
    },
  };
});
vi.mock('../../../src/offline/runtime', () => ({
  hasSavedVoice: () => false,
  inventoryReady: () => true,
  offlineProvider: () => ({
    id: 'local',
    capabilities: { wordTimestamps: false },
    listVoices: async () => [],
    synthesize: async () => ({ audio: 'pcm', samples: new Uint8Array(4800), sampleRate: 24000 }),
  }),
}));
vi.mock('../../../src/now-playing', () => ({ lockScreenPosition: () => {}, restateNowPlaying: () => {} }));
vi.mock('../../../src/app/body-text-sizes', () => ({ readBodyTextSize: () => null, writeBodyTextSize: () => {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const DOCUMENT = 'sha256:' + 'e'.repeat(64);
const READY: AppSettings = { ...DEFAULT_SETTINGS, provider: 'local', enabledProviders: ['local'], voice: 'af_bella' };
const SPINE = 3;
const ROWS = contentsOf(
  [{ id: 'a', href: 's0.xhtml', label: 'One' }, { id: 'b', href: 's1.xhtml', label: 'Two' }, { id: 'c', href: 's2.xhtml', label: 'Three' }],
  ['s0.xhtml', 's1.xhtml', 's2.xhtml'],
).rows;

/** A section's Blocks as the page reports them: one paragraph per text. */
function blocks(section: number, texts: readonly string[]): ReportedBlock[] {
  return texts.map((text, at) => ({
    id: `${section}.${at}`, text, role: 'paragraph' as const, section: `s${section}.xhtml`, sectionIndex: section,
    cfi: `epubcfi(/6/${2 * (section + 1)}[s${section}]!/4/${2 * (at + 1)})`,
  }));
}

/** Three chapters of two sentences each, every one laid out. */
async function open() {
  let reading!: Reading;
  const slept: number[] = [];
  function Probe() {
    reading = useReading(READY, { hasKey: false, writtenAt: 0 }, null, DOCUMENT, undefined, undefined, () => slept.push(Date.now()));
    return null;
  }
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Probe)); });
  const settle = async (ms = 0) => {
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
  };
  const all = [
    ...blocks(0, ['First of one.', 'Second of one.']),
    ...blocks(1, ['First of two.', 'Second of two.']),
    ...blocks(2, ['First of three.', 'Second of three.']),
  ];
  for (let section = 0; section < SPINE; section++) {
    await act(async () => { world.onBlocks!(all.filter((block) => block.sectionIndex <= section), { index: section, href: `s${section}.xhtml`, spine: SPINE }); await settle(); });
  }
  return {
    slept,
    play: () => act(async () => { reading.play(); await settle(150); }),
    stopAt: (request: Parameters<Reading['stopAt']>[0]) => act(async () => { reading.stopAt(request); await settle(); }),
    /** The front buffer is heard to its end, and the 100 ms the engine adds between chapters passes. */
    async hearOne() {
      await act(async () => {
        const node = world.nodes[world.nodes.length - 1];
        const id = node?.queue.shift();
        if (node && id !== undefined) node.onBufferEnded?.({ bufferId: id, isLastBufferInQueue: node.queue.length === 0 });
        await settle(150);
      });
    },
    get status() { const s = reading.status; return { playing: s.playing, utterance: s.utterance, note: s.note }; },
    close: () => act(async () => { tree.unmount(); }),
  };
}

describe('the Sleep Timer stops the Reading by itself', () => {
  it('at the end of the sentence being spoken, and Play reads on from the next', async () => {
    const book = await open();
    await book.play();
    expect(book.status).toMatchObject({ playing: true, utterance: 0 });
    await book.stopAt({ kind: 'sentence' });
    await book.hearOne();
    expect({ status: book.status, slept: book.slept.length }).toEqual({ status: { playing: false, utterance: 0, note: null }, slept: 1 });
    await book.play();
    expect(book.status).toMatchObject({ playing: true, utterance: 1 });
    await book.close();
  });

  it('at the end of the chapter, before the next chapter’s first sentence', async () => {
    const book = await open();
    await book.stopAt({ kind: 'chapter', rows: ROWS });
    await book.play();
    for (let turn = 0; turn < 6 && book.status.playing; turn++) await book.hearOne();
    expect({ status: book.status, slept: book.slept.length }).toEqual({ status: { playing: false, utterance: 1, note: null }, slept: 1 });
    await book.play();
    expect(book.status).toMatchObject({ playing: true, utterance: 2 });
    await book.close();
  });

  it('once: after it, the Reading reads on through the next chapter', async () => {
    const book = await open();
    await book.stopAt({ kind: 'chapter', rows: ROWS });
    await book.play();
    for (let turn = 0; turn < 6 && book.status.playing; turn++) await book.hearOne();
    await book.play();
    // Sentences 2, 3 and 4 heard: past the end of chapter Two, at sentence 3, into Three.
    for (let turn = 0; turn < 3; turn++) await book.hearOne();
    expect({ status: book.status, slept: book.slept.length }).toMatchObject({ status: { playing: true, utterance: 5 }, slept: 1 });
    await book.close();
  });

  it('not when the request is taken back', async () => {
    const book = await open();
    await book.stopAt({ kind: 'chapter', rows: ROWS });
    await book.play();
    await book.stopAt(null);
    for (let turn = 0; turn < 3; turn++) await book.hearOne();
    expect({ status: book.status, slept: book.slept.length }).toMatchObject({ status: { playing: true, utterance: 3 }, slept: 0 });
    await book.close();
  });
});
