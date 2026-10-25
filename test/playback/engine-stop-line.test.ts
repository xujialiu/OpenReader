import { afterEach, describe, expect, it, vi } from 'vitest';

import { segmentDocument } from '../../src/app/segment';
import type { ClipProvider } from '../../src/playback/clips';
import { createPlaybackEngine, type PlaybackEngine } from '../../src/playback/engine';

/**
 * **The stop line (#326).** The Sleep Timer asks the engine to pause by itself
 * once speech has finished one sentence: the one being spoken when a length
 * runs out, or the last of a chapter. The read-ahead has usually queued the
 * sentences after it already, so they are taken off; the next Play then reads
 * on from the sentence after the line, and nothing is said twice.
 *
 * The audio thread is `engine-missing-audio.test.ts`'s, copied: an empty
 * queue renders nothing, a buffer's end event comes once its content has been
 * output, and `dequeueBuffer` sends no end event.
 */
const engines: PlaybackEngine[] = [];
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.dispose();
});

const audio = vi.hoisted(() => {
  const QUANTUM = 128;
  const TAIL_SECONDS = 0.025;
  interface Source {
    queue: { id: string; frames: number }[];
    read: number;
    content: number;
    tail: { id: string; left: number } | null;
    rate: number;
    running: boolean;
    interval: number;
    counted: number;
    onPositionChanged: ((event: { value: number }) => void) | null;
    onBufferEnded: ((event: { bufferId: string; isLastBufferInQueue: boolean }) => void) | null;
  }
  const world = { hz: 0, source: null as Source | null, suspended: false, frames: 0, ids: 0 };
  const flags = { sessionRefuses: false, holdDecode: false };
  /** Decodes the test is holding, released in the order they were asked for. */
  const held: (() => void)[] = [];

  function quantum(): boolean {
    world.frames += QUANTUM;
    const source = world.source;
    if (!source || world.suspended || !source.running) return false;
    if (source.queue.length === 0 && !source.tail) return false;
    let fired = false;
    if (source.tail) {
      source.tail.left -= QUANTUM;
      if (source.tail.left <= 0) {
        const { id } = source.tail;
        source.tail = null;
        fired = true;
        source.onBufferEnded?.({ bufferId: id, isLastBufferInQueue: source.queue.length === 0 });
      }
    } else {
      let want = source.rate * QUANTUM;
      while (want > 0 && source.queue.length > 0) {
        const front = source.queue[0]!;
        const take = Math.min(want, front.frames - source.read);
        source.read += take;
        source.content += take;
        want -= take;
        if (source.read < front.frames) break;
        source.queue.shift();
        source.read = 0;
        if (source.queue.length === 0) {
          source.tail = { id: front.id, left: TAIL_SECONDS * world.hz };
          break;
        }
        fired = true;
        source.onBufferEnded?.({ bufferId: front.id, isLastBufferInQueue: false });
      }
    }
    if (source.counted > source.interval) {
      source.counted = 0;
      fired = true;
      source.onPositionChanged?.({ value: source.content / world.hz });
    }
    source.counted += QUANTUM;
    return fired;
  }

  class AudioContext {
    sampleRate: number;
    destination = {};
    constructor(options: { sampleRate: number }) {
      this.sampleRate = options.sampleRate;
      world.hz = options.sampleRate;
    }
    createBufferQueueSource() {
      const source: Source = { queue: [], read: 0, content: 0, tail: null, rate: 1, running: false, interval: 0, counted: 0, onPositionChanged: null, onBufferEnded: null };
      world.source = source;
      return {
        playbackRate: { get value() { return source.rate; }, set value(rate: number) { source.rate = rate; } },
        set onPositionChangedInterval(ms: number) { source.interval = Math.trunc(ms * 0.001 * world.hz); },
        set onPositionChanged(callback: Source['onPositionChanged']) { source.onPositionChanged = callback; },
        set onBufferEnded(callback: Source['onBufferEnded']) { source.onBufferEnded = callback; },
        connect() {},
        disconnect() {},
        stop() { source.running = false; source.queue = []; source.tail = null; },
        enqueueBuffer(buffer: { length: number }) {
          const id = String(++world.ids);
          source.queue.push({ id, frames: buffer.length });
          return id;
        },
        dequeueBuffer(id: string) {
          if (source.queue[0]?.id === id) source.read = 0;
          source.queue = source.queue.filter((buffer) => buffer.id !== id);
        },
        pause() { source.running = false; },
        node: { start() { source.running = true; } },
      };
    }
    createBuffer(_channels: number, length: number) { return { length, copyToChannel() {} }; }
    decodeAudioData(data: ArrayBuffer) {
      const frames = Math.round(SPEECH * world.hz);
      const decode = () => new Uint8Array(data)[0] === 0xff
        ? Promise.reject(new Error('decode failed'))
        : Promise.resolve({ length: frames, getChannelData: () => new Float32Array(frames) });
      if (!flags.holdDecode) return decode();
      return new Promise((resolve, reject) => held.push(() => decode().then(resolve, reject)));
    }
    async resume() { world.suspended = false; }
    async suspend() { world.suspended = true; }
    async close() {}
  }
  /** Each Clip is this long, in seconds. */
  const SPEECH = 0.5;
  const AudioManager = {
    setAudioSessionOptions() {},
    setAudioSessionActivity: async (active: boolean) => {
      if (active && flags.sessionRefuses) throw new Error('The audio session could not be activated');
    },
    getDevicePreferredSampleRate: () => 24_000,
    observeAudioInterruptions() {},
    addSystemEventListener: () => ({ remove() {} }),
  };
  return { world, flags, held, quantum, SPEECH, module: { AudioContext, AudioManager } };
});
vi.mock('react-native-audio-api', () => audio.module);

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve)); };

const LINES = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} is here.`);

/** A Reading of `LINES` from the first sentence, already playing, with every Provider answer immediate. */
function reading() {
  Object.assign(audio.world, { hz: 0, source: null, suspended: false, frames: 0, ids: 0 });
  const utterances = segmentDocument(LINES.map((text) => ({ text, role: 'paragraph' as const })), 'en');
  const asked: number[] = [];
  const provider: ClipProvider = {
    id: 'compatible', capabilities: { wordTimestamps: false }, listVoices: async () => [],
    async synthesize(text) {
      asked.push(LINES.indexOf(text));
      return { audio: 'pcm', samples: new Uint8Array(Math.round(audio.SPEECH * 24_000) * 2), sampleRate: 24_000 };
    },
  };
  const cues: number[] = [];
  const states: boolean[] = [];
  const lines: number[] = [];
  const notes: string[] = [];
  const engine = createPlaybackEngine({
    provider, voice: 'alloy', gap: { sentenceMs: 0, paragraphMs: 0 },
    clock: { onClip: (cue) => cues.push(cue.utterance), onPosition() {} },
    onError: (error) => notes.push(`error ${String(error)}`),
    onState: (state) => states.push(state.playing),
    onOutOfText: () => notes.push('out of text'),
    onStopLine: (utterance) => lines.push(utterance),
  });
  engines.push(engine);
  engine.load(utterances, 0);
  engine.play();

  /** Turn the clock: the audio thread renders and the engine answers its events. */
  async function run(seconds: number) {
    await settle();
    const until = audio.world.frames + seconds * 24_000;
    while (audio.world.frames < until) if (audio.quantum()) await settle();
    await settle();
  }
  /** The buffers on the native queue, by how many there are. */
  const queued = () => audio.world.source?.queue.length ?? 0;
  const told = () => JSON.stringify({ snapshot: engine.snapshot(), cues, states, lines, notes, asked, queued: queued() });
  return { engine, cues, states, lines, notes, asked, run, queued, told };
}

describe('a stop line set while its sentence is being spoken (#326)', () => {
  it('takes the sentences queued after it off, and pauses when it ends', async () => {
    const r = reading();
    await r.run(0.2);
    expect(r.queued(), r.told()).toBeGreaterThan(1); // the read-ahead is on the queue
    r.engine.stopAfter(0);
    expect(r.queued(), r.told()).toBe(1);
    await r.run(3);
    expect({ lines: r.lines, cues: r.cues, playing: r.states.at(-1), notes: r.notes }, r.told())
      .toEqual({ lines: [0], cues: [0], playing: false, notes: [] });
    expect(r.engine.snapshot(), r.told()).toMatchObject({ playing: false, utterance: 0, queued: 0 });
  });

  it('is followed by a Play that reads on from the next sentence', async () => {
    const r = reading();
    await r.run(0.2);
    r.engine.stopAfter(0);
    await r.run(3);
    const asked = r.asked.length;
    r.engine.play();
    await r.run(0.2);
    expect({ cues: r.cues, playing: r.states.at(-1), lines: r.lines }, r.told()).toEqual({ cues: [0, 1], playing: true, lines: [0] });
    // The sentences taken off the queue were kept: nothing is asked for twice.
    expect(new Set(r.asked).size, r.told()).toBe(r.asked.length);
    expect(r.asked.length, r.told()).toBeGreaterThanOrEqual(asked);
  });

  it('behind the sentence being spoken is that sentence', async () => {
    const r = reading();
    await r.run(1.2); // into the third sentence
    const speaking = r.engine.snapshot().utterance;
    expect(speaking, r.told()).toBeGreaterThan(0);
    r.engine.stopAfter(0);
    await r.run(3);
    expect(r.lines, r.told()).toEqual([speaking]);
    expect(r.cues.at(-1), r.told()).toBe(speaking);
  });
});

describe('a stop line further on', () => {
  it('fetches nothing past it, and the Reading stops at its end', async () => {
    const r = reading();
    r.engine.stopAfter(2);
    await r.run(5);
    expect({ lines: r.lines, cues: r.cues, playing: r.states.at(-1) }, r.told()).toEqual({ lines: [2], cues: [0, 1, 2], playing: false });
    expect(Math.max(...r.asked), r.told()).toBe(2);
  });

  it('at the last sentence of the text is a stop, not running out of text', async () => {
    const r = reading();
    r.engine.stopAfter(LINES.length - 1);
    await r.run(10);
    expect({ lines: r.lines, notes: r.notes }, r.told()).toEqual({ lines: [LINES.length - 1], notes: [] });
  });
});

describe('a stop line taken back or overtaken', () => {
  it('null lets the Reading read on', async () => {
    const r = reading();
    await r.run(0.2);
    r.engine.stopAfter(0);
    r.engine.stopAfter(null);
    await r.run(2.2);
    expect({ lines: r.lines, playing: r.states.at(-1) }, r.told()).toEqual({ lines: [], playing: true });
    expect(r.cues.length, r.told()).toBeGreaterThan(2);
  });

  it('goes with a seek, which the caller states again', async () => {
    const r = reading();
    await r.run(0.2);
    r.engine.stopAfter(1);
    r.engine.seek(5);
    await r.run(2.2);
    expect(r.lines, r.told()).toEqual([]);
    expect(r.cues.at(-1), r.told()).toBeGreaterThan(5);
  });

  it('whose sentence was finished when the Reading paused is dropped by the next Play', async () => {
    const r = reading();
    await r.run(0.2);
    r.engine.stopAfter(0);
    await r.run(3);
    // Paused at the end of sentence 0; a new line on the finished sentence.
    r.engine.stopAfter(0);
    r.engine.play();
    await r.run(1.2);
    expect({ lines: r.lines, playing: r.states.at(-1) }, r.told()).toEqual({ lines: [0], playing: true });
    expect(r.cues.at(-1), r.told()).toBeGreaterThan(1);
  });
});
