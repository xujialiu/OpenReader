import { afterEach, describe, expect, it, vi } from 'vitest';

import { segmentDocument } from '../../src/app/segment';
import { createOpenAIProvider } from '../../src/core/providers/openai';
import type { SynthesisResult } from '../../src/core/providers/types';
import type { ClipProvider } from '../../src/playback/clips';
import { createPlaybackEngine, type PlaybackEngine } from '../../src/playback/engine';

const engines: PlaybackEngine[] = [];
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.dispose();
});

/**
 * The audio thread of `react-native-audio-api`, as far as the engine can tell,
 * with a clock the test turns. Three rules, each read from the installed,
 * patched 0.13.5 source under
 * node_modules/react-native-audio-api/common/cpp/audioapi:
 *
 * - an empty queue is not processed, so nothing is counted for it
 *   (core/sources/AudioBufferBaseSourceNode.cpp:65-68);
 * - a position event is sent once more than the interval has been counted, and
 *   only then is the quantum counted (utils/events/PositionChangedDispatcher.cpp:41-55);
 * - a buffer's end event comes when its content has been output, and the last
 *   queued buffer's after the stretcher's tail (`dispatchOutputEnds` in
 *   patches/react-native-audio-api+0.13.5.patch).
 */
const audio = vi.hoisted(() => {
  const QUANTUM = 128;
  /** What the patched queue goes on rendering after the last buffer's content: 0.021-0.029 s, measured on the host. */
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
  const world = { hz: 0, source: null as Source | null, suspended: false, frames: 0, ids: 0, positionEvents: 0 };

  /** One render quantum. True when an event reached JavaScript. */
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
      world.positionEvents++;
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
        pause() { source.running = false; },
        node: { start() { source.running = true; } },
      };
    }
    createBuffer(_channels: number, length: number) { return { length, copyToChannel() {} }; }
    async resume() { world.suspended = false; }
    async suspend() { world.suspended = true; }
    async close() {}
  }
  const AudioManager = {
    setAudioSessionOptions() {},
    setAudioSessionActivity: async () => {},
    addSystemEventListener: () => ({ remove() {} }),
  };
  return { world, quantum, module: { AudioContext, AudioManager } };
});
vi.mock('react-native-audio-api', () => audio.module);

/** Five one-sentence paragraphs. Each reply is 0.4 s of speech at 24 kHz. */
const LINES = ['Yes.', 'No.', 'Why?', 'Because.', 'Really?'];
const SPEECH = 0.4;
const utterances = segmentDocument(LINES.map((text) => ({ text, role: 'paragraph' as const })), 'en');
const pcm = () => new Uint8Array(Math.round(SPEECH * 24_000) * 2);

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve)); };

interface Scenario {
  rate: number;
  /** Seconds each request takes, by the order it was sent in. */
  latency(order: number): number;
  /** A Voice that reports Word Timings, in place of OpenAI. */
  timings?: boolean;
  quiet?: boolean;
}

/** A Reading of the five lines, with the Provider and the audio thread on one clock. */
async function read(scenario: Scenario) {
  const { world } = audio;
  Object.assign(world, { hz: 0, source: null, suspended: false, frames: 0, ids: 0, positionEvents: 0 });

  const sent: string[] = [];
  const waiting: { due: number; reply(): void }[] = [];
  const held = <T>(text: string, make: () => T) => new Promise<T>((resolve) => {
    waiting.push({ due: world.frames / 24_000 + scenario.latency(sent.length), reply: () => resolve(make()) });
    sent.push(text);
  });

  // The real OpenAI Provider over a fake fetch. Its replies carry no Word Timings.
  const openai = createOpenAIProvider({ apiKey: 'sk-test', model: 'tts-1' }, {
    fetch: (_url, init) => held(JSON.parse(String(init?.body)).input,
      () => new Response(pcm(), { status: 200, headers: { 'Content-Type': 'audio/pcm' } })),
  });
  // The control: the same audio with two Word Timings in it.
  const timed: ClipProvider = {
    id: 'fish', capabilities: { wordTimestamps: true }, listVoices: async () => [],
    synthesize: (text) => held<SynthesisResult>(text, () => ({ audio: 'pcm', samples: pcm(), sampleRate: 24_000, timestamps: [
      { start: 0, end: SPEECH * 0.4, charStart: 0, charEnd: 1 },
      { start: SPEECH * 0.4, end: SPEECH * 0.8, charStart: 1, charEnd: text.length },
    ] })),
  };

  const cues: number[] = [];
  const states: string[] = [];
  const notes: string[] = [];
  const engine = createPlaybackEngine({
    provider: scenario.timings ? timed : openai,
    voice: 'alloy',
    rate: scenario.rate,
    clock: { onClip: (cue) => cues.push(cue.utterance), onPosition() {} },
    onError: (error) => notes.push(`error: ${String(error)}`),
    onState: (state) => states.push(`${state.playing ? 'playing' : 'paused'}${state.buffering ? '+buffering' : ''}`),
    onOutOfText: () => notes.push('out of text'),
  });
  engines.push(engine);
  engine.load(utterances, 0, { quiet: scenario.quiet });
  if (!scenario.quiet) engine.play();
  await settle();

  /** Turn the clock until the engine says it has run out of text: replies arrive when due, the audio thread renders. */
  async function run(seconds: number) {
    const until = world.frames + seconds * 24_000;
    while (world.frames < until && !notes.includes('out of text')) {
      const due = waiting.filter((request) => request.due <= world.frames / 24_000);
      for (const request of due) {
        waiting.splice(waiting.indexOf(request), 1);
        request.reply();
      }
      if (due.length > 0) await settle();
      if (audio.quantum()) await settle();
    }
  }
  const told = () => `sent ${sent.length} of ${utterances.length} (${sent.join(' ')}); cued ${cues.join(',')}; position events ${world.positionEvents}; `
    + `snapshot ${JSON.stringify(engine.snapshot())}; last state ${states.at(-1)}; notes ${JSON.stringify(notes)}`;
  return { engine, sent, notes, cues, run, told };
}

/** Two requests at a time, each taking 0.8 s and half a step apart: one reply every 0.4 s. */
const everyFourTenths = (order: number) => (order === 0 ? 0.4 : 0.8);
const all = utterances.map((utterance) => utterance.text);

describe('a Reading whose Clips each arrive after the one before has ended', () => {
  it('asks for the fifth sentence and reaches the end: OpenAI, 3x, 0.4 s sentences, a reply every 0.4 s', async () => {
    const reading = await read({ rate: 3, latency: everyFourTenths });
    await reading.run(60);
    expect(reading.sent, reading.told()).toEqual(all);
    expect(reading.notes).toEqual(['out of text']);
  });

  it('reports exhaustion again on Play after the short passage ended, without fetching again (#156)', async () => {
    const reading = await read({ rate: 3, latency: everyFourTenths });
    await reading.run(10);
    expect(reading.notes).toEqual(['out of text']);
    reading.engine.pause();
    await settle();
    reading.engine.play();
    await settle();
    await reading.run(60);
    expect(reading.sent, reading.told()).toEqual(all);
    expect(reading.notes).toEqual(['out of text', 'out of text']);
  });

  it('does not advance the cursor or cue a quiet preload, and keeps read-ahead bounded', async () => {
    const reading = await read({ rate: 3, latency: () => 0, quiet: true });
    await reading.run(10);
    expect(reading.sent).toEqual(all.slice(0, 4));
    expect(reading.cues).toEqual([]);
    expect(reading.engine.snapshot()).toMatchObject({ playing: false, utterance: 0, queued: 4, fetching: 0 });
    reading.engine.play();
    await reading.run(10);
    expect(reading.sent).toEqual(all);
    expect(reading.cues).toEqual([0, 1, 2, 3, 4]);
    expect(reading.notes).toEqual(['out of text']);
  });

  it('resumes after a pause in the middle of starved playback', async () => {
    const reading = await read({ rate: 3, latency: everyFourTenths });
    await reading.run(1);
    reading.engine.pause();
    const pausedAt = reading.engine.snapshot().utterance;
    await reading.run(1);
    expect(reading.engine.snapshot()).toMatchObject({ playing: false, utterance: pausedAt });
    reading.engine.play();
    await reading.run(10);
    expect(reading.sent).toEqual(all);
    expect(reading.notes).toEqual(['out of text']);
  });

  it.each([
    ['at 1x', { rate: 1, latency: everyFourTenths }],
    ['with a Voice that reports Word Timings', { rate: 3, latency: everyFourTenths, timings: true }],
    ['with replies that arrive in pairs', { rate: 3, latency: () => 0.8 }],
  ] as const)('control, the same %s: reaches the end', async (_name, scenario) => {
    const reading = await read(scenario);
    await reading.run(60);
    expect(reading.sent, reading.told()).toEqual(all);
    expect(reading.notes).toEqual(['out of text']);
  });
});