import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.doUnmock('../../src/build/variant'); vi.resetModules(); });

it.each(['formal', 'free', 'debug'] as const)('rejects a mismatched or unmarked native shell for %s before startup', async (variant) => {
  vi.resetModules();
  vi.doMock('../../src/build/variant', () => ({ BUILD_VARIANT: variant, BUILD_MARKER: `openreader-variant:${variant}` }));
  const { assertNativeVariant } = await import('../../src/build/variant-check');
  expect(() => assertNativeVariant(variant)).not.toThrow();
  for (const other of [undefined, '', ...['formal', 'free', 'debug'].filter(value => value !== variant)]) {
    expect(() => assertNativeVariant(other)).toThrow(`openreader-variant:${variant}`);
    expect(() => assertNativeVariant(other)).toThrow(/Rebuild/);
  }
});
