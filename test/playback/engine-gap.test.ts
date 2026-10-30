import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ClipProvider } from '../../src/playback/clips';
import { createPlaybackEngine, type PlaybackEngine } from '../../src/playback/engine';
import type { GapSettings } from '../../src/playback/gap';

/**
 * The pauses, live (#159, ADR 0047's amendment). Since #68 a Reading left
 * playing keeps its engine behind the Library, where General can change the
 * pauses, so the engine takes a new pair with `setGap` instead of reading one
 * once when it is built.
 *
 * The pause is silence written into a Clip's own buffer after its speech
 * (`audio-graph.ts`), so what a Clip was queued with is the length of the
 * buffer the audio module was asked for, less the speech.
 */
const engines: PlaybackEngine[] = [];
afterEach(async () => { for (const engine of engines.splice(0)) await engine.dispose(); });

/** `react-native-audio-api`, as far as the engine can tell: the buffers it is asked for, and a queue the test plays out. */
const audio = vi.hoisted(() => {
  interface Source {
    queue: string[];
    onBufferEnded: ((event: { bufferId: string; isLastBufferInQueue: boolean }) => void) | null;
  }
  const world = { source: null as Source | null, ids: 0, frames: [] as number[] };
  class AudioContext {
    sampleRate: number;
    destination = {};
    constructor(options: { sampleRate: number; enableWorklets?: boolean }) {
      if (options.enableWorklets !== false) throw new Error('Narration must not allocate an unused Worklets runtime');
      this.sampleRate = options.sampleRate;
    }
    createBufferQueueSource() {
      const source: Source = { queue: [], onBufferEnded: null };
      world.source = source;
      return {
        playbackRate: { value: 1 },
        onPositionChangedInterval: 0,
        set onPositionChanged(_callback: unknown) {},
        set onBufferEnded(callback: Source['onBufferEnded']) { source.onBufferEnded = callback; },
        connect() {},
        disconnect() {},
        stop() { source.queue = []; },
        enqueueBuffer() {
          const id = String(++world.ids);
          source.queue.push(id);
          return id;
        },
        pause() {},
        node: { start() {} },
      };
    }
    createBuffer(_channels: number, length: number) { world.frames.push(length); return { length, copyToChannel() {} }; }
    async resume() {}
    async suspend() {}
    async close() {}
  }
  const AudioManager = {
    setAudioSessionOptions() {},
    setAudioSessionActivity: async () => {},
    observeAudioInterruptions() {},
    addSystemEventListener: () => ({ remove() {} }),
  };
  /** The buffer at the front of the queue is played to its end. */
  function endOne() {
    const source = world.source!;
    const bufferId = source.queue.shift()!;
    source.onBufferEnded?.({ bufferId, isLastBufferInQueue: source.queue.length === 0 });
  }
  return { world, endOne, module: { AudioContext, AudioManager } };
});
vi.mock('react-native-audio-api', () => audio.module);

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}

const HZ = 24000;
/** Each Clip is 0.5 s of speech. */
const SPEECH = 12000;
/** The silence each queued Clip carries, in milliseconds at Natural Pace. */
const pauses = () => audio.world.frames.map((frames) => ((frames - SPEECH) / HZ) * 1000);

/** Twenty one-sentence paragraphs, so every pause is the Pause between paragraphs. */
const sentences = Array.from({ length: 20 }, (_, i) => {
  const text = `Sentence number ${i}.`;
  return { text, speakable: true, spans: [{ block: i, start: 0, end: text.length, textOffset: 0 }] };
});

/** A Provider without Word Timings, so each Clip is one buffer, answering at once. */
const provider: ClipProvider = {
  id: 'local', capabilities: { wordTimestamps: false }, listVoices: async () => [],
  synthesize: async () => ({ audio: 'pcm', samples: new Uint8Array(SPEECH * 2), sampleRate: HZ }),
};

function playing(gap: GapSettings) {
  audio.world.frames = [];
  const engine = createPlaybackEngine({
    provider, voice: 'v', gap,
    clock: { onClip: () => {}, onPosition: () => {} },
    onError: () => {}, onState: () => {}, onOutOfText: () => {},
  });
  engines.push(engine);
  engine.load(sentences, 0);
  engine.play();
  return engine;
}

describe('a pair of pauses given while the Reading plays (#159)', () => {
  it('is the silence after every Clip queued from then on', async () => {
    const engine = playing({ sentenceMs: 0, paragraphMs: 200 });
    await settle();
    const before = pauses().length;
    expect(before).toBeGreaterThan(0);
    expect(new Set(pauses())).toEqual(new Set([200]));

    engine.setGap({ sentenceMs: 0, paragraphMs: 2000 });
    audio.endOne(); await settle();
    audio.endOne(); await settle();

    const after = pauses().slice(before);
    expect(after.length).toBeGreaterThan(0);
    expect(new Set(after)).toEqual(new Set([2000]));
  });

  it('leaves the Clips already queued as they were, and queues none of them again', async () => {
    const engine = playing({ sentenceMs: 0, paragraphMs: 200 });
    await settle();
    const queued = [...pauses()];

    engine.setGap({ sentenceMs: 0, paragraphMs: 2000 });
    await settle();

    expect(pauses()).toEqual(queued);
  });

  it('is kept through Pause and Play', async () => {
    const engine = playing({ sentenceMs: 0, paragraphMs: 200 });
    await settle();
    const before = pauses().length;

    engine.pause();
    engine.setGap({ sentenceMs: 0, paragraphMs: 1000 });
    engine.play();
    audio.endOne(); await settle();

    const after = pauses().slice(before);
    expect(after.length).toBeGreaterThan(0);
    expect(new Set(after)).toEqual(new Set([1000]));
  });
});
