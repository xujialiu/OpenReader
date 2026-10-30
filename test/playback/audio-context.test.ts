import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNativeAudioContext } from '../../src/playback/audio-graph';
import { playPronunciation } from '../../src/translation/pronunciation-audio';

const fake = vi.hoisted(() => {
  const source = { onEnded: null as (() => void) | null, connect: vi.fn(), stop: vi.fn(), buffer: null,
    start: vi.fn(() => { source.onEnded?.(); }) };
  const context = { destination: {}, createBufferSource: () => source, decodeAudioData: vi.fn(async () => ({})),
    resume: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const construct = vi.fn(function () { return context; });
  return { context, source, construct };
});
vi.mock('react-native-audio-api', () => ({
  AudioContext: fake.construct,
  AudioManager: {
    addSystemEventListener: () => ({ remove() {} }), observeAudioInterruptions() {},
    setAudioSessionOptions() {}, setAudioSessionActivity: async () => {},
  },
}));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

it('opts out explicitly for both explicit-rate narration and device-rate contexts', () => {
  expect(createNativeAudioContext(24000)).toBe(fake.context);
  expect(createNativeAudioContext()).toBe(fake.context);
  expect(fake.construct.mock.calls).toEqual([
    [{ sampleRate: 24000, enableWorklets: false }], [{ sampleRate: undefined, enableWorklets: false }],
  ]);
});

it('pronunciation really constructs a native-only graph and closes it after the source ends', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) })));
  await playPronunciation('https://example.test/pronunciation.wav', new AbortController().signal, vi.fn());
  expect(fake.construct).toHaveBeenCalledExactlyOnceWith({ sampleRate: undefined, enableWorklets: false });
  expect(fake.context.decodeAudioData).toHaveBeenCalledOnce();
  expect(fake.context.resume).toHaveBeenCalledOnce();
  expect(fake.source.start).toHaveBeenCalledOnce();
  expect(fake.context.close).toHaveBeenCalledOnce();
});
