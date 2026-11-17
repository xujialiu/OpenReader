import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';

import { useReaderBridge, type ReaderBridge } from '../../src/renderer/reader-bridge';

vi.mock('@epubjs-react-native/core', () => ({
  useReader: () => ({ injectJavascript() {}, goToLocation() {}, theme: null, changeTheme() {} }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('@epubjs-react-native/core'));
const { useInjectWebViewVariables } = require(join(root, 'hooks/useInjectWebviewVariables.js'));

it('the visible Reader props skip the unused whole-spine Locations scan, including after a page restart (#255)', async () => {
  let bridge!: ReaderBridge;
  let inject!: (values: Record<string, unknown>) => string;
  function Probe() {
    bridge = useReaderBridge({});
    inject = useInjectWebViewVariables().injectWebViewVariables;
    return null;
  }
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(createElement(Probe)); });
  try {
    const check = async () => {
      // ReadingView spreads these real bridge props onto its Reader. Execute
      // the installed library branch, not a duplicate of its decision rule.
      const html = inject({ locations: Reflect.get(bridge.readerProps, 'initialLocations'), theme: {}, type: 'base64', book: 'fixture', jszip: 'zip', epubjs: 'epub' });
      const declaration = html.match(/const initialLocations = [^;]*;/)![0];
      const from = html.indexOf('book.ready');
      const until = html.indexOf('.then(function () {\n          var displayed', from);
      expect(from).toBeGreaterThan(0);
      expect(until).toBeGreaterThan(from);
      const generate = vi.fn(() => ({ then() {} }));
      const load = vi.fn();
      await runInNewContext(`${declaration}\n${html.slice(from, until)};`, { book: { ready: Promise.resolve(), locations: { generate, load } } });
      expect(generate).not.toHaveBeenCalled();
      expect(load).toHaveBeenCalledWith([]);
    };
    await check();
    bridge.restart();
    await check();
  } finally { await act(async () => tree.unmount()); }
});
