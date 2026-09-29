import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Debug Mode is a property of the build (#82, ADR 0054): on in a Metro build,
 * on in an embedded bundle only when it was made with
 * `EXPO_PUBLIC_OPENREADER_DEBUG_MODE=1`, off otherwise. Under Node there is no
 * `__DEV__` and `process.env` is read as the module loads, which is what
 * babel-preset-expo turns into a constant when it bundles.
 */
async function modeWith(env: string | undefined, dev?: boolean) {
  vi.resetModules();
  if (env === undefined) vi.stubEnv('EXPO_PUBLIC_OPENREADER_DEBUG_MODE', undefined as unknown as string);
  else vi.stubEnv('EXPO_PUBLIC_OPENREADER_DEBUG_MODE', env);
  if (dev !== undefined) vi.stubGlobal('__DEV__', dev);
  return import('../../src/debug/mode');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('DEBUG_MODE', () => {
  it('is off in an embedded bundle made without the switch', async () => {
    expect((await modeWith(undefined, false)).DEBUG_MODE).toBe(false);
    expect((await modeWith(undefined)).DEBUG_MODE).toBe(false);
  });

  it('is on in an embedded bundle made with EXPO_PUBLIC_OPENREADER_DEBUG_MODE=1, and only 1', async () => {
    expect((await modeWith('1', false)).DEBUG_MODE).toBe(true);
    for (const other of ['0', 'true', 'yes', '', ' 1']) expect((await modeWith(other, false)).DEBUG_MODE, other).toBe(false);
  });

  it('is on in every Metro build', async () => {
    expect((await modeWith(undefined, true)).DEBUG_MODE).toBe(true);
  });
});

describe('the version Settings shows', () => {
  it('ends in -debug in Debug Mode and is the beta alone otherwise', async () => {
    const { shownVersion } = await modeWith(undefined, false);
    expect(shownVersion('0.0.2-beta51', true)).toBe('0.0.2-beta51-debug');
    expect(shownVersion('0.0.2-beta51', false)).toBe('0.0.2-beta51');
    // Its default is the build's own answer.
    expect(shownVersion('0.0.2-beta51')).toBe('0.0.2-beta51');
  });
});
