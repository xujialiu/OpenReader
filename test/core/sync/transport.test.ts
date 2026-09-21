import { describe, expect, it, vi } from 'vitest';

import { parsePositionsFile, serializePositionsFile, type PositionsItem } from '../../../src/core/sync/positions-file';
import { createPositionsTransport, SYNC_RETRY_MS, type SyncClient, type SyncOutcome } from '../../../src/core/sync/transport';
import { WebDAVError } from '../../../src/core/sync/webdav';

/**
 * Download, merge, adopt, conditional upload — the plugin's transport shape on
 * this side of the contract. The tests are about the four things that can go
 * wrong on a server the app does not control: no file yet, a broken file, a
 * file from the future, and a server that is down.
 */

const A = 'sha256:' + 'a'.repeat(64);
const B = 'sha256:' + 'b'.repeat(64);

const item = (id: string, at: number, device = 'phone'): PositionsItem => ({
  id,
  format: 'epub',
  publicationId: null,
  locator: 'epubcfi(/6/2!/4/4)',
  anchor: { exact: `sentence ${at}`, prefix: '', suffix: '' },
  stamp: { at, device },
});

/** A server holding one file, or none. */
function server(initial: string | null) {
  const state = { text: initial, uploads: [] as string[], downloads: 0 };
  const client: SyncClient = {
    async download() {
      state.downloads++;
      if (state.text === null) throw new WebDAVError('not-found', 'no file', 404);
      return state.text;
    },
    async upload(_name, text) {
      state.uploads.push(text);
      state.text = text;
    },
  };
  return { state, client };
}

function harness(remote: string | null, local: PositionsItem[] = [], options: { enabled?: boolean; client?: SyncClient } = {}) {
  const srv = server(remote);
  let now = 1_000_000;
  const adopted: PositionsItem[][] = [];
  const reports: string[] = [];
  const outcomes: SyncOutcome[] = [];
  const transport = createPositionsTransport({
    enabled: () => options.enabled ?? true,
    client: async () => options.client ?? srv.client,
    local: () => local,
    adopt: (items) => {
      adopted.push([...items]);
      return items.filter((one) => !local.some((mine) => mine.id === one.id && mine.stamp.at >= one.stamp.at)).map((one) => one.id);
    },
    now: () => now,
    report: (problem) => reports.push(problem),
    onSynced: (outcome) => outcomes.push(outcome),
  });
  return { transport, srv, adopted, reports, outcomes, advance: (ms: number) => { now += ms; } };
}

describe('a first sync against an empty folder', () => {
  it('uploads what this device holds and adopts nothing', async () => {
    const h = harness(null, [item(A, 5)]);
    const outcome = await h.transport.flush('launch');
    expect(outcome).toMatchObject({ result: 'ok', remote: 0, adopted: [], uploaded: true });
    expect(h.srv.state.uploads).toHaveLength(1);
    expect(parsePositionsFile(h.srv.state.uploads[0])).toMatchObject({ ok: true });
  });

  it('uploads nothing when it holds nothing', async () => {
    const h = harness(null, []);
    const outcome = await h.transport.flush('launch');
    expect(outcome).toMatchObject({ result: 'ok', uploaded: false });
    expect(h.srv.state.uploads).toHaveLength(0);
  });
});

describe('an ordinary sync', () => {
  it('adopts the newer remote item, keeps the newer local one, and uploads the union', async () => {
    const remote = serializePositionsFile([item(A, 9, 'desk'), item(B, 1, 'desk')]);
    const h = harness(remote, [item(A, 5), item(B, 2)]);
    const outcome = await h.transport.flush('open');
    expect(outcome).toMatchObject({ result: 'ok', remote: 2, adopted: [A], uploaded: true });
    const uploaded = parsePositionsFile(h.srv.state.uploads[0]);
    if (!uploaded.ok) throw new Error('bad upload');
    expect(uploaded.items.map((one) => one.stamp?.at)).toEqual([9, 2]);
  });

  it('does not upload when the merged text equals what came down', async () => {
    const remote = serializePositionsFile([item(A, 9, 'desk')]);
    const h = harness(remote, [item(A, 5)]);
    const outcome = await h.transport.flush('foreground');
    expect(outcome).toMatchObject({ result: 'ok', adopted: [A], uploaded: false });
    expect(h.srv.state.uploads).toHaveLength(0);
  });

  it('skips a run when sync is off, and flush answers null', async () => {
    const h = harness(null, [item(A, 5)], { enabled: false });
    expect(await h.transport.flush('launch')).toBeNull();
    expect(h.srv.state.downloads).toBe(0);
  });
});

describe('a file this build must not touch', () => {
  it('leaves a newer version alone: no adoption, no upload, said once', async () => {
    const remote = JSON.stringify({ format: 'xujialiu-positions', version: 2, items: [] });
    const h = harness(remote, [item(A, 5)]);
    const outcome = await h.transport.flush('launch');
    expect(outcome).toMatchObject({ result: 'frozen', uploaded: false, adopted: [] });
    expect(h.adopted).toHaveLength(0);
    expect(h.srv.state.uploads).toHaveLength(0);
    expect(h.reports).toHaveLength(1);
    expect(h.reports[0]).toMatch(/version 2/);
  });

  it('treats a malformed file as absent and replaces it', async () => {
    const h = harness('{not json', [item(A, 5)]);
    const outcome = await h.transport.flush('launch');
    expect(outcome).toMatchObject({ result: 'ok', uploaded: true, remote: 0 });
    expect(h.reports[0]).toMatch(/could not be read/);
    expect(parsePositionsFile(h.srv.state.text!)).toMatchObject({ ok: true });
  });
});

describe('a server that is down', () => {
  it('records the failure, reports once per window, and does not retry inside it unless forced', async () => {
    const down: SyncClient = {
      download: async () => { throw new WebDAVError('network', 'Cannot reach it'); },
      upload: async () => {},
    };
    const h = harness(null, [item(A, 5)], { client: down });
    const first = await h.transport.flush('launch');
    expect(first).toMatchObject({ result: 'error', error: 'Cannot reach it' });
    expect(h.reports).toEqual(['Cannot reach it']);

    // Inside the window a poke does nothing at all: no run, no second report.
    h.transport.poke('open');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.outcomes).toHaveLength(1);
    expect(h.reports).toHaveLength(1);

    // A flush is forced through and is still reported only once in the window.
    await h.transport.flush('play');
    expect(h.outcomes).toHaveLength(2);
    expect(h.reports).toHaveLength(1);

    h.advance(SYNC_RETRY_MS);
    h.transport.poke('foreground');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.outcomes).toHaveLength(3);
    expect(h.reports).toHaveLength(2);
  });

  it('turns an unusable address into an error rather than a hang', async () => {
    const h = harness(null, [item(A, 5)], {
      client: { download: async () => { throw new WebDAVError('config', 'Set the WebDAV URL first.'); }, upload: async () => {} },
    });
    const outcome = await h.transport.flush('launch');
    expect(outcome).toMatchObject({ result: 'error', error: 'Set the WebDAV URL first.' });
  });
});

describe('single flight', () => {
  it('folds a burst of pokes into one run and one trailing run', async () => {
    const downloads: (() => void)[] = [];
    const slow: SyncClient = {
      download: async () => { await new Promise<void>((resolve) => downloads.push(resolve)); throw new WebDAVError('not-found', 'no', 404); },
      upload: async () => {},
    };
    const spy = vi.fn(async () => slow);
    const transport = createPositionsTransport({
      enabled: () => true, client: spy, local: () => [item(A, 5)], adopt: () => [], now: () => 0, report: () => {},
    });
    const settle = async (until: () => boolean) => {
      for (let i = 0; i < 50 && !until(); i++) await new Promise((resolve) => setTimeout(resolve, 0));
      expect(until()).toBe(true);
    };
    transport.poke('a');
    transport.poke('b');
    transport.poke('c');
    expect(transport.running()).toBe(true);
    await settle(() => downloads.length === 1);
    downloads[0]();
    // The trailing run starts when the first ends, and it is one run for b and c.
    await settle(() => downloads.length === 2);
    downloads[1]();
    await settle(() => !transport.running());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(transport.last()?.trigger).toBe('c');
  });
});
