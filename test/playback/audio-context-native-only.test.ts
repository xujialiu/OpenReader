import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// Execute the real native constructor while typing against its published API;
// importing its source type graph also type-checks unrelated upstream globals.
const { default: AudioContext } = await vi.importActual<{
  default: typeof import('react-native-audio-api').AudioContext;
}>('../../node_modules/react-native-audio-api/src/core/AudioContext');

const native = vi.hoisted(() => ({
  worker: {}, createAudioRuntime: vi.fn(), createAudioContext: vi.fn(),
  close: vi.fn(), resume: vi.fn(), suspend: vi.fn(),
}));
vi.mock('../../node_modules/react-native-audio-api/src/AudioAPIModule', () => ({ default: { createAudioRuntime: native.createAudioRuntime } }));
vi.mock('../../node_modules/react-native-audio-api/src/system', () => ({ default: { getDevicePreferredSampleRate: () => 48000 } }));
vi.mock('../../node_modules/react-native-audio-api/src/core/BaseAudioContext', () => ({ default: class {
  constructor(readonly context: unknown) {}
} }));
vi.mock('../../node_modules/react-native-audio-api/src/core/MediaElementAudioSourceNode', () => ({ default: class {} }));

beforeEach(() => {
  vi.clearAllMocks();
  native.createAudioRuntime.mockReturnValue(native.worker);
  native.createAudioContext.mockReturnValue({ close: native.close, resume: native.resume, suspend: native.suspend });
  vi.stubGlobal('createAudioContext', native.createAudioContext);
});
afterEach(() => vi.unstubAllGlobals());

it('the actual patched constructor can create and close native-only contexts without any Worklets runtime (#333)', async () => {
  const options = { sampleRate: 24000, enableWorklets: false };
  for (let i = 0; i < 10; i++) {
    const context = new AudioContext(options);
    await context.resume(); await context.suspend(); await context.close();
  }
  expect(native.createAudioRuntime).not.toHaveBeenCalled();
  expect(native.createAudioContext).toHaveBeenCalledTimes(10);
  expect(native.createAudioContext).toHaveBeenLastCalledWith(24000, null);
  expect(native.resume).toHaveBeenCalledTimes(10);
  expect(native.suspend).toHaveBeenCalledTimes(10);
  expect(native.close).toHaveBeenCalledTimes(10);
});

it('keeps upstream worker-enabled defaults and sample-rate validation unchanged', () => {
  new AudioContext();
  expect(native.createAudioRuntime).toHaveBeenCalledOnce();
  expect(native.createAudioContext).toHaveBeenCalledExactlyOnceWith(48000, native.worker);
  expect(() => new AudioContext({ sampleRate: 1 })).toThrow('sampleRate');
  expect(native.createAudioContext).toHaveBeenCalledTimes(1);
});
