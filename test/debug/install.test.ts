import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_VERSION } from '../../app-version';

/**
 * `installDebugLog` against a file system, an AppState and a native module in
 * memory (ADR 0054). In a build without Debug Mode it must not touch any of
 * them: no folder, no file, no handler wrapped. With it: the folder under
 * Library, excluded from backup; the launch line; the app's comings and goings;
 * `console.warn`/`error`; uncaught errors, chained to the handler before; and
 * unhandled rejections in an embedded bundle.
 */
const world = vi.hoisted(() => ({
  made: [] as string[],
  files: new Map<string, string>(),
  excluded: [] as string[],
  touched: 0,
  appState: [] as ((state: string) => void)[],
  system: [] as string[],
}));

vi.mock('expo-file-system', () => {
  const uri = (parts: unknown[]) => parts.map((part) => (typeof part === 'string' ? part : (part as { uri: string }).uri)).join('/');
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      world.touched += 1;
      this.uri = uri(parts);
    }
    get parentDirectory() {
      return new Directory(this.uri.replace(/\/[^/]+$/, ''));
    }
    create() {
      world.made.push(this.uri);
    }
    list() {
      return [...world.files.keys()].filter((path) => path.startsWith(`${this.uri}/`)).map((path) => new File(path));
    }
  }
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      world.touched += 1;
      this.uri = uri(parts);
    }
    get name() {
      return this.uri.slice(this.uri.lastIndexOf('/') + 1);
    }
    get size() {
      return (world.files.get(this.uri) ?? '').length;
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
  debugLogNative: { nativeVersion: '0.0.1', nativeBuild: '1', systemLog: (line: string) => void world.system.push(line) },
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
  vi.doMock('../../src/debug/mode', () => ({ DEBUG_MODE: debugMode }));
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
  world.touched = 0;
  world.appState = [];
  world.system = [];
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
    expect(world.touched).toBe(0);
    expect(world.made).toEqual([]);
    expect(world.files.size).toBe(0);
    expect(world.system).toEqual([]);
    expect(world.appState).toEqual([]);
    expect(console.warn).toBe(original.warn);
    expect(console.error).toBe(original.error);
    expect(installedHandler).toBeNull();
    expect(tracker).toBeNull();
  });
});

describe('a build with Debug Mode', () => {
  it('keeps the log under Library, outside the backup, and starts it with the launch line', async () => {
    const log = await install(true);
    expect(world.made).toEqual([FOLDER]);
    expect(world.excluded).toEqual([FOLDER]);
    log.flushDebugLog();
    // The version is app-version.ts's, so a new beta or release changes nothing
    // here. It holds a bracket and dots since #127, so all of it is escaped.
    expect(written()).toMatch(new RegExp(
      `\\[launch\\] OpenReader ${APP_VERSION.replace(/[.()]/g, '\\$&')}, native 0\\.0\\.1 \\(1\\), Debug Mode on, embedded bundle, system log on, kept in file:///container/Library/Application Support/debug-log\n$`,
    ));
    expect(world.system[0]).toMatch(/^\[launch\] OpenReader /);
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
