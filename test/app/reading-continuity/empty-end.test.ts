import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import type { ReportedBlock } from '../../../src/renderer/messages';
import { DEFAULT_SETTINGS, type AppSettings } from '../../../src/app/settings';
import { useReading, type Reading } from '../../../src/app/use-reading';

/**
 * The last section of a Document holds no text and reports after the last
 * sentence has been spoken.
 *
 * Real: `useReading`, the segmenter, `createPlaybackEngine` and
 * `src/playback/audio-graph.ts`.
 *
 * Doubled:
 * - the page (`useReaderBridge`): the test calls `onBlocks` itself, with what
 *   `reader-bridge.ts` hands over for a section's first report (every Block
 *   reported so far, and that section's index);
 * - `react-native-audio-api`: a queue whose buffers end when the test says so;
 * - the Provider: answers every sentence with 0.1 s of silence;
 * - `react-native`'s `useColorScheme`, `src/now-playing`, `src/app/body-text-sizes`.
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
        returnToReading() {}, setFollowOnly() {}, snapshot() {}, readerProps: {},
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

const DOCUMENT = 'sha256:' + 'f'.repeat(64);
const READY: AppSettings = { ...DEFAULT_SETTINGS, provider: 'local', enabledProviders: ['local'], voice: 'af_bella' };
const WAITING = 'waiting for more of it';
const ENDED = 'The reading has stopped at the end of the book.';

/** A section's Blocks as the page reports them: one paragraph per text. */
function blocks(section: number, texts: readonly string[]): ReportedBlock[] {
  return texts.map((text, at) => ({
    id: `${section}.${at}`, text, role: 'paragraph' as const, section: `s${section}.xhtml`, sectionIndex: section,
    cfi: `epubcfi(/6/${2 * (section + 1)}[s${section}]!/4/${2 * (at + 1)})`,
  }));
}

/** A Document of two spine items, opened; the first holds two sentences. */
async function open() {
  let reading!: Reading;
  function Probe() {
    reading = useReading(READY, { hasKey: false, writtenAt: 0 }, null, DOCUMENT);
    return null;
  }
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Probe)); });
  const settle = async (ms = 0) => {
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
  };
  const text = () => blocks(0, ['First paragraph.', 'Second paragraph.']);
  return {
    /** The page reports spine item `section` for the first time: every Block so far, and that section's index. */
    report: (all: readonly ReportedBlock[], section: number) =>
      act(async () => { world.onBlocks!(all, { index: section, href: `s${section}.xhtml`, spine: 2 }); await settle(); }),
    text,
    play: () => act(async () => { reading.play(); await settle(); }),
    pause: () => act(async () => { reading.pause(); await settle(); }),
    /** Both sentences are heard to their end, and a moment passes. */
    async hearAll() {
      for (let turn = 0; turn < 2; turn++) await act(async () => { world.endAll(); await settle(); });
      await act(async () => { await settle(50); });
    },
    wait: (ms: number) => act(async () => { await settle(ms); }),
    get status() { const s = reading.status; return { playing: s.playing, buffering: s.buffering, utterance: s.utterance, note: s.note }; },
    close: () => act(async () => { tree.unmount(); }),
  };
}

describe('the last spine item holds no text', () => {
  it('reporting after the last sentence was spoken: the Reading stops at the end of the book', async () => {
    const book = await open();
    await book.report(book.text(), 0);
    await book.play();
    await book.hearAll();
    console.log('ran out :', JSON.stringify(book.status));
    expect(book.status.note).toContain(WAITING);

    // The last spine item is laid out and holds no text: the same Blocks, under its index.
    await book.report(book.text(), 1);
    await book.wait(500);
    console.log('after   :', JSON.stringify(book.status));
    expect(book.status.playing).toBe(false);
    expect(book.status.note).toContain(ENDED);
    await book.close();
  });

  it('control: reporting before the last sentence was spoken, the Reading stops at the end of the book', async () => {
    const book = await open();
    await book.report(book.text(), 0);
    await book.report(book.text(), 1);
    await book.play();
    await book.hearAll();
    expect(book.status.playing).toBe(false);
    expect(book.status.note).toContain(ENDED);
    await book.close();
  });

  it('control: a last spine item with text, reporting late, is read and then the Reading stops at the end of the book', async () => {
    const book = await open();
    await book.report(book.text(), 0);
    await book.play();
    await book.hearAll();
    expect(book.status.note).toContain(WAITING);

    await book.report([...book.text(), ...blocks(1, ['Third paragraph.'])], 1);
    for (let turn = 0; turn < 40 && book.status.playing; turn++) await book.hearAll();
    expect(book.status).toMatchObject({ playing: false, utterance: 2 });
    expect(book.status.note).toContain(ENDED);
    await book.close();
  });

  it('a repeated empty last-section report does not restart a finished Reading', async () => {
    const book = await open();
    await book.report(book.text(), 0);
    await book.play();
    await book.hearAll();
    await book.report(book.text(), 1);
    await book.report(book.text(), 1);
    expect(book.status).toMatchObject({ playing: false, buffering: false });
    expect(book.status.note).toContain(ENDED);
    await book.close();
  });
});
