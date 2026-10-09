import { defineConfig } from 'vitest/config';

/**
 * Deliberately the same shape as the Zotero-TTS plugin's vitest.config.ts:
 * `environment: 'node'`, tests under `test/**`, and no `globals`, so every
 * test imports what it uses from 'vitest'. About 3,200 lines of provider
 * tests come across from that repo (ADR 0013) and the point of matching is
 * that they arrive unchanged — including their relative imports, which is why
 * the copied layer lands at `src/core/providers/` under the same
 * `test/core/providers/` as there.
 *
 * `environment: 'node'` is the right one and not a stopgap. The provider suite
 * is driven entirely by fake `fetch` implementations and injected
 * dependencies; nothing in it wants a DOM, and the parts of OpenReader that do
 * want one live in a WebView (ADR 0011), which no JS test environment
 * simulates anyway. React Native code is not tested here at all — see
 * test/README.md.
 *
 * The `.mts` extension, where the plugin uses `.ts`: this package is CommonJS
 * (React Native's tooling assumes it), so Vite's native config loader refuses
 * ESM syntax in a `.ts` config and warns on every run. Nothing about the tests
 * depends on it.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    /**
     * Every test runs as a build without the lock (#148, ADR 0075), so the
     * Reading and the downloads under test speak as they did before there was
     * one. The Trial and the Unlock are tested with `lockOn` handed in
     * (`test/purchase/`) or a controller configured in (`test/app/purchase-*`).
     */
    env: { EXPO_PUBLIC_OPENREADER_UNLOCKED: '1' },
  },
});
