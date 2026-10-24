import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BuildEnvironment } from '../../build-variant';

async function modeWith(environment: BuildEnvironment = {}, dev = false) {
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_OPENREADER_VARIANT', environment.variant as string);
  vi.stubEnv('EXPO_PUBLIC_OPENREADER_DEBUG_MODE', environment.debugMode as string);
  vi.stubEnv('EXPO_PUBLIC_OPENREADER_UNLOCKED', environment.unlocked as string);
  vi.stubGlobal('__DEV__', dev);
  return import('../../src/debug/mode');
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Debug Mode is the fixed build role, not the JavaScript optimization mode (#324)', () => {
  it('keeps a formal Metro bundle non-Debug', async () => {
    expect((await modeWith({}, true)).DEBUG_MODE).toBe(false);
    expect((await modeWith({ variant: 'formal' })).DEBUG_MODE).toBe(false);
    expect((await modeWith({ variant: 'free' }, true)).DEBUG_MODE).toBe(false);
  });

  it('enables Debug only for the Debug role, including embedded bundles', async () => {
    expect((await modeWith({ variant: 'debug' }, false)).DEBUG_MODE).toBe(true);
    expect((await modeWith({ debugMode: '1' }, false)).DEBUG_MODE).toBe(true);
    for (const debugMode of ['0', 'true', 'yes', '', ' 1']) expect((await modeWith({ debugMode })).DEBUG_MODE).toBe(false);
  });
});

describe('the native number and visible identity derive from the same formal base', () => {
  it.each([
    ['formal', '13', ''], ['free', '14', '-free'], ['debug', '15', '-debug'],
  ] as const)('names %s correctly with and without a Beta', async (variant, number, suffix) => {
    const { buildVersion, shownVersion } = await modeWith({ variant });
    for (const beta of ['', '-beta3']) {
      expect(buildVersion(`1.0.2 (13)${beta}`)).toBe(`1.0.2 (${number})${beta}`);
      expect(shownVersion(`1.0.2 (13)${beta}`)).toBe(`1.0.2 (${number})${beta}${suffix}`);
    }
    expect(shownVersion('1.0.2 (16)-beta1', 'debug')).toBe('1.0.2 (18)-beta1-debug');
    expect(shownVersion('1.0.2 (16)', 'formal')).toBe('1.0.2 (16)');
  });
});
