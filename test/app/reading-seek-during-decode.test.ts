import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';
import { useReading, type Reading } from '../../src/app/use-reading';
import type { SynthesisResult } from '../../src/core/providers/types';
import { createPlaybackEngine, type PlaybackEngine } from '../../src/playback/engine';
import type { ReportedBlock } from '../../src/renderer/messages';

/**
 * A Skip that lands while the queue waits on a native call (a Clip being
 * decoded, or the audio session being activated) onto sentences already held
 * in memory: their Clips are fetched and never queued.
 *
 * Real: `useReading`, the offline runtime's Provider, the playback engine, the
 * Clip fetcher and its memory cache, `audio-graph.ts`. Doubled: the native
 * audio library (its queue node records buffers and ends one when the test says
 * so; its decoder and its session activation can be held open, as the native
 * side is for a moment on a phone), the reader page's bridge, the saved-audio
 * repository (every sentence is saved, as in a Downloaded chapter) and the
 * Keychain. No request can leave: `test/setup.ts` forbids `fetch`.
 */
const world = vi.hoisted(() => ({
  nodes: [] as { queue: string[]; ended: ((e: { bufferId: string }) => void) | null; position: ((e: { value: number }) => void) | null }[],
  buffers: 0,
  holdDecode: false,
  decodes: [] as (() => void)[],
  holdSession: false,
  sessions: [] as (() => void)[],
  page: null as null | { onBlocks?(blocks: readonly unknown[], section: { index: number; href: string; spine: number }): void },
}));

vi.mock('react-native-audio-api', () => {
  class FakeBuffer {
    constructor(public length: number) {}
    copyToChannel() {}
    getChannelData() { return new Float32Array(this.length); }
  }
  class AudioContext {
    sampleRate: number;
    destination = {};
    constructor(options: { sampleRate: number }) { this.sampleRate = options.sampleRate; }
    createBufferQueueSource() {
      const record: (typeof world.nodes)[number] = { queue: [], ended: null, position: null };
      world.nodes.push(record);
      return {
        playbackRate: { value: 1 },
        onPositionChangedInterval: 0,
        set onPositionChanged(cb: typeof record.position) { record.position = cb; },
        set onBufferEnded(cb: typeof record.ended) { record.ended = cb; },
        connect() {},
        disconnect() {},
        enqueueBuffer() { const id = String(++world.buffers); record.queue.push(id); return id; },
        dequeueBuffer(id: string) { record.queue = record.queue.filter((one) => one !== id); },
        pause() {},
        stop() { record.queue = []; },
        node: { start() {} },
      };
    }
    createBuffer(_channels: number, frames: number) { return new FakeBuffer(frames); }
    async resume() {}
    async suspend() {}
    async close() {}
    decodeAudioData(): Promise<FakeBuffer> {
      if (!world.holdDecode) return Promise.resolve(new FakeBuffer(2400));
      return new Promise((resolve) => world.decodes.push(() => resolve(new FakeBuffer(2400))));
    }
  }
  const AudioManager = {
    setAudioSessionOptions() {},
    setAudioSessionActivity(active: boolean): Promise<void> {
      if (!active || !world.holdSession) return Promise.resolve();
      return new Promise((resolve) => world.sessions.push(resolve));
    },
    getDevicePreferredSampleRate: () => 48000,
    observeAudioInterruptions() {},
    addSystemEventListener: () => ({ remove() {} }),
  };
  return { AudioContext, AudioManager };
});
vi.mock('react-native', () => ({
  useColorScheme: () => 'light',
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  Platform: { OS: 'ios' },
}));
vi.mock('expo-file-system', () => ({ FileMode: { ReadOnly: 'r' } }));
vi.mock('../../modules/open-reader-offline', () => ({
  offlineNative: {
    addListener: () => ({ remove() {} }),
    beginBackground: async () => true,
    endBackground: async () => {},
    submitContinued: async () => false,
    updateContinued: async () => {},
    finishContinued: async () => {},
  },
}));
vi.mock('../../src/keys/store', () => ({
  readProviderKey: async () => ({ outcome: 'found', secret: 'test-key' }),
  readGatewayHeaders: async () => ({ outcome: 'found', secret: '' }),
}));
/** Every sentence is saved on the phone, and read back as `src/offline/audio-files.ts` reads an Apple Lossless Clip. */
vi.mock('../../src/offline/database', () => ({
  offlineRepository: async () => ({
    readClip: async () => ({ clip: { audio: 'encoded', bytes: new Uint8Array(64), mediaType: 'audio/mp4' }, dropped: false }),
  }),
}));
vi.mock('../../src/renderer', async () => ({
  ...(await vi.importActual<typeof import('../../src/renderer/cursor')>('../../src/renderer/cursor')),
  useReaderBridge: (options: typeof world.page) => {
    world.page = options;
    return {
      goTo() {}, goToSection() {}, browse() {}, show() {}, clock: { onClip() {}, onPosition() {} },
      setUtterances() {}, setInset() {}, setOpenPlayer() {}, setLinePosition() {}, setScrolling() {}, setBar() {},
      setAppearance() {}, setTheme() {}, resumeFollowing() {}, hold() {}, clear() {},
      returnToReading() {}, setFollowOnly() {}, snapshot() {}, readerProps: {},
    };
  },
}));
vi.mock('../../src/app/body-text-sizes', () => ({ readBodyTextSize: () => null, writeBodyTextSize: () => {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/** The live native queue node: a seek replaces it (`AudioGraph.clear`). */
const node = () => world.nodes[world.nodes.length - 1]!;
const tick = () => new Promise((resolve) => setImmediate(resolve));
/** Everything already due. No timer is advanced. */
async function settle() {
  await act(async () => { for (let i = 0; i < 20; i++) await tick(); });
}
/** The native call that was held finishes, the new source reports its position (zero: nothing of it has played), and half a minute passes. */
async function nativeAnswersAndTimePasses(reportPosition = true) {
  world.holdDecode = false;
  world.holdSession = false;
  await act(async () => { for (const finish of [...world.decodes.splice(0), ...world.sessions.splice(0)]) finish(); });
  await settle();
  await act(async () => {
    if (reportPosition) node().position?.({ value: 0 });
    await vi.advanceTimersByTimeAsync(30_000);
  });
  await settle();
}

const engines: PlaybackEngine[] = [];
let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  Object.assign(world, { nodes: [], buffers: 0, holdDecode: false, decodes: [], holdSession: false, sessions: [], page: null });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});
afterEach(async () => {
  await act(async () => { tree?.unmount(); });
  tree = undefined;
  for (const engine of engines.splice(0)) await engine.dispose();
  vi.useRealTimers();
});

describe('the Reader: previous-sentence in a Downloaded chapter, pressed while the next Clip is being decoded', () => {
  it('goes on reading from the sentence skipped to', async () => {
    const settings: AppSettings = { ...DEFAULT_SETTINGS, provider: 'fish', enabledProviders: ['fish'], voice: 'A' };
    const blocks: ReportedBlock[] = ['One.', 'Two.', 'Three.', 'Four.', 'Five.'].map((text, at) => ({
      id: `0.${at}`, text, role: 'paragraph' as const, section: 's0.xhtml', sectionIndex: 0, cfi: `epubcfi(/6/2[s0]!/4/${2 * (at + 1)})`,
    }));
    let reading!: Reading;
    function Probe() {
      reading = useReading(settings, { hasKey: true, writtenAt: 0 }, null, 'sha256:' + 'd'.repeat(64));
      return null;
    }
    await act(async () => { tree = create(createElement(Probe)); });
    await act(async () => { world.page!.onBlocks!(blocks, { index: 0, href: 's0.xhtml', spine: 1 }); });
    await settle();

    await act(async () => { reading.play(); });
    await settle();
    expect({ buffering: reading.status.buffering, queued: node().queue.length }).toEqual({ buffering: false, queued: 4 });

    // 'One.' is heard to its end: the read-ahead reads 'Five.' from the phone and hands it to the decoder.
    world.holdDecode = true;
    await act(async () => { node().ended!({ bufferId: node().queue.shift()! }); });
    await settle();
    expect(reading.status.utterance).toBe(1);
    expect(world.decodes).toHaveLength(1);

    // The owner presses previous-sentence while that decode is still running.
    await act(async () => { reading.skip('previous-sentence'); });
    await settle();
    await nativeAnswersAndTimePasses();

    const { playing, buffering, utterance } = reading.status;
    expect({ playing, utterance }).toEqual({ playing: true, utterance: 0 });
    expect({ buffering, queued: node().queue.length }).toEqual({ buffering: false, queued: 4 });
  });
});

describe('the engine alone: one sentence, sought again while its queueing waits on a native call', () => {
  const ONE = [{ text: 'One.', speakable: true, spans: [{ block: 0, start: 0, end: 4, textOffset: 0 }] }];
  const encoded = (): SynthesisResult => ({ audio: 'encoded', bytes: new Uint8Array(64), mediaType: 'audio/mpeg' });
  const pcm = (): SynthesisResult => ({ audio: 'pcm', samples: new Uint8Array(4800), sampleRate: 24000 });

  function playing(reply: () => SynthesisResult, list = ONE) {
    const states: string[] = [];
    const cues: number[] = [];
    const synthesize = vi.fn(async () => reply());
    const engine = createPlaybackEngine({
      provider: { id: 'compatible', capabilities: { wordTimestamps: false }, listVoices: async () => [], synthesize },
      voice: 'v',
      clock: { onClip: (cue) => cues.push(cue.utterance), onPosition() {} },
      onError: (error) => states.push(`error: ${String(error)}`),
      onState: (state) => states.push(`${state.playing ? 'playing' : 'paused'}${state.buffering ? ', buffering' : ''}`),
    });
    engines.push(engine);
    engine.load(list, 0);
    engine.play();
    return { engine, states, cues, synthesize };
  }

  it('an encoded Clip being decoded', async () => {
    world.holdDecode = true;
    const { engine, states } = playing(encoded);
    await settle();
    expect(world.decodes).toHaveLength(1);
    engine.seek(0);
    await settle();
    await nativeAnswersAndTimePasses();
    expect({ queued: node().queue.length, state: states.at(-1) }).toEqual({ queued: 1, state: 'playing' });
  });

  it('a PCM Clip, the first of a new engine, while the audio session is being activated', async () => {
    world.holdSession = true;
    const { engine, states } = playing(pcm);
    await settle();
    expect(world.sessions).toHaveLength(1);
    engine.seek(0);
    await settle();
    await nativeAnswersAndTimePasses();
    expect({ queued: node().queue.length, state: states.at(-1) }).toEqual({ queued: 1, state: 'playing' });
  });

  it('coalesces repeated seeks and queues only the latest generation', async () => {
    world.holdDecode = true;
    const list = ['One.', 'Two.', 'Three.'].map((text, block) => ({
      text, speakable: true, spans: [{ block, start: 0, end: text.length, textOffset: 0 }],
    }));
    const { engine, cues } = playing(encoded, list);
    await settle();
    engine.seek(1);
    await settle();
    engine.seek(2);
    await settle();
    expect(world.decodes).toHaveLength(1); // no concurrent drain workers
    await nativeAnswersAndTimePasses();
    expect(cues).toEqual([2]);
    expect(node().queue).toHaveLength(1);
    expect(engine.snapshot()).toMatchObject({ utterance: 2, queued: 1, fetching: 0 });
  });

  it.each(['pause', 'silence', 'dispose'] as const)('does not resume after %s during the held decode', async (action) => {
    world.holdDecode = true;
    const { engine, states, cues } = playing(encoded);
    await settle();
    engine.seek(0);
    await settle();
    await engine[action]();
    await nativeAnswersAndTimePasses(false);
    expect(states.at(-1)).not.toBe('playing');
    if (action === 'pause') {
      expect(engine.snapshot()).toMatchObject({ playing: false, queued: 1 });
      engine.play();
      await settle();
      expect(states.at(-1)).toBe('playing');
    } else {
      expect(node().queue).toHaveLength(0);
      expect(cues).toEqual([]);
    }
  });

  it('keeps a quiet reload quiet until Play, even after the old decode returns', async () => {
    world.holdDecode = true;
    const { engine, cues } = playing(encoded);
    await settle();
    engine.pause();
    engine.load(ONE, 0, { quiet: true });
    await settle();
    // A paused native source emits no position event. Only the decode returns.
    await nativeAnswersAndTimePasses(false);
    expect(node().queue).toHaveLength(1);
    expect(cues).toEqual([]);
    engine.setRate(2);
    expect(cues).toEqual([]);
    engine.play();
    expect(cues).toEqual([0]);
  });

  it('control: the same seek once the decode has finished', async () => {
    const { engine, states } = playing(encoded);
    await settle();
    engine.seek(0);
    await settle();
    await nativeAnswersAndTimePasses();
    expect({ queued: node().queue.length, state: states.at(-1) }).toEqual({ queued: 1, state: 'playing' });
  });
});