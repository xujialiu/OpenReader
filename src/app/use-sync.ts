/**
 * The **Sync Folder** while the app is running (ADR 0003, issue #20): one
 * transport over `core/sync/`, built from the settings and the Keychain, wired
 * to the Library, and poked at the moments the design names.
 *
 * Three things are decided here and nowhere else.
 *
 * **What the transport is given.** `fetch` and the password enter through the
 * client the transport asks for per run, so a password saved a second ago is
 * the one the next run uses and nothing in `core/` ever sees the platform.
 * `local()` reads the Library's entries at the moment of the run, `adopt()`
 * writes the Library once for everything taken.
 *
 * **Checking a folder.** Turning the switch on runs `check` — the client's own
 * PROPFIND — and a folder that is not there yet passes: the address and the
 * account were both proved by the 404, and the first upload creates the folder
 * (the plugin's client does the MKCOL). Anything else that fails is the reason
 * the switch goes back off.
 *
 * **The bound on a wait.** Pressing Play waits for a sync, but for two
 * seconds at most (`WAIT_MS`): a slow server must not hold the Reading back
 * for long. Past the bound the caller carries on from the local place and the
 * run finishes in the background; what it then adopts reaches the open book
 * through `adoptedAt`, or waits for the next open.
 *
 * **No wait for a server just found unreachable** (#304). When a run has just
 * failed for want of the server, or one has been out at it for the whole bound
 * already, a wait would only spend the two seconds and then start from the
 * local place anyway: on the owner's phone, three presses in a row did exactly
 * that while every request hung for its 15 s. So `wait` answers `'late'` at
 * once and leaves its run going behind it. The phone's network coming back
 * (`onConnectivity`) and any run that reaches the server end that.
 *
 * And one thing about its shape: the handle is stable and the last outcome is
 * returned beside it, so that nothing depending on the handle runs again when a
 * run completes. `SyncHandle` says why.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { withTimeout } from '../core/timeout';
import { createPositionsTransport, SYNC_RETRY_MS, syncWarning, type PositionsTransport, type SyncClient, type SyncOutcome } from '../core/sync/transport';
import { createWebDAVClient, WebDAVError, type WebDAVClient } from '../core/sync/webdav';
import { forbidCredential } from '../debug/credentials';
import { cutAddress, debugLog } from '../debug/debug-log';
import { SYNC_PASSWORD_ENTRY_NAME } from '../keys/entry-name';
import { readSyncPassword } from '../keys/store';

import type { AppSettings, SyncSettings } from './settings';
import type { Library } from './use-library';

/** How long pressing Play waits for a sync before carrying on. */
export const WAIT_MS = 2_000;

/**
 * Why Play should not wait for a sync just now, or null when it should (#304):
 * the last run could not reach the server less than `SYNC_RETRY_MS` ago, or the
 * run in flight has been out at the server for `WAIT_MS` already.
 */
export function noWaitReason(transport: Pick<PositionsTransport, 'unreachableAt' | 'runningSince'>, now: number): string | null {
  const failed = transport.unreachableAt();
  if (failed !== null && now - failed < SYNC_RETRY_MS) {
    return `the last run could not reach the server ${Math.round((now - failed) / 1000)} s ago`;
  }
  const since = transport.runningSince();
  if (since !== null && now - since >= WAIT_MS) {
    return `a run has had no answer from the server for ${Math.round((now - since) / 1000)} s`;
  }
  return null;
}

/**
 * The transport, from any screen. **Stable for the app's life**: every
 * function on it reads its inputs at call time, so an effect may depend on it
 * and run once. What the last run did is returned beside it, not on it — a
 * handle that changed after every completed run made every effect that
 * depended on it poke the next run, and the app synced itself in a loop
 * (measured 2026-09-21: five downloads in thirty seconds with nothing to say).
 */
export interface SyncHandle {
  /** Schedule a run; never blocks. */
  poke(trigger: string): void;
  /**
   * One run, waited for up to `WAIT_MS`. Resolves with the outcome, null when
   * sync is off, or `'late'` when the bound ran out first — the run goes on.
   * Also `'late'`, at once, when the server has just been found unreachable
   * (`noWaitReason`); the run is still started and goes on behind it.
   */
  wait(trigger: string): Promise<SyncOutcome | null | 'late'>;
  /** Prove an address and an account before the switch is allowed on. */
  check(url: string, username: string, password: string): Promise<{ ok: true; folderMissing: boolean } | { ok: false; reason: string }>;
}

/** What the platform supplies, replaceable by a test: the client for a folder, the clock, and the network. */
export interface SyncDeps {
  client(folder: SyncSettings, password: string): Pick<WebDAVClient, 'check' | 'download' | 'upload'>;
  now(): number;
  /**
   * Each change of the phone's network path, as the system reports it, until
   * the returned function is called (#304). Optional: without it a failure to
   * reach the server is forgotten only by a run that reaches it, or by time.
   */
  onConnectivity?(listener: (connected: boolean) => void): () => void;
}

const PLATFORM: SyncDeps = {
  client: ({ url, username }, password) => createWebDAVClient({ url, username, password }, { fetch: (input, init) => fetch(input, init) }),
  now: () => Date.now(),
  // `NWPathMonitor`, which the Downloads already listen to (`open-reader-offline`).
  // It says whether a path exists, not whether the server answers: a phone on a
  // Wi-Fi without internet reports connected, which is why it only clears.
  // Required at first use, so that loading this file loads no native module.
  onConnectivity: (listener) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { offlineNative } = require('../../modules/open-reader-offline') as typeof import('../../modules/open-reader-offline');
    const subscription = offlineNative?.addListener('connectivity', ({ connected }) => listener(connected));
    return () => subscription?.remove();
  },
};

/** What a run says when the folder has been named but the Keychain will not hand over the password. */
function passwordRefused(message: string): never {
  throw new WebDAVError('config', `The Keychain would not hand over the WebDAV password: ${message}`);
}

export function useSync(settings: AppSettings, library: Library, deps: SyncDeps = PLATFORM): { sync: SyncHandle; last: SyncOutcome | null } {
  const [last, setLast] = useState<SyncOutcome | null>(null);
  const settingsRef = useRef(settings);
  const libraryRef = useRef(library);
  const depsRef = useRef(deps);
  useEffect(() => {
    settingsRef.current = settings;
    libraryRef.current = library;
    depsRef.current = deps;
  }, [settings, library, deps]);

  /**
   * One transport for the app's life, made on the first poke rather than in
   * render: everything it is handed reads a ref at call time, and the first
   * call comes from an effect or a press, never from a render.
   */
  const transportRef = useRef<PositionsTransport | null>(null);
  const transport = useCallback((): PositionsTransport => {
    if (!transportRef.current) {
      transportRef.current = createPositionsTransport({
        enabled: () => settingsRef.current.sync.enabled,
        client: async (): Promise<SyncClient> => {
          debugLog('sync', `run against ${cutAddress(settingsRef.current.sync.url)}`);
          const lookup = await readSyncPassword();
          if (lookup.outcome === 'refused') passwordRefused(lookup.refusal.message);
          const password = lookup.outcome === 'found' ? lookup.secret : '';
          return depsRef.current.client(settingsRef.current.sync, password);
        },
        local: () => libraryRef.current.positionsItems(),
        adopt: (items) => libraryRef.current.adopt(items),
        now: () => depsRef.current.now(),
        // The status line says it; there is no second channel, and a sentence in
        // a box over the book would be the interruption design 0026 removed.
        report: () => {},
        onSynced: (outcome) => {
          debugLog(
            'sync',
            `${outcome.trigger}: ${outcome.result}${outcome.error ? ` (${outcome.error})` : ''}, ${outcome.remote} items in the file, ` +
              `${outcome.adopted.length} places taken, ${outcome.uploaded ? 'uploaded' : 'nothing uploaded'}` +
              (outcome.warning ? `; ${syncWarning(outcome)}` : ''),
          );
          setLast(outcome);
        },
      });
    }
    return transportRef.current;
  }, []);

  /**
   * The switch going on is a sync moment, and it is taken **here** and not on
   * the screen that flips it. A poke from the screen in the same tick as the
   * `setSettings` runs before the refs above have seen the new settings, so the
   * run reads `enabled` as false and skips — the folder stayed empty and the
   * status line blank (measured 2026-09-21). This effect is declared after the
   * ref-updating one, so by the time it runs the refs are current.
   */
  const enabled = settings.sync.enabled;
  const wasEnabledRef = useRef(enabled);
  useEffect(() => {
    const was = wasEnabledRef.current;
    wasEnabledRef.current = enabled;
    // An explicit retry after correcting the folder/password must not inherit
    // the old failure's backoff. Ordinary lifecycle pokes remain rate-limited.
    if (!was && enabled) void transport().flush('switch-on');
  }, [enabled, transport]);

  /**
   * The network path coming back clears a failure to reach the server, so the
   * first Play after it waits for its sync as usual (#304). Each change is in
   * the Debug Log, which on #304 could not say what the phone thought of its network.
   */
  useEffect(() => {
    let was: boolean | null = null;
    return depsRef.current.onConnectivity?.((connected) => {
      if (connected === was) return;
      was = connected;
      debugLog('sync', `network path ${connected ? 'available' : 'unavailable'}`);
      if (connected) transportRef.current?.reconnected();
    });
  }, []);

  const poke = useCallback((trigger: string) => transport().poke(trigger), [transport]);

  const wait = useCallback(
    async (trigger: string): Promise<SyncOutcome | null | 'late'> => {
      const runs = transport();
      const reason = noWaitReason(runs, depsRef.current.now());
      if (reason) {
        debugLog('sync', `${trigger}: not waited for, ${reason}`);
        void runs.flush(trigger);
        return 'late';
      }
      try {
        return await withTimeout(runs.flush(trigger), WAIT_MS, () => new Error('late'));
      } catch {
        return 'late';
      }
    },
    [transport],
  );

  const check = useCallback(async (url: string, username: string, password: string) => {
    // Typed and perhaps not yet saved, so the Keychain may not have handed it to
    // the Debug Log's guard: held as the WebDAV password's entry, which it is.
    forbidCredential(SYNC_PASSWORD_ENTRY_NAME, password);
    try {
      await depsRef.current.client({ url, username, enabled: false }, password).check();
      debugLog('sync', `check of ${cutAddress(url)}: the folder is there`);
      return { ok: true as const, folderMissing: false };
    } catch (problem) {
      if (problem instanceof WebDAVError && problem.kind === 'not-found') {
        debugLog('sync', `check of ${cutAddress(url)}: no folder yet, the first upload makes it`);
        return { ok: true as const, folderMissing: true };
      }
      const reason = problem instanceof Error ? problem.message : String(problem);
      debugLog('sync', `check of ${cutAddress(url)} failed: ${reason}`);
      return { ok: false as const, reason };
    }
  }, []);

  const sync = useMemo<SyncHandle>(() => ({ poke, wait, check }), [poke, wait, check]);
  return { sync, last };
}
