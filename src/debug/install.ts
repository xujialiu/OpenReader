/**
 * The Debug Log's platform half (ADR 0054): its folder, the system log, and the
 * lines nothing in the app writes itself — the launch, the app coming and
 * going, `console.warn`/`console.error`, uncaught errors and unhandled
 * rejections. Run once, first thing (`launch.ts`). In a build without Debug
 * Mode it does one thing only: it deletes a Debug Log folder that a build with
 * Debug Mode left on the device (#305). No folder is made, no file constructed,
 * no line written and no handler wrapped.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { AppState } from 'react-native';

import { APP_VERSION } from '../../app-version';
import { debugLogNative } from '../../modules/open-reader-debug-log';
import { offlineNative } from '../../modules/open-reader-offline';
import {
  clearForVersion,
  clearedLine,
  createDebugLog,
  debugLog,
  describeValue,
  flushDebugLog,
  setDebugLogWriter,
  type ClearedLog,
  type DebugLogFiles,
  type DebugLogVersion,
} from './debug-log';
import { buildVersion, DEBUG_MODE } from './mode';
import { recordNativePlayback } from './playback';

/**
 * Where the Debug Log is kept, from the app's container. Under Library, which
 * iOS never purges (Caches it may) and which the Files app never shows, and
 * excluded from iCloud backup: a debugging record is not the owner's data.
 * `test/manual-test/kit/debug-log.py` copies it with `devicectl device copy
 * from --domain-type appDataContainer`.
 */
export const DEBUG_LOG_FOLDER = ['Library', 'Application Support', 'debug-log'] as const;
/**
 * Beside the log, the version of the build that wrote it (#305): `APP_VERSION`
 * with the Debug Mode build's own number (`buildVersion`, #310). Not
 * `debug-log-….txt`, which the kit's scripts read as the log.
 */
export const DEBUG_LOG_VERSION_FILE = 'version.txt';

type Handler = (error: unknown, isFatal?: boolean) => void;
interface ErrorUtilsShape {
  getGlobalHandler(): Handler;
  setGlobalHandler(handler: Handler): void;
}
interface RejectionTracking {
  allRejections: boolean;
  onUnhandled(id: number, rejection: unknown): void;
  onHandled(id: number): void;
}
interface HermesShape {
  enablePromiseRejectionTracker?(options: RejectionTracking): void;
}

let installed = false;

export function installDebugLog(): void {
  if (installed) return;
  installed = true;
  if (!DEBUG_MODE) {
    removeLeftoverDebugLog();
    return;
  }
  const native = debugLogNative;
  const systemLog = native ? (line: string) => native.systemLog(line) : undefined;
  const folder = new Directory(Paths.document.parentDirectory, ...DEBUG_LOG_FOLDER);
  try {
    folder.create({ intermediates: true, idempotent: true });
    offlineNative?.excludeFromBackup(folder.uri);
  } catch (problem) {
    systemLog?.(`[app] the Debug Log's folder could not be made: ${describeValue(problem)}`);
  }
  const files = folderFiles(folder);
  // Only a build with Debug Mode gets here, so it names its own, even, number (#310).
  const version = buildVersion(APP_VERSION, true);
  let cleared: ClearedLog | null = null;
  try {
    cleared = clearForVersion(files, versionFile(folder), version);
  } catch (problem) {
    systemLog?.(`[app] the Debug Log of another version could not be cleared: ${describeValue(problem)}`);
  }
  setDebugLogWriter(createDebugLog({ files, now: () => Date.now(), systemLog }));

  debugLog(
    'launch',
    `OpenReader ${version}, native ${native?.nativeVersion ?? '?'} (${native?.nativeBuild ?? '?'}), ` +
      `Debug Mode on, ${__DEV__ ? 'Metro' : 'embedded'} bundle, system log ${systemLog ? 'on' : 'missing (no native module)'}, ` +
      `kept in ${folder.uri}${cleared ? `; ${clearedLine(cleared)}` : ''}`,
  );

  // Capture at native event time, not at the later JS delivery time. No native
  // subscription or timer exists without Debug Mode. Empty drains write nothing.
  const drainPlayback = () => {
    if (native) recordNativePlayback(native.drainPlaybackCapture(), Date.now());
  };
  if (native) {
    native.startPlaybackCapture();
    setInterval(drainPlayback, 1_000);
  }

  AppState.addEventListener('change', (state) => {
    drainPlayback();
    debugLog('app', `app ${state}`);
    if (state !== 'active') flushDebugLog();
  });

  for (const level of ['warn', 'error'] as const) {
    const original = console[level];
    console[level] = (...args: unknown[]) => {
      debugLog(level, args.map(describeValue).join(' '));
      original.apply(console, args);
    };
  }

  const errors = (globalThis as { ErrorUtils?: ErrorUtilsShape }).ErrorUtils;
  const previous = errors?.getGlobalHandler();
  errors?.setGlobalHandler((error, isFatal) => {
    debugLog('error', `${isFatal ? 'fatal' : 'uncaught'} ${describeValue(error)}`);
    // The app may be gone before the next flush.
    if (isFatal) flushDebugLog();
    previous?.(error, isFatal);
  });

  // React Native tracks rejections only in a Metro build, where its own tracker
  // reports them, and a second one would replace it. An embedded bundle has none.
  if (!__DEV__) {
    (globalThis as { HermesInternal?: HermesShape }).HermesInternal?.enablePromiseRejectionTracker?.({
      allRejections: true,
      onUnhandled: (id, rejection) => debugLog('error', `unhandled rejection ${id}: ${describeValue(rejection)}`),
      onHandled: (id) => debugLog('error', `rejection ${id} was handled after all`),
    });
  }
}

/**
 * A build without Debug Mode installed over one with it (TestFlight, the App
 * Store) would otherwise keep up to 100 MB nobody can see or read (#305). Only
 * the folder is looked at; nothing is said, since such a build writes no line.
 */
function removeLeftoverDebugLog(): void {
  try {
    const folder = new Directory(Paths.document.parentDirectory, ...DEBUG_LOG_FOLDER);
    if (folder.exists) folder.delete();
  } catch {
    // Left for the next launch to try again.
  }
}

/** `version.txt` in the folder, read and written once at launch. */
function versionFile(folder: Directory): DebugLogVersion {
  const file = new File(folder, DEBUG_LOG_VERSION_FILE);
  return { read: () => (file.exists ? file.textSync() : null), write: (version) => file.write(version) };
}

/** The folder as the writer sees it; each call is one synchronous file operation, made only at a flush. */
function folderFiles(folder: Directory): DebugLogFiles {
  return {
    list: () => folder.list().flatMap((one) => (one instanceof File ? [one.name] : [])),
    size: (name) => new File(folder, name).size,
    append: (name, text) => new File(folder, name).write(text, { append: true }),
    remove: (name) => new File(folder, name).delete(),
  };
}
