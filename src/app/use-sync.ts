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
 * **The bound on a wait.** Opening a book and pressing Play wait for a sync,
 * but for two seconds at most (`WAIT_MS`): a slow server must not turn Play
 * into a spinner. Past the bound the caller carries on from the local place and
 * the run finishes in the background; what it then adopts reaches the open book
 * through `adoptedAt`, or waits for the next open.
 *
 * And one thing about its shape: the handle is stable and the last outcome is
 * returned beside it, so that nothing depending on the handle runs again when a
 * run completes. `SyncHandle` says why.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { withTimeout } from '../core/timeout';
import { createPositionsTransport, type PositionsTransport, type SyncClient, type SyncOutcome } from '../core/sync/transport';
import { createWebDAVClient, WebDAVError, type WebDAVClient } from '../core/sync/webdav';
import { readSyncPassword } from '../keys/store';

import type { AppSettings, SyncSettings } from './settings';
import type { Library } from './use-library';

/** How long opening a book or pressing Play waits for a sync before carrying on. */
export const WAIT_MS = 2_000;

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
   */
  wait(trigger: string): Promise<SyncOutcome | null | 'late'>;
  /** Prove an address and an account before the switch is allowed on. */
  check(url: string, username: string, password: string): Promise<{ ok: true; folderMissing: boolean } | { ok: false; reason: string }>;
}

/** What the platform supplies, replaceable by a test: the client for a folder, and the clock. */
export interface SyncDeps {
  client(folder: SyncSettings, password: string): Pick<WebDAVClient, 'check' | 'download' | 'upload'>;
  now(): number;
}

const PLATFORM: SyncDeps = {
  client: ({ url, username }, password) => createWebDAVClient({ url, username, password }, { fetch: (input, init) => fetch(input, init) }),
  now: () => Date.now(),
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
        onSynced: (outcome) => setLast(outcome),
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
    if (!was && enabled) transport().poke('switch-on');
  }, [enabled, transport]);

  const poke = useCallback((trigger: string) => transport().poke(trigger), [transport]);

  const wait = useCallback(
    async (trigger: string): Promise<SyncOutcome | null | 'late'> => {
      try {
        return await withTimeout(transport().flush(trigger), WAIT_MS, () => new Error('late'));
      } catch {
        return 'late';
      }
    },
    [transport],
  );

  const check = useCallback(async (url: string, username: string, password: string) => {
    try {
      await depsRef.current.client({ url, username, enabled: false }, password).check();
      return { ok: true as const, folderMissing: false };
    } catch (problem) {
      if (problem instanceof WebDAVError && problem.kind === 'not-found') return { ok: true as const, folderMissing: true };
      return { ok: false as const, reason: problem instanceof Error ? problem.message : String(problem) };
    }
  }, []);

  const sync = useMemo<SyncHandle>(() => ({ poke, wait, check }), [poke, wait, check]);
  return { sync, last };
}
