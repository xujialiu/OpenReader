import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import config from '../../app.config';
import manifest from '../../package.json';
import { aboutLine, acknowledgement, acknowledgements, type Acknowledgement } from '../../src/app/acknowledgements';

/**
 * #111: Settings → Acknowledgements shows what scripts/acknowledgements/
 * generate.mjs wrote into src/app/acknowledgements.json, which is committed. A
 * list is only right for the tree it was generated from. So these fail the
 * moment the tree moves on and the list does not: a dependency added or
 * upgraded without `npm run acknowledgements` is a component shipped without
 * its notice, which is what #111 exists to prevent.
 */

const entries = acknowledgements();

/** The version npm installed a dependency at, as the build ships it. Read from the file: some packages' exports hide it from `require`. */
function installed(name: string): string {
  const path = new URL(`../../node_modules/${name}/package.json`, import.meta.url);
  return (JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version;
}

describe('#111: every component the app ships is acknowledged with its licence text', () => {
  it('finds a list to check, so an empty one cannot pass', () => {
    expect(entries.length).toBeGreaterThan(100);
  });

  it('names every dependency in package.json, at the version installed', () => {
    // Every dependency ships: in the bundle, as a pod, or both. A missing one, or
    // one at another version, means the list was not regenerated after it changed.
    const stale = Object.keys(manifest.dependencies).flatMap((name) => {
      const entry = acknowledgement(name);
      if (!entry) return [`${name} is not listed`];
      const version = installed(name);
      return entry.version.split(', ').includes(version) ? [] : [`${name} is listed at ${entry.version}, installed at ${version}`];
    });
    expect(stale, 'run `npm run acknowledgements` (after `npx expo prebuild --platform ios`)').toEqual([]);
  });

  it('gives every entry a licence and the licence\'s text', () => {
    const empty = entries.filter((entry) => !entry.license.trim() || entry.text.trim().length < 100).map((entry) => entry.name);
    expect(empty).toEqual([]);
  });

  it('lists each component once, alphabetically by its first letter or digit', () => {
    const names = entries.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    const key = (name: string) => name.replace(/^[^\p{L}\p{N}]+/u, '');
    const sorted = [...names].sort((a, b) => key(a).localeCompare(key(b), 'en', { sensitivity: 'base' }) || a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it('acknowledges FFmpeg under the LGPL while the audio library links it', () => {
    // react-native-audio-api vendors FFmpeg's four libraries as frameworks unless
    // its plugin is told otherwise, and each binary reports "LGPL version 2.1 or later".
    const plugin = (config.plugins ?? []).find((entry) => Array.isArray(entry) && entry[0] === 'react-native-audio-api') as [string, { disableFFmpeg?: boolean }];
    expect(plugin[1].disableFFmpeg).toBe(false);
    const ffmpeg = acknowledgement('FFmpeg');
    expect(ffmpeg?.license).toBe('LGPL-2.1-or-later');
    expect(ffmpeg?.carriedBy).toBe('react-native-audio-api');
    expect(ffmpeg?.text).toContain('GNU LESSER GENERAL PUBLIC LICENSE');
  });
});

describe('#111: the line under a licence', () => {
  const entry = (fields: Partial<Acknowledgement>): Acknowledgement => ({ name: 'x', version: '', license: 'MIT', text: 'x', ...fields });

  it('says the version, what carried it, and the note, in that order', () => {
    expect(aboutLine(entry({ version: '8.0.1', carriedBy: 'react-native-audio-api', note: 'Linked dynamically.' })))
      .toBe('Version 8.0.1, part of react-native-audio-api. Linked dynamically.');
  });

  it('leaves out what it does not know', () => {
    expect(aboutLine(entry({ version: '1.0.0' }))).toBe('Version 1.0.0.');
    expect(aboutLine(entry({ carriedBy: 'expo-sqlite' }))).toBe('Part of expo-sqlite.');
    expect(aboutLine(entry({}))).toBe('');
  });
});
