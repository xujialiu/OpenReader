import { expect, it } from 'vitest';
import { bundleSources } from '../../scripts/build/source-map.mjs';

const flat = (sources: string[]) => ({ version: 3, sources, names: [], mappings: '' });
const section = (map: unknown) => ({ offset: { line: 0, column: 0 }, map });

it('retains the flat Metro source-map format', () => {
  expect(bundleSources(flat(['index.ts', '/node_modules/react/index.js']))).toEqual(['index.ts', '/node_modules/react/index.js']);
});

it('collects every embedded section in SDK 58 indexed maps, including nested sections', () => {
  expect(bundleSources({ version: 3, sections: [
    section(flat(['__prelude__'])),
    section(flat(['/node_modules/expo/node_modules/@expo/cli/require.js'])),
    section({ version: 3, sections: [section(flat(['/node_modules/react/index.js']))] }),
  ] })).toEqual(['__prelude__', '/node_modules/expo/node_modules/@expo/cli/require.js', '/node_modules/react/index.js']);
});

it.each([
  null,
  { version: 2, sources: [] },
  { version: 3 },
  { version: 3, sources: [null] },
  { version: 3, sources: [], sections: [] },
  { version: 3, sections: [{ url: 'unread.map' }] },
  { version: 3, sections: [section(flat(['valid.js'])), section({ version: 3 })] },
])('refuses an incomplete or unsupported map rather than silently omitting licences: %j', (map) => {
  expect(() => bundleSources(map)).toThrow();
});
