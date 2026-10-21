import { createElement, useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import type { PositionsItem } from '../../src/core/sync/positions-file';
import { createWebDAVClient, WebDAVError } from '../../src/core/sync/webdav';
import { createDebugLog, setDebugLogWriter } from '../../src/debug/debug-log';
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';
import type { Library } from '../../src/app/use-library';
import { useSync, type SyncDeps, type SyncHandle } from '../../src/app/use-sync';

/**
 * The two defects the simulator found on 2026-09-21, as the real hook mounted
 * with a null component (the shape of `voice-lifetime.test.ts`): a switch that
 * never ran its first sync, and a sync that ran itself in a loop. Both were
 * about **when** a run happens, which nothing below the hook can see.
 */

vi.mock('../../src/keys/store', () => ({ readSyncPassword: async () => ({ outcome: 'absent' }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/** A folder with no file in it, counting every time a run reaches it. */
function folder() {
  const counts = { clients: 0, downloads: 0, checks: 0 };
  const deps: SyncDeps = {
    client: () => {
      counts.clients++;
      return {
        check: async () => { counts.checks++; },
        download: async () => { counts.downloads++; throw new WebDAVError('not-found', 'no file', 404); },
        upload: async () => {},
      };
    },
    now: () => 1_000,
  };
  return { counts, deps };
}

const library = { positionsItems: (): PositionsItem[] => [], adopt: () => [] } as unknown as Library;

const settingsWith = (enabled: boolean): AppSettings => ({ ...DEFAULT_SETTINGS, sync: { url: 'https://dav.example/or', username: 'ann', enabled } });

/** Let every queued microtask and macrotask of a run finish, inside act so the state it sets is drawn. */
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });

describe('turning the switch on runs the first sync (defect 1)', () => {
  it('pokes once the enabled settings are in force, from the hook and not from the screen', async () => {
    const { counts, deps } = folder();
    let handle: { sync: SyncHandle; last: unknown } | undefined;
    function Probe({ settings }: { settings: AppSettings }) { handle = useSync(settings, library, deps); return null; }
    let tree: ReactTestRenderer;
    await act(async () => { tree = create(createElement(Probe, { settings: settingsWith(false) })); });
    await settle();
    // Off: nothing has reached the folder.
    expect(counts.clients).toBe(0);

    await act(async () => { tree.update(createElement(Probe, { settings: settingsWith(true) })); });
    await settle();
    // On: exactly one run, which saw `enabled` as true and went to the folder.
    expect(counts.clients).toBe(1);
    expect(counts.downloads).toBe(1);
    expect(handle!.last).toMatchObject({ trigger: 'switch-on', result: 'ok' });

    // Staying on is not a moment; a re-render with the same switch pokes nothing.
    await act(async () => { tree.update(createElement(Probe, { settings: settingsWith(true) })); });
    await settle();
    expect(counts.clients).toBe(1);
    await act(async () => { tree.unmount(); });
  });
});

describe('switch-on after a failed sync (#177)', () => {
  it.each([25_000, 61_000])('syncs after correction %i ms after failure, without lifting ordinary backoff', async (elapsed) => {
    let clock = 1_000_000;
    let corrected = false;
    const downloads: boolean[] = [];
    const deps: SyncDeps = {
      client: () => ({
        check: async () => {},
        download: async () => {
          downloads.push(corrected);
          if (!corrected) throw new WebDAVError('auth', 'Rejected credentials', 401);
          throw new WebDAVError('not-found', 'no file', 404);
        },
        upload: async () => {},
      }),
      now: () => clock,
    };
    let handle: ReturnType<typeof useSync> | undefined;
    function Probe({ settings }: { settings: AppSettings }) { handle = useSync(settings, library, deps); return null; }
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(createElement(Probe, { settings: settingsWith(true) })); });
    try {
      await act(async () => { await handle!.sync.wait('play'); });
      expect(handle!.last).toMatchObject({ result: 'error' });
      clock += 25_000;
      corrected = true;
      await act(async () => { handle!.sync.poke('foreground'); });
      await settle();
      expect(downloads).toEqual([false]);
      expect(handle!.last).toMatchObject({ result: 'error' });

      clock += elapsed - 25_000;
      await act(async () => { tree.update(createElement(Probe, { settings: settingsWith(false) })); });
      expect(await handle!.sync.check('https://dav.example/or', 'ann', 'corrected')).toEqual({ ok: true, folderMissing: false });
      await act(async () => { tree.update(createElement(Probe, { settings: settingsWith(true) })); });
      await settle();
      expect(downloads).toEqual([false, true]);
      expect(handle!.last).toMatchObject({ trigger: 'switch-on', result: 'ok' });
      await act(async () => { tree.update(createElement(Probe, { settings: settingsWith(true) })); });
      await settle();
      expect(downloads).toEqual([false, true]);
    } finally {
      await act(async () => { tree.unmount(); });
    }
  });
});

describe('a completed run never pokes the next one (defect 2)', () => {
  it('keeps the handle stable across completed runs, so an effect depending on it runs once', async () => {
    const { counts, deps } = folder();
    const handles: SyncHandle[] = [];
    function Probe() {
      const { sync } = useSync(settingsWith(true), library, deps);
      handles.push(sync);
      // The shell's launch effect, exactly: depends on the handle and pokes.
      useEffect(() => { sync.poke('launch'); }, [sync]);
      return null;
    }
    let tree: ReactTestRenderer;
    await act(async () => { tree = create(createElement(Probe)); });
    await settle();
    await settle();
    await settle();
    // One trigger, one run — however many times the outcome re-rendered the hook.
    expect(counts.downloads).toBe(1);
    expect(handles.length).toBeGreaterThan(1);
    expect(new Set(handles).size).toBe(1);
    await act(async () => { tree.unmount(); });
  });

  it('returns the last outcome beside the handle, not on it', async () => {
    const { deps } = folder();
    let result: ReturnType<typeof useSync> | undefined;
    function Probe() { result = useSync(settingsWith(true), library, deps); return null; }
    let tree: ReactTestRenderer;
    await act(async () => { tree = create(createElement(Probe)); });
    // Mounted with the switch already on is not the edge: the shell's launch poke covers that.
    await settle();
    expect(result!.last).toBeNull();
    await act(async () => { result!.sync.poke('launch'); });
    await settle();
    expect(Object.keys(result!.sync).sort()).toEqual(['check', 'poke', 'wait']);
    expect(result!.last).toMatchObject({ trigger: 'launch', result: 'ok' });
    await act(async () => { tree.unmount(); });
  });
});

describe('check', () => {
  it('passes on a missing folder and fails on anything else, in the server\'s words', async () => {
    const missing: SyncDeps = {
      client: () => ({ check: async () => { throw new WebDAVError('not-found', 'no folder', 404); }, download: async () => '', upload: async () => {} }),
      now: () => 0,
    };
    const refused: SyncDeps = {
      client: () => ({ check: async () => { throw new WebDAVError('auth', 'The server rejected the username or password (HTTP 401).', 401); }, download: async () => '', upload: async () => {} }),
      now: () => 0,
    };
    let handle: SyncHandle | undefined;
    function Probe({ deps }: { deps: SyncDeps }) { handle = useSync(settingsWith(false), library, deps).sync; return null; }
    let tree: ReactTestRenderer;
    await act(async () => { tree = create(createElement(Probe, { deps: missing })); });
    expect(await handle!.check('https://dav.example/or', 'ann', 'pw')).toEqual({ ok: true, folderMissing: true });
    await act(async () => { tree.update(createElement(Probe, { deps: refused })); });
    expect(await handle!.check('https://dav.example/or', 'ann', 'pw')).toEqual({ ok: false, reason: 'The server rejected the username or password (HTTP 401).' });
    await act(async () => { tree.unmount(); });
  });

  it('of an address typed with a password that has "@" in it writes no part of the password to the Debug Log, though the WebDAV error quotes the address whole (#314)', async () => {
    // The real WebDAV client, failing as a phone with no route to the server does.
    const unreachable: SyncDeps = {
      client: ({ url, username }, password) =>
        createWebDAVClient({ url, username, password }, { fetch: async () => { throw new TypeError('Network request failed'); } }),
      now: () => 0,
    };
    const written: string[] = [];
    const log = createDebugLog({ files: { list: () => [], size: () => 0, append: (_name, text) => void written.push(text), remove: () => {} }, now: () => 0 });
    let handle: SyncHandle | undefined;
    function Probe() { handle = useSync(settingsWith(false), library, unreachable).sync; return null; }
    let tree: ReactTestRenderer;
    await act(async () => { tree = create(createElement(Probe)); });
    setDebugLogWriter(log);
    try {
      for (const [password, tail] of [['p@ssw0rd', 'ssw0rd'], ['p@ss@w0rd', 'w0rd']]) {
        const url = `https://alice:${password}@dav.example.com/dav`;
        const result = await handle!.check(url, '', '');
        // The Sync screen shows the owner the address he typed, password and all.
        expect(result).toEqual({ ok: false, reason: `Cannot reach ${url}/: Network request failed` });
        log.flush();
        const line = written.join('');
        expect(line).toContain('check of https://dav.example.com/dav failed: Cannot reach https://[credential]@dav.example.com/dav/: Network request failed');
        expect(line).not.toContain(tail);
        written.length = 0;
      }
    } finally {
      setDebugLogWriter(null);
      await act(async () => { tree!.unmount(); });
    }
  });
});
