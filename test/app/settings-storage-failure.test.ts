import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '../../src/app/settings';
import { readSettings, writeSettings } from '../../src/app/settings-storage';

/** Real settings serialization and reload; only the native filesystem boundary is doubled. */
const disk = vi.hoisted(() => ({
  files: new Map<string, string>(),
  failure: null as 'empty' | 'partial' | null,
  nativeAvailable: true,
}));
vi.mock('expo-file-system', () => ({
  Paths: { document: 'file:///documents' },
  File: class {
    readonly uri: string;
    constructor(directory: string, name: string) { this.uri = `${directory}/${name}`; }
    get exists() { return disk.files.has(this.uri); }
    textSync() { return disk.files.get(this.uri); }
    write(text: string) {
      // Expo's non-atomic write may truncate its destination before throwing (#186).
      if (disk.failure) {
        disk.files.set(this.uri, disk.failure === 'empty' ? '' : text.slice(0, 30));
        throw new Error('No space left on device');
      }
      disk.files.set(this.uri, text);
    }
  },
}));
vi.mock('../../modules/open-reader-offline', () => ({
  get offlineNative() {
    return disk.nativeAvailable ? {
      writeJson(uri: string, text: string) {
        // Foundation's atomic writer commits only after the new bytes are written.
        if (disk.failure) throw new Error('No space left on device');
        disk.files.set(uri, text);
      },
    } : null;
  },
}));

const uri = 'file:///documents/settings.json';
const saved = {
  ...DEFAULT_SETTINGS,
  theme: 'dark' as const,
  sync: { url: 'https://dav.example/reading', username: 'owner', enabled: true },
};
const changed = { ...saved, fish: { ...saved.fish, voices: 'a'.repeat(5_000) } };

beforeEach(() => {
  disk.files.clear();
  disk.failure = null;
  disk.nativeAvailable = true;
});

describe('settings survive a refused save (#186)', () => {
  it.each(['empty', 'partial'] as const)('reloads the last successful settings after a %s write failure', (failure) => {
    writeSettings(saved);
    const before = disk.files.get(uri);
    disk.failure = failure;
    expect(() => writeSettings(changed)).toThrow('No space left on device');
    expect(disk.files.get(uri)).toBe(before);
    expect(readSettings()).toEqual(saved);
  });

  it('can save again after storage recovers', () => {
    writeSettings(saved);
    disk.failure = 'empty';
    expect(() => writeSettings(changed)).toThrow();
    disk.failure = null;
    writeSettings(changed);
    expect(readSettings()).toEqual(changed);
  });

  it('leaves a failed first save absent rather than creating corrupt settings', () => {
    disk.failure = 'empty';
    expect(() => writeSettings(saved)).toThrow();
    expect(disk.files.has(uri)).toBe(false);
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('refuses to overwrite settings without the atomic native writer', () => {
    writeSettings(saved);
    disk.nativeAvailable = false;
    expect(() => writeSettings(changed)).toThrow();
    expect(readSettings()).toEqual(saved);
  });

  it('still projects out credentials before the atomic write', () => {
    const withSecret = { ...saved, compatible: { ...saved.compatible, apiKey: 'not-for-disk' } };
    writeSettings(withSecret);
    expect(disk.files.get(uri)).not.toContain('not-for-disk');
    expect(readSettings()).toEqual(saved);
  });
});
