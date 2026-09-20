import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { EMPTY_LOCATIONS_SOURCE } from '../../src/offline/reader-locations';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('@epubjs-react-native/core'));
const { useInjectWebViewVariables } = require(join(root, 'hooks/useInjectWebviewVariables.js'));

it('uses the installed Reader template to load empty locations without scanning the spine', async () => {
  let inject!: (values: Record<string, unknown>) => string;
  function Harness() { inject = useInjectWebViewVariables().injectWebViewVariables; return null; }
  let mounted!: ReturnType<typeof create>;
  await act(async () => { mounted = create(createElement(Harness)); });
  try {
    const html = inject({ locations: EMPTY_LOCATIONS_SOURCE, theme: {}, type: 'base64', book: 'fixture', jszip: 'zip', epubjs: 'epub' });
    const declaration = html.match(/const initialLocations = [^;]*;/)![0];
    expect(declaration).toBe('const initialLocations = [];');
    const from = html.indexOf('book.ready');
    const until = html.indexOf('.then(function () {\n          var displayed', from);
    expect(from).toBeGreaterThan(0); expect(until).toBeGreaterThan(from);
    const generate = vi.fn(); const load = vi.fn();
    // Execute the actual installed initialization branch, not a mock of its logic.
    await runInNewContext(`${declaration}\n${html.slice(from, until)};`, {
      book: { ready: Promise.resolve(), locations: { generate, load } },
    });
    expect(load).toHaveBeenCalledWith([]); expect(generate).not.toHaveBeenCalled();
    // The published array type is insufficient: an empty array emits invalid JS.
    expect(inject({ locations: [] })).toContain('const initialLocations = ;');
  } finally { await act(async () => mounted.unmount()); }
});
