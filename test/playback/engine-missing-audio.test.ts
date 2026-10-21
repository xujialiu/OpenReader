import { afterEach, describe, expect, it, vi } from 'vitest';

import { segmentDocument } from '../../src/app/segment';
import type { SynthesisResult } from '../../src/core/providers/types';
import type { ClipProvider } from '../../src/playback/clips';
import { createPlaybackEngine, type PlaybackEngine } from '../../src/playback/engine';

const engines: PlaybackEngine[] = [];
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.dispose();
  Object.assign(audio.flags, { sessionRefuses: false, holdDecode: false });
  audio.held.splice(0);
});

/**
 * The audio thread of `react-native-audio-api`, with a clock the test turns,
 * on the rules `engine-starvation.test.ts` read from the patched 0.13.5 source:
 * an empty queue renders nothing and so sends no event, a position event comes
 * once more than the interval has been rendered, and a buffer's end event comes
 * once its content has been output, the last one after the stretcher's tail.
 *
 * Added here: `dequeueBuffer` sends no end event, as the patched node does not;
 * `decodeAudioData` refuses bytes that begin with 0xff and can be held by the
 * test; and the audio session can refuse to activate.
 */
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

/** What a Provider sends for one sentence. */
type Reply =
  | 'pcm' // 0.5 s of PCM
  | 'mp3' // an MP3 that decodes
  | 'broken' // an MP3 that does not decode
  | 'empty' // a 200 that carried no audio
  | 'refuse'; // a refusal

const pcm = (): SynthesisResult => ({ audio: 'pcm', samples: new Uint8Array(Math.round(audio.SPEECH * 24_000) * 2), sampleRate: 24_000 });

/** A Provider that answers each sentence as `replies` says, holding the ones in `slow` until the test releases them. */
function scripted(lines: readonly string[], id: 'compatible' | 'fish', replies: Record<number, Reply> = {}, slow: readonly number[] = []) {
  const asked: number[] = [];
  const held = new Map<number, () => void>();
  const provider: ClipProvider = {
    id, capabilities: { wordTimestamps: false }, listVoices: async () => [],
    async synthesize(text) {
      const index = lines.indexOf(text);
      asked.push(index);
      if (slow.includes(index) && !held.has(index)) await new Promise<void>((resolve) => held.set(index, resolve));
      const reply = replies[index] ?? 'pcm';
      if (reply === 'refuse') throw new Error('refused by the server');
      if (reply === 'empty') return { audio: 'pcm', samples: new Uint8Array(0), sampleRate: 24_000 };
      if (reply === 'pcm') return pcm();
      return { audio: 'encoded', mediaType: 'audio/mpeg', bytes: new Uint8Array([reply === 'broken' ? 0xff : 0x01, 2, 3, 4]) };
    },
  };
  return { provider, asked, release: (index: number) => held.get(index)?.() };
}

interface Options {
  replies?: Record<number, Reply>;
  slow?: number[];
  from?: number;
}

/** A Reading of `lines` from `from`, already playing. */
function reading(lines: readonly string[], options: Options = {}) {
  Object.assign(audio.world, { hz: 0, source: null, suspended: false, frames: 0, ids: 0 });
  const utterances = segmentDocument(lines.map((text) => ({ text, role: 'paragraph' as const })), 'en');
  const old = scripted(lines, 'compatible', options.replies, options.slow);
  const cues: number[] = [];
  const states: { playing: boolean; buffering: boolean }[] = [];
  const errors: string[] = [];
  const notes: string[] = [];
  /** How much content the audio thread had rendered at each stop of a Reading that had been playing. */
  const stoppedAt: number[] = [];
  let wasPlaying = false;
  const engine = createPlaybackEngine({
    provider: old.provider, voice: 'alloy', gap: { sentenceMs: 0, paragraphMs: 0 },
    clock: { onClip: (cue) => cues.push(cue.utterance), onPosition() {} },
    onError: (error) => errors.push(String(error)),
    onState: (state) => {
      states.push(state);
      if (wasPlaying && !state.playing) stoppedAt.push(audio.world.source?.content ?? 0);
      wasPlaying = state.playing;
    },
    onOutOfText: () => notes.push('out of text'),
  });
  engines.push(engine);
  engine.load(utterances, options.from ?? 0);
  engine.play();

  /** Turn the clock: the audio thread renders and the engine answers its events. */
  async function run(seconds: number) {
    await settle();
    const until = audio.world.frames + seconds * 24_000;
    while (audio.world.frames < until) if (audio.quantum()) await settle();
    await settle();
  }
  const told = () => JSON.stringify({ snapshot: engine.snapshot(), last: states.at(-1), cues, errors, notes, asked: old.asked });
  return { engine, old, cues, states, errors, notes, stoppedAt, run, told, lines };
}

const ONE = ['Only one sentence here.'];
const THREE = ['First one here.', 'Second one here.', 'Third one here.'];

describe('a Clip that cannot be played stops the Reading at it, whatever else is out at the Provider (#276)', () => {
  it('a Document of one sentence whose MP3 does not decode', async () => {
    const r = reading(ONE, { replies: { 0: 'broken' } });
    await r.run(5);
    expect(r.errors, r.told()).toContain('Error: decode failed');
    expect(r.states.at(-1), r.told()).toEqual({ playing: false, buffering: false });
    expect(r.engine.snapshot(), r.told()).toMatchObject({ playing: false, utterance: 0, queued: 0, fetching: 0 });
  });

  it('a Reading left at the Document\'s last sentence, whose MP3 does not decode', async () => {
    const r = reading(THREE, { replies: { 2: 'broken' }, from: 2 });
    await r.run(5);
    expect(r.errors, r.told()).toContain('Error: decode failed');
    expect(r.engine.snapshot(), r.told()).toMatchObject({ playing: false, utterance: 2 });
  });

  it('a Document of one sentence while the audio session will not activate', async () => {
    audio.flags.sessionRefuses = true;
    const r = reading(ONE);
    await r.run(5);
    expect(r.errors, r.told()).toContain('Error: The audio session could not be activated');
    expect(r.engine.snapshot(), r.told()).toMatchObject({ playing: false, utterance: 0 });
  });

  it('the first sentence is slow, the ones behind it have arrived, and its MP3 does not decode', async () => {
    const r = reading(THREE, { replies: { 0: 'broken' }, slow: [0] });
    await r.run(2);
    r.old.release(0);
    await r.run(10);
    expect(r.errors, r.told()).toContain('Error: decode failed');
    expect(r.engine.snapshot(), r.told()).toMatchObject({ playing: false, utterance: 0 });
    expect(r.cues, r.told()).not.toContain(1);
  });

  it('lets the sentence already queued finish, then stops at the one that did not decode', async () => {
    const r = reading(['First one here.', 'Second one here.'], { replies: { 1: 'broken' } });
    await r.run(5);
    expect(r.stoppedAt.length, r.told()).toBe(1);
    expect(r.stoppedAt[0], r.told()).toBeGreaterThanOrEqual(Math.round(audio.SPEECH * 24_000));
    expect(r.cues, r.told()).toEqual([0, 1]);
    expect(r.engine.snapshot(), r.told()).toMatchObject({ playing: false, utterance: 1 });
  });

  it('Play asks again once the session can start, and the sentence is heard', async () => {
    audio.flags.sessionRefuses = true;
    const r = reading(ONE);
    await r.run(2);
    expect(r.engine.snapshot(), r.told()).toMatchObject({ playing: false });
    audio.flags.sessionRefuses = false;
    r.engine.play();
    await r.run(5);
    expect(audio.world.source?.content, r.told()).toBeGreaterThanOrEqual(Math.round(audio.SPEECH * 24_000));
    expect(r.notes, r.told()).toEqual(['out of text']);
  });

  it('Play on bytes that still do not decode stops again rather than spinning', async () => {
    const r = reading(ONE, { replies: { 0: 'broken' } });
    await r.run(2);
    r.engine.play();
    await r.run(5);
    expect(r.errors.filter((error) => error === 'Error: decode failed').length, r.told()).toBeGreaterThanOrEqual(2);
    expect(r.engine.snapshot(), r.told()).toMatchObject({ playing: false, utterance: 0 });
  });

  it('a decode that fails after a seek away from it does not stop the new Reading', async () => {
    audio.flags.holdDecode = true;
    const r = reading(THREE, { replies: { 0: 'broken' } });
    await settle();
    expect(audio.held.length, r.told()).toBeGreaterThan(0);
    r.engine.seek(1);
    audio.flags.holdDecode = false;
    audio.held.splice(0).forEach((release) => release());
    await r.run(5);
    expect(r.errors, r.told()).not.toContain('Error: decode failed');
    expect(r.cues, r.told()).toContain(2);
    expect(r.notes, r.told()).toEqual(['out of text']);
  });

  it('a decode that fails after the engine is disposed reports nothing', async () => {
    audio.flags.holdDecode = true;
    const r = reading(ONE, { replies: { 0: 'broken' } });
    await settle();
    await r.engine.dispose();
    const states = r.states.length;
    audio.held.splice(0).forEach((release) => release());
    await settle();
    expect(r.errors, r.told()).toEqual([]);
    expect(r.states.length, r.told()).toBe(states);
  });

  it('control: the same sentence refused by the server stops the Reading (ADR 0027)', async () => {
    const r = reading(ONE, { replies: { 0: 'refuse' } });
    await r.run(5);
    expect(r.errors, r.told()).toContain('Error: refused by the server');
    expect(r.engine.snapshot(), r.told()).toMatchObject({ playing: false, utterance: 0 });
  });

  it('control: an MP3 that decodes is heard to the end', async () => {
    const r = reading(ONE, { replies: { 0: 'mp3' } });
    await r.run(5);
    expect(r.errors, r.told()).toEqual([]);
    expect(r.notes, r.told()).toEqual(['out of text']);
  });
});

describe('a speakable sentence answered with no audio stops the Reading at it (#235)', () => {
  it('is not passed over as a silence', async () => {
    const r = reading(THREE, { replies: { 1: 'empty' } });
    await r.run(5);
    expect(r.errors.join(' '), r.told()).toMatch(/no audio/);
    expect(r.cues, r.told()).not.toContain(2);
    expect(r.engine.snapshot(), r.told()).toMatchObject({ playing: false, utterance: 1 });
  });

  it('control: text with nothing to say is a silence, with nothing asked of the Provider', async () => {
    const r = reading(['First one here.', '* * *', 'Third one here.']);
    await r.run(5);
    expect(r.errors, r.told()).toEqual([]);
    expect(r.old.asked, r.told()).toEqual([0, 2]);
    expect(r.notes, r.told()).toEqual(['out of text']);
  });
});

/**
 * The Reading plays sentence 0 in the old Voice, with 1 and 2 still out at the
 * Provider, so the queue runs empty. Another Voice is chosen and its first Clip,
 * for sentence 1, is queued on the empty queue. While it waits to be heard the
 * old Voice's 1 and 2 arrive.
 */
async function armedOnEmptyQueue(newReplies: Record<number, Reply> = {}, newSlow: number[] = []) {
  const lines = ['First sentence.', 'Second sentence.', 'Third sentence.', 'Fourth sentence.'];
  const r = reading(lines, { slow: [1, 2] });
  await r.run(0.7);
  expect(r.cues, r.told()).toEqual([0]);
  expect(r.engine.snapshot(), r.told()).toMatchObject({ playing: true, queued: 0, fetching: 2 });
  const next = scripted(lines, 'fish', newReplies, newSlow);
  const outcome = { selected: 0, failed: [] as string[] };
  r.engine.switchVoice(next.provider, 'nova', () => { outcome.selected++; }, (error) => { outcome.failed.push(String(error)); });
  await settle();
  expect(r.engine.snapshot().queued, r.told()).toBeGreaterThan(0);
  expect(outcome.selected).toBe(0);
  r.old.release(1);
  r.old.release(2);
  await settle();
  return { ...r, next, outcome };
}

describe('a Voice choice cancelled after its first Clip was queued on an empty queue (#252)', () => {
  it('choosing the current Voice again goes on with the sentences fetched in the old Voice', async () => {
    const r = await armedOnEmptyQueue();
    r.engine.cancelVoiceSwitch();
    await r.run(10);
    expect(r.cues, r.told()).toEqual([0, 1, 2, 3]);
    expect(r.old.asked.filter((index) => index === 1), r.told()).toEqual([1]);
    expect(r.outcome.selected).toBe(0);
    expect(r.notes, r.told()).toEqual(['out of text']);
  });

  it('a second fetch that fails after the first was queued goes on in the old Voice too', async () => {
    const r = await armedOnEmptyQueue({ 2: 'refuse' }, [2]);
    r.next.release(2);
    await r.run(10);
    expect(r.outcome.failed, r.told()).toEqual(['Error: refused by the server']);
    expect(r.cues, r.told()).toEqual([0, 1, 2, 3]);
    expect(r.notes, r.told()).toEqual(['out of text']);
  });

  it('a cancel while paused stays paused, and Play goes on in the old Voice', async () => {
    const r = await armedOnEmptyQueue();
    r.engine.pause();
    const heard = audio.world.source!.content;
    r.engine.cancelVoiceSwitch();
    await r.run(3);
    expect(r.engine.snapshot(), r.told()).toMatchObject({ playing: false });
    expect(audio.world.source!.content, r.told()).toBe(heard);
    expect(r.cues, r.told()).not.toContain(2);
    r.engine.play();
    await r.run(10);
    // Play cues the front of the queue again, which was cued as it was queued.
    expect([...new Set(r.cues)], r.told()).toEqual([0, 1, 2, 3]);
    expect(r.notes, r.told()).toEqual(['out of text']);
  });

  it('control: left to land, the new Voice is heard from sentence 1', async () => {
    const r = await armedOnEmptyQueue();
    await r.run(10);
    expect(r.outcome.selected, r.told()).toBe(1);
    expect(r.cues, r.told()).toEqual([0, 1, 2, 3]);
    expect(r.next.asked, r.told()).toContain(3);
  });
});
