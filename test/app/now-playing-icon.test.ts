import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExportedConfig, ExportedConfigWithProps } from 'expo/config-plugins';
import { afterEach, describe, expect, it } from 'vitest';

import withNowPlayingIcon, { NOW_PLAYING_ICON, NOW_PLAYING_ICON_SOURCE } from '../../plugins/with-now-playing-icon';
import config from '../../app.config';

/**
 * #119: the picture Now Playing shows for a Document without a Cover.
 *
 * The plugin runs at prebuild, which nothing else in this suite reaches, and the
 * way it fails on the phone is Now Playing's empty grey square — or, before it
 * existed, the reader going down, because the app icon set itself raises in
 * UIKit when loaded as a picture. So its write and both of its refusals are run
 * here against a directory of the test's own.
 */

const root = new URL('../../', import.meta.url).pathname;
const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A generated `ios/` with (or without) its asset catalog. */
function generated({ catalog }: { catalog: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), 'now-playing-icon-'));
  made.push(dir);
  if (catalog) mkdirSync(join(dir, 'ios', 'OpenReader', 'Images.xcassets'), { recursive: true });
  return dir;
}

async function run(projectRoot: string, platformProjectRoot: string): Promise<void> {
  const base = { name: 'OpenReader', slug: 'openreader' };
  const mod = (withNowPlayingIcon(base) as ExportedConfig).mods?.ios?.dangerous;
  if (!mod) throw new Error('The plugin registered no iOS dangerous mod at all.');
  await mod({
    ...base,
    modResults: {},
    modRequest: { projectRoot, platformProjectRoot, projectName: 'OpenReader', platform: 'ios', introspect: false },
  } as unknown as ExportedConfigWithProps<unknown>);
}

describe('the app icon Now Playing shows, copied into an image set of its own (#119)', () => {
  it('is in the config', () => {
    expect(config.plugins).toContain('./plugins/with-now-playing-icon.ts');
  });

  it('copies the icon PNG byte for byte into NowPlayingIcon.imageset', async () => {
    const dir = generated({ catalog: true });
    await run(root, join(dir, 'ios'));
    const set = join(dir, 'ios', 'OpenReader', 'Images.xcassets', `${NOW_PLAYING_ICON}.imageset`);
    expect(readFileSync(join(set, `${NOW_PLAYING_ICON}.png`)).equals(readFileSync(join(root, NOW_PLAYING_ICON_SOURCE)))).toBe(true);
    expect(JSON.parse(readFileSync(join(set, 'Contents.json'), 'utf8'))).toEqual({
      images: [{ filename: 'NowPlayingIcon.png', idiom: 'universal' }],
      info: { author: 'xcode', version: 1 },
    });
  });

  it('is the name the Swift loads', () => {
    const swift = readFileSync(join(root, 'modules/open-reader-now-playing/ios/OpenReaderNowPlayingModule.swift'), 'utf8');
    expect(swift).toContain(`static let iconName = "${NOW_PLAYING_ICON}"`);
  });

  it('stops the prebuild when there is no asset catalog to write into', async () => {
    const dir = generated({ catalog: false });
    await expect(run(root, join(dir, 'ios'))).rejects.toThrow('There is no asset catalog');
  });

  it('stops the prebuild when the icon PNG is missing', async () => {
    const dir = generated({ catalog: true });
    await expect(run(dir, join(dir, 'ios'))).rejects.toThrow(`${NOW_PLAYING_ICON_SOURCE} does not exist`);
  });
});
