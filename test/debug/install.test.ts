import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_VERSION } from '../../app-version';

/** `APP_VERSION` as a build with Debug Mode names itself: its Build Number one higher (#310, ADR 0083). */
const DEBUG_BUILD = APP_VERSION.replace(/\((\d+)\)/, (_, build: string) => `(${Number(build) + 1})`);

/**
 * `installDebugLog` against a file system, an AppState and a native module in
 * memory (ADR 0054). In a build without Debug Mode it must touch none of
 * them but one: a Debug Log folder an earlier build left is deleted (#305), and
 * then no folder is made, no file constructed and no handler wrapped. With it:
 * the folder under Library, excluded from backup, emptied when another version
 * wrote it (#305); the launch line; the app's comings and goings;
 * `console.warn`/`error`; uncaught errors, chained to the handler before; and
 * unhandled rejections in an embedded bundle.
 */
const world = vi.hoisted(() => ({
  made: [] as string[],
  files: new Map<string, string>(),
  excluded: [] as string[],
  deleted: [] as string[],
  filesTouched: 0,
  appState: [] as ((state: string) => void)[],
  system: [] as string[],
  captureStarts: 0,
  captureDrains: 0,
  nativeEvents: [] as unknown[],
}));

vi.mock('expo-file-system', () => {
  const uri = (parts: unknown[]) => parts.map((part) => (typeof part === 'string' ? part : (part as { uri: string }).uri)).join('/');
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = uri(parts);
    }
    get parentDirectory() {
      return new Directory(this.uri.replace(/\/[^/]+$/, ''));
    }
    create() {
      world.made.push(this.uri);
    }
    get exists() {
      return world.made.includes(this.uri) || [...world.files.keys()].some((path) => path.startsWith(`${this.uri}/`));
    }
    delete() {
      world.deleted.push(this.uri);
      world.made = world.made.filter((made) => made !== this.uri);
      for (const path of [...world.files.keys()]) if (path.startsWith(`${this.uri}/`)) world.files.delete(path);
    }
    list() {
      return [...world.files.keys()].filter((path) => path.startsWith(`${this.uri}/`)).map((path) => new File(path));
    }
  }
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      world.filesTouched += 1;
      this.uri = uri(parts);
    }
    get name() {
      return this.uri.slice(this.uri.lastIndexOf('/') + 1);
    }
    get size() {
      return (world.files.get(this.uri) ?? '').length;
    }
    get exists() {
      return world.files.has(this.uri);
    }
    textSync() {
      return world.files.get(this.uri) ?? '';
    }
    write(text: string, options?: { append?: boolean }) {
      world.files.set(this.uri, (options?.append ? (world.files.get(this.uri) ?? '') : '') + text);
    }
    delete() {
      world.files.delete(this.uri);
    }
  }
  return { Directory, File, Paths: { get document() { return new Directory('file:///container/Documents'); } } };
});
vi.mock('react-native', () => ({
  AppState: { addEventListener: (_event: string, listener: (state: string) => void) => { world.appState.push(listener); return { remove() {} }; } },
}));
vi.mock('../../modules/open-reader-debug-log', () => ({
  debugLogNative: {
    nativeVersion: '0.0.1', nativeBuild: '1', systemLog: (line: string) => void world.system.push(line),
    startPlaybackCapture() { world.captureStarts++; },
    drainPlaybackCapture() { world.captureDrains++; const events = world.nativeEvents.splice(0); return { events, dropped: 0 }; },
  },
}));
vi.mock('../../modules/open-reader-offline', () => ({
  offlineNative: { excludeFromBackup: (uri: string) => void world.excluded.push(uri) },
}));

const FOLDER = 'file:///container/Library/Application Support/debug-log';
const original = { warn: console.warn, error: console.error };
let previousHandler: ReturnType<typeof vi.fn>;
let installedHandler: ((error: unknown, isFatal?: boolean) => void) | null;
let tracker: { onUnhandled(id: number, rejection: unknown): void } | null;

async function install(debugMode: boolean, dev = false) {
  vi.resetModules();
  vi.doMock('../../src/debug/mode', async (real) => ({ ...(await real<typeof import('../../src/debug/mode')>()), DEBUG_MODE: debugMode }));
  vi.stubGlobal('__DEV__', dev);
  vi.stubGlobal('ErrorUtils', {
    getGlobalHandler: () => previousHandler,
    setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => { installedHandler = handler; },
  });
  vi.stubGlobal('HermesInternal', { enablePromiseRejectionTracker: (options: typeof tracker) => { tracker = options; } });
  const module = await import('../../src/debug/install');
  module.installDebugLog();
  return await import('../../src/debug/debug-log');
}

/** The Debug Log's one file so far, once flushed. */
const written = () => world.files.get(`${FOLDER}/debug-log-000001.txt`) ?? '';

beforeEach(() => {
  vi.useFakeTimers();
  world.made = [];
  world.files.clear();
  world.excluded = [];
  world.deleted = [];
  world.filesTouched = 0;
  world.appState = [];
  world.system = [];
  world.captureStarts = 0;
  world.captureDrains = 0;
  world.nativeEvents = [];
  previousHandler = vi.fn();
  installedHandler = null;
  tracker = null;
});
afterEach(() => {
  console.warn = original.warn;
  console.error = original.error;
  vi.unstubAllGlobals();
  vi.doUnmock('../../src/debug/mode');
  vi.useRealTimers();
});

describe('a build without Debug Mode', () => {
  it('makes no folder, writes no file and wraps nothing', async () => {
    const log = await install(false);
    log.debugLog('reading', 'play');
    log.flushDebugLog();
    vi.advanceTimersByTime(60_000);
    expect(world.filesTouched).toBe(0);
    expect(world.deleted).toEqual([]);
    expect(world.captureStarts).toBe(0);
    expect(world.captureDrains).toBe(0);
    expect(world.made).toEqual([]);
    expect(world.files.size).toBe(0);
    expect(world.system).toEqual([]);
    expect(world.appState).toEqual([]);
    expect(console.warn).toBe(original.warn);
    expect(console.error).toBe(original.error);
    expect(installedHandler).toBeNull();
    expect(tracker).toBeNull();
  });

  it('deletes the Debug Log a build with Debug Mode left, and does nothing else (#305)', async () => {
    world.files.set(`${FOLDER}/debug-log-000001.txt`, 'an earlier build\'s lines\n');
    world.files.set(`${FOLDER}/version.txt`, '1.0.0 (9)-beta11');
    world.files.set('file:///container/Documents/harness.json', '{}');
    const log = await install(false);
    log.debugLog('reading', 'play');
    log.flushDebugLog();
    expect(world.deleted).toEqual([FOLDER]);
    expect([...world.files.keys()]).toEqual(['file:///container/Documents/harness.json']);
    expect(world.filesTouched).toBe(0);
    expect(world.made).toEqual([]);
    expect(world.system).toEqual([]);
    expect(world.appState).toEqual([]);
    expect(installedHandler).toBeNull();
  });
});

describe('a build with Debug Mode', () => {
  it('keeps native origin times across delayed JS delivery, and empty drains write nothing', async () => {
    const log = await install(true);
    expect(world.captureStarts).toBe(1);
    world.nativeEvents.push({ event: 'session.route', sequence: 1, nativeMs: 100, uptimeMs: 200, reason: 2, privateText: 'must not persist' });
    vi.advanceTimersByTime(1_000);
    log.flushDebugLog();
    expect(written()).toContain('native session.route receivedMs=');
    expect(written()).toContain('sequence=1 nativeMs=100 uptimeMs=200 reason=2');
    expect(written()).not.toContain('must not persist');
    const before = written();
    vi.advanceTimersByTime(60_000);
    log.flushDebugLog();
    expect(written()).toBe(before);
  });
  it('keeps the log under Library, outside the backup, and starts it with the launch line', async () => {
    const log = await install(true);
    expect(world.made).toEqual([FOLDER]);
    expect(world.excluded).toEqual([FOLDER]);
    log.flushDebugLog();
    // The version is app-version.ts's with the Debug Mode build's own number
    // (#310), so a new beta or release changes nothing here. It holds a bracket
    // and dots since #127, so all of it is escaped.
    expect(DEBUG_BUILD).not.toBe(APP_VERSION);
    expect(written()).toMatch(new RegExp(
      `\\[launch\\] OpenReader ${DEBUG_BUILD.replace(/[.()]/g, '\\$&')}, native 0\\.0\\.1 \\(1\\), Debug Mode on, embedded bundle, system log on, kept in file:///container/Library/Application Support/debug-log\n$`,
    ));
    expect(world.system[0]).toMatch(/^\[launch\] OpenReader /);
  });

  it('empties a folder another version wrote, remembers this one, and ends the launch line with what went (#305)', async () => {
    world.files.set(`${FOLDER}/debug-log-000003.txt`, 'x'.repeat(3_145_728));
    world.files.set(`${FOLDER}/debug-log-000004.txt`, 'y'.repeat(1_048_576));
    world.files.set(`${FOLDER}/version.txt`, '1.0.0 (9)-beta11');
    const log = await install(true);
    log.flushDebugLog();
    expect([...world.files.keys()].sort()).toEqual([`${FOLDER}/debug-log-000001.txt`, `${FOLDER}/version.txt`]);
    expect(world.files.get(`${FOLDER}/version.txt`)).toBe(DEBUG_BUILD);
    expect(written()).toMatch(/, kept in file:\/\/\/container\/Library\/Application Support\/debug-log; cleared the Debug Log of 1\.0\.0 \(9\)-beta11: 2 files, 4\.0 MB\n$/);
  });

  it('goes on with the log the same version wrote', async () => {
    world.files.set(`${FOLDER}/debug-log-000001.txt`, 'before the reinstall\n');
    world.files.set(`${FOLDER}/version.txt`, DEBUG_BUILD);
    const log = await install(true);
    log.flushDebugLog();
    expect(written()).toMatch(/^before the reinstall\n.*\[launch\] OpenReader .*debug-log\n$/s);
    expect(written()).not.toContain('cleared');
  });

  it('writes the app coming and going, and flushes as it leaves the foreground', async () => {
    await install(true);
    world.appState.forEach((listener) => listener('background'));
    expect(written()).toContain('[app] app background');
  });

  it('writes console.warn and console.error and still calls them', async () => {
    const warn = vi.fn();
    console.warn = warn;
    console.error = vi.fn();
    const log = await install(true);
    console.warn('Chapter ch-3 was not prepared ahead:', new Error('timed out'));
    console.error({ code: 7 });
    log.flushDebugLog();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(written()).toMatch(/\[warn\] Chapter ch-3 was not prepared ahead: Error: timed out/);
    expect(written()).toContain('[error] {"code":7}');
  });

  it('writes an uncaught error, flushes a fatal one at once, and hands both to the handler before', async () => {
    await install(true);
    installedHandler!(new TypeError('boom'), true);
    expect(written()).toMatch(/\[error\] fatal TypeError: boom/);
    expect(previousHandler).toHaveBeenCalledWith(expect.any(TypeError), true);
  });

  it('tracks unhandled rejections in an embedded bundle, and leaves React Native\'s own tracker in a Metro one', async () => {
    const log = await install(true, false);
    tracker!.onUnhandled(3, new Error('no voice'));
    log.flushDebugLog();
    expect(written()).toContain('[error] unhandled rejection 3: Error: no voice');
    tracker = null;
    await install(true, true);
    expect(tracker).toBeNull();
  });
});
