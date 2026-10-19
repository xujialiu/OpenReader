import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ClipProvider } from '../../src/playback/clips';
import { createPlaybackEngine, type PlaybackEngine } from '../../src/playback/engine';

/**
 * iOS takes the Reading's audio away (#303): another app starts playing sound,
 * Siri, a call, an alarm. Does the engine say it has stopped, and does it carry
 * on only when iOS says it may?
 *
 * On the owner's iPhone the native engine stopped at `interruption.began` and
 * nothing told JavaScript, so the engine kept publishing `playing: true` and
 * the Player kept its Pause button over silence. When iOS ended the interruption
 * without `shouldResume`, or never ended it, the first press of the button
 * paused and only the second played.
 *
 * Real: the playback engine and its audio graph (`audio-graph.ts`).
 * Doubled: `react-native-audio-api`, as far as the graph can tell: the context's
 * resume and suspend, the source's queue, and the system events the
 * `AudioManager` sends, which the test sends as iOS would.
 */
const audio = vi.hoisted(() => {
  const world = {
    /** Whether the graph last asked the context to run: whether sound is coming out. */
    running: false,
    observing: false,
    listeners: new Map<string, Set<(event: unknown) => void>>(),
  };
  class AudioContext {
    sampleRate: number;
    destination = {};
    // A new context runs, as `audio-graph.ts` assumes (`let running = true`).
    constructor(options: { sampleRate: number }) { this.sampleRate = options.sampleRate; world.running = true; }
    createBufferQueueSource() {
      let ids = 0;
      return {
        playbackRate: { value: 1 },
        onPositionChangedInterval: 0,
        set onPositionChanged(_callback: unknown) {},
        set onBufferEnded(_callback: unknown) {},
        connect() {}, disconnect() {}, stop() {}, pause() {},
        enqueueBuffer: () => String(++ids),
        node: { start() {} },
      };
    }
    createBuffer(_channels: number, length: number) { return { length, copyToChannel() {} }; }
    async resume() { world.running = true; }
    async suspend() { world.running = false; }
    async close() {}
  }
  const AudioManager = {
    setAudioSessionOptions() {},
    setAudioSessionActivity: async () => {},
    observeAudioInterruptions(enabled: boolean) { world.observing = enabled; },
    addSystemEventListener(name: string, listener: (event: unknown) => void) {
      const set = world.listeners.get(name) ?? new Set();
      set.add(listener);
      world.listeners.set(name, set);
      return { remove() { set.delete(listener); } };
    },
  };
  /** iOS's interruption notification, as the library hands it to JavaScript once interruptions are observed. */
  function interruption(type: 'began' | 'ended', shouldResume = false) {
    // Unobserved, the library sends nothing to JavaScript (`SystemNotificationManager.handleInterruption`).
    if (!world.observing) return;
    for (const listener of world.listeners.get('interruption') ?? []) listener({ type, shouldResume });
  }
  return { world, interruption, module: { AudioContext, AudioManager } };
});
vi.mock('react-native-audio-api', () => audio.module);

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}

const sentences = Array.from({ length: 6 }, (_, i) => {
  const text = `Sentence number ${i}.`;
  return { text, speakable: true, spans: [{ block: i, start: 0, end: text.length, textOffset: 0 }] };
});
const provider: ClipProvider = {
  id: 'local', capabilities: { wordTimestamps: false }, listVoices: async () => [],
  synthesize: async () => ({ audio: 'pcm', samples: new Uint8Array(24000), sampleRate: 24000 }),
};

const engines: PlaybackEngine[] = [];
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.dispose();
  audio.world.running = false;
  audio.world.observing = false;
  audio.world.listeners.clear();
});

/** A Reading that is playing and sounding; `published()` is the last state the engine told the Reading. */
async function playing() {
  let state = { playing: false, buffering: false };
  const engine = createPlaybackEngine({
    provider, voice: 'v',
    clock: { onClip: () => {}, onPosition: () => {} },
    onError: (error) => { throw error; }, onState: (next) => { state = next; }, onOutOfText: () => {},
  });
  engines.push(engine);
  engine.load(sentences, 0);
  engine.play();
  await settle();
  expect(state).toEqual({ playing: true, buffering: false });
  expect(audio.world.running).toBe(true);
  return { engine, published: () => state };
}

describe('iOS takes the audio away while the Reading plays (#303)', () => {
  it('the engine stops and says so, and the sound is stopped on its side too', async () => {
    const { published } = await playing();
    audio.interruption('began');
    await settle();
    expect(published().playing).toBe(false);
    expect(audio.world.running).toBe(false);
  });

  it('iOS gives the audio back saying the Reading may resume, as after a call: the Reading carries on by itself', async () => {
    const { published } = await playing();
    audio.interruption('began');
    await settle();
    audio.interruption('ended', true);
    await settle();
    expect(published()).toEqual({ playing: true, buffering: false });
    expect(audio.world.running).toBe(true);
  });

  it('iOS gives the audio back without saying it may resume: the Reading stays paused, and one Play plays', async () => {
    const { engine, published } = await playing();
    audio.interruption('began');
    await settle();
    audio.interruption('ended', false);
    await settle();
    expect(published().playing).toBe(false);
    expect(audio.world.running).toBe(false);
    engine.play();
    await settle();
    expect(published()).toEqual({ playing: true, buffering: false });
    expect(audio.world.running).toBe(true);
  });

  it('a Pause pressed during the interruption is not undone when iOS says the Reading may resume', async () => {
    const { engine, published } = await playing();
    audio.interruption('began');
    await settle();
    engine.play();
    await settle();
    engine.pause();
    await settle();
    audio.interruption('ended', true);
    await settle();
    expect(published().playing).toBe(false);
    expect(audio.world.running).toBe(false);
  });

  it('an interruption that begins while the owner has the Reading paused leaves it paused when it ends', async () => {
    const { engine, published } = await playing();
    engine.pause();
    await settle();
    audio.interruption('began');
    await settle();
    audio.interruption('ended', true);
    await settle();
    expect(published().playing).toBe(false);
    expect(audio.world.running).toBe(false);
  });
});
