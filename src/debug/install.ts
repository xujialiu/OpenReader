/**
 * The Debug Log's platform half (ADR 0054): its folder, the system log, and the
 * lines nothing in the app writes itself — the launch, the app coming and
 * going, `console.warn`/`console.error`, uncaught errors and unhandled
 * rejections. Run once, first thing (`launch.ts`), and in Debug Mode only: in a
 * build without it `installDebugLog` returns before touching anything, so no
 * folder is made, no file written and no handler wrapped.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { AppState } from 'react-native';

import { APP_VERSION } from '../../app-version';
import { debugLogNative } from '../../modules/open-reader-debug-log';
import { offlineNative } from '../../modules/open-reader-offline';
import { createDebugLog, debugLog, describeValue, flushDebugLog, setDebugLogWriter, type DebugLogFiles } from './debug-log';
import { DEBUG_MODE } from './mode';

/**
 * Where the Debug Log is kept, from the app's container. Under Library, which
 * iOS never purges (Caches it may) and which the Files app never shows, and
 * excluded from iCloud backup: a debugging record is not the owner's data.
 * `test/manual-test/kit/debug-log.sh` copies it with `devicectl device copy
 * from --domain-type appDataContainer`.
 */
export const DEBUG_LOG_FOLDER = ['Library', 'Application Support', 'debug-log'] as const;

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
  if (!DEBUG_MODE || installed) return;
  installed = true;
  const native = debugLogNative;
  const systemLog = native ? (line: string) => native.systemLog(line) : undefined;
  const folder = new Directory(Paths.document.parentDirectory, ...DEBUG_LOG_FOLDER);
  try {
    folder.create({ intermediates: true, idempotent: true });
    offlineNative?.excludeFromBackup(folder.uri);
  } catch (problem) {
    systemLog?.(`[app] the Debug Log's folder could not be made: ${describeValue(problem)}`);
  }
  setDebugLogWriter(createDebugLog({ files: folderFiles(folder), now: () => Date.now(), systemLog }));

  debugLog(
    'launch',
    `OpenReader ${APP_VERSION}, native ${native?.nativeVersion ?? '?'} (${native?.nativeBuild ?? '?'}), ` +
      `Debug Mode on, ${__DEV__ ? 'Metro' : 'embedded'} bundle, system log ${systemLog ? 'on' : 'missing (no native module)'}, ` +
      `kept in ${folder.uri}`,
  );

  AppState.addEventListener('change', (state) => {
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

/** The folder as the writer sees it; each call is one synchronous file operation, made only at a flush. */
function folderFiles(folder: Directory): DebugLogFiles {
  return {
    list: () => folder.list().flatMap((one) => (one instanceof File ? [one.name] : [])),
    size: (name) => new File(folder, name).size,
    append: (name, text) => new File(folder, name).write(text, { append: true }),
    remove: (name) => new File(folder, name).delete(),
  };
}
