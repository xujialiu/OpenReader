import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClipProvider } from '../../src/playback/clips';
import { createPlaybackEngine, type PlaybackEngine } from '../../src/playback/engine';
import type { SynthesisResult } from '../../src/core/providers/types';

const engines: PlaybackEngine[] = [];
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.dispose();
  vi.useRealTimers();
});

/**
 * `react-native-audio-api`, as far as the engine can tell: a queue of buffer
 * ids, and the two events of the source node, which the test fires by hand.
 */
const audio = vi.hoisted(() => {
  interface Source {
    queue: string[];
    onPositionChanged: ((event: { value: number }) => void) | null;
    onBufferEnded: ((event: { bufferId: string; isLastBufferInQueue: boolean }) => void) | null;
  }
  const world = { source: null as Source | null, ids: 0 };
  class AudioContext {
    sampleRate: number;
    destination = {};
    constructor(options: { sampleRate: number }) { this.sampleRate = options.sampleRate; }
    createBufferQueueSource() {
      const source: Source = { queue: [], onPositionChanged: null, onBufferEnded: null };
      world.source = source;
      return {
        playbackRate: { value: 1 },
        onPositionChangedInterval: 0,
        set onPositionChanged(callback: Source['onPositionChanged']) { source.onPositionChanged = callback; },
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
    createBuffer(_channels: number, length: number) { return { length, copyToChannel() {} }; }
    async resume() {}
    async suspend() {}
    async close() {}
  }
  const AudioManager = {
    setAudioSessionOptions() {},
    setAudioSessionActivity: async () => {},
    addSystemEventListener: () => ({ remove() {} }),
  };
  /** The once-a-second position report. */
  function position(value: number) { world.source!.onPositionChanged?.({ value }); }
  /** Every queued buffer is played to its end. */
  function endAll() {
    const source = world.source!;
    while (source.queue.length > 0) {
      const bufferId = source.queue.shift()!;
      source.onBufferEnded?.({ bufferId, isLastBufferInQueue: source.queue.length === 0 });
    }
  }
  return { position, endAll, module: { AudioContext, AudioManager } };
});
vi.mock('react-native-audio-api', () => audio.module);

/** Let every pending microtask and zero-delay timer run. */
async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}

/** Twenty one-sentence paragraphs. */
const sentences = Array.from({ length: 20 }, (_, i) => {
  const text = `Sentence number ${i}.`;
  return { text, speakable: true, spans: [{ block: i, start: 0, end: text.length, textOffset: 0 }] };
});

/** 0.5 s of 24 kHz PCM with two Word Timings, handed over when the test says so. */
function setup(log: string[], options: { refuseSecond?: boolean; sectionOf?: (utterance: number) => number } = {}) {
  const waiting: (() => void)[] = [];
  let calls = 0;
  const provider: ClipProvider = {
    id: 'fish', capabilities: { wordTimestamps: true }, listVoices: async () => [],
    synthesize: () => {
      if (options.refuseSecond && calls++ === 1) return Promise.reject(new Error('refused'));
      return new Promise<SynthesisResult>((resolve) => waiting.push(() => resolve({
        audio: 'pcm', samples: new Uint8Array(12000 * 2), sampleRate: 24000,
        timestamps: [{ start: 0, end: 0.2, charStart: 0, charEnd: 8 }, { start: 0.2, end: 0.45, charStart: 9, charEnd: 15 }],
      })));
    },
  };
  const engine = createPlaybackEngine({
    provider, voice: 'v', rate: 1.5,
    clock: { onClip: (cue) => log.push(`cue:${cue.utterance}@${cue.rate}x`), onPosition: (at) => log.push(`position:${at.utterance}`) },
    onError: () => {}, onState: () => {}, onOutOfText: () => {},
    sectionOf: options.sectionOf,
  });
  engines.push(engine);
  engine.load(sentences, 0);
  engine.play();
  return { engine, waiting };
}

describe('a speed change re-cues the sentence being spoken', () => {
  it('in a sentence that arrived after the one before it had ended', async () => {
    const log: string[] = [];
    const { engine, waiting } = setup(log);
    await settle();
    waiting.shift()!(); await settle();      // sentence 0 arrives and starts
    audio.position(0.1);
    audio.endAll(); await settle();          // sentence 0 ends, 1 still being synthesized
    waiting.shift()!(); await settle();      // sentence 1 arrives and is cued
    expect(log).toEqual(['cue:0@1.5x', 'position:0', 'cue:1@1.5x']);
    log.length = 0;
    engine.setRate(1.55);
    expect(log[0]).toBe('cue:1@1.55x');
  });

  it('in the first sentence of a chapter, both Clips in time', async () => {
    const log: string[] = [];
    const { engine, waiting } = setup(log, { sectionOf: (utterance) => (utterance === 0 ? 0 : 1) });
    await settle();
    waiting.shift()!(); await settle();
    waiting.shift()!(); await settle();      // sentence 1 is ready while sentence 0 plays
    audio.position(0.1);
    audio.endAll(); await settle();          // the chapter's last sentence ends
    await vi.advanceTimersByTimeAsync(100); await settle();   // the 100 ms held before a chapter
    expect(log).toEqual(['cue:0@1.5x', 'position:0', 'cue:1@1.5x']);
    log.length = 0;
    engine.setRate(1.55);
    expect(log[0]).toBe('cue:1@1.55x');
  });

  it('not an earlier sentence while stopped on a refused one', async () => {
    const log: string[] = [];
    const { engine, waiting } = setup(log, { refuseSecond: true });
    await settle();
    waiting.shift()!(); await settle();
    audio.position(0.1);
    audio.endAll(); await settle();          // sentence 0 ends; the engine stops on refused sentence 1
    expect(log).toEqual(['cue:0@1.5x', 'position:0', 'cue:1@1.5x']);
    expect(engine.snapshot()).toMatchObject({ playing: false, utterance: 1 });
    log.length = 0;
    engine.setRate(1.55);
    expect(log).toEqual([]);
    expect(engine.snapshot()).toMatchObject({ playing: false, utterance: 1 });
  });

  it('keeps the correction when the last report belongs to the current buffer', async () => {
    const log: string[] = [];
    const { engine, waiting } = setup(log);
    await settle();
    waiting.shift()!(); await settle();
    audio.position(0.1);
    log.length = 0;
    engine.setRate(2);
    expect(log).toEqual(['cue:0@2x', 'position:0']);
  });
});