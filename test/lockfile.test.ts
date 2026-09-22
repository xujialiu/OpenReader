import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import manifest from '../package.json';

/**
 * ADR 0039: a clone of this repository installs with `npm ci` and no flags.
 *
 * It did not, for eleven days. `@expo/ui` depends on `vaul` and six
 * `@radix-ui/*` packages whose `react-dom` peer is not optional, so npm must
 * place a `react-dom`; left to itself it places the newest, whose peer is a
 * `react` this project does not pin, and writes that pair down. `npm ci` then
 * refuses to install the lockfile npm wrote — before installing anything, so
 * Metro, the suite, the typecheck and the lint are all equally unreachable
 * until whoever met it knows to pass `--legacy-peer-deps`.
 *
 * The check lives here rather than in the suite's reach of the app because
 * nothing in the app can see it: the failure is in the install, and by the time
 * a test runs, the install has succeeded. A real `npm ci` is the true signal and
 * takes 4 s and a network; what makes it fail is a state in the lockfile, and
 * that is what is read below.
 */

type Lock = { packages: Record<string, { version?: string }> };

const lock = JSON.parse(readFileSync(join(__dirname, '..', 'package-lock.json'), 'utf8')) as Lock;

/** Every copy of `name` in the tree, deepest paths included, in lockfile order. */
function copiesOf(name: string): { path: string; version: string }[] {
  return Object.entries(lock.packages)
    .filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`))
    .map(([path, node]) => ({ path, version: node.version ?? '(none)' }));
}

describe('ADR 0039: react-dom follows the react the project pins', () => {
  it('names react-dom in overrides as a reference to react, not as a copy of its number', () => {
    // `$react` resolves to whatever spec `react` carries in this same file, so
    // an Expo upgrade that moves `react` moves `react-dom` with it. Writing the
    // version out instead would leave two numbers to keep in step, which is the
    // drift that made `npm ci` fail in the first place — and `^19.2.3` would be
    // worse than either, because `react-dom@19.2.8` is published and peers with
    // `react@^19.2.8`, straight back into the conflict.
    expect(manifest.overrides['react-dom']).toBe('$react');
  });

  it('locks every react-dom in the tree at the version react is locked at', () => {
    // The state that decides whether `npm ci` installs. A second copy nested
    // under some package is as fatal as the top-level one, so this sweeps the
    // whole lockfile rather than reading one path.
    const [react, ...otherReacts] = copiesOf('react');
    expect(react, 'the lockfile holds no react').toBeDefined();
    expect(otherReacts, 'a second react in the tree is its own bug').toEqual([]);
    expect(copiesOf('react-dom').map((copy) => `${copy.path}@${copy.version}`)).toEqual([
      `node_modules/react-dom@${react!.version}`,
    ]);
  });

  it('locks both at the version this Expo SDK names', () => {
    // Read from the installed Expo rather than written down here, so this
    // asserts the rule and not a number that would have to be edited on every
    // upgrade. SDK 57 names one version for the two of them.
    const expected = require('expo/bundledNativeModules.json') as Record<string, string>;
    expect(copiesOf('react')[0]?.version).toBe(expected['react']);
    expect(copiesOf('react-dom')[0]?.version).toBe(expected['react-dom']);
  });
});
