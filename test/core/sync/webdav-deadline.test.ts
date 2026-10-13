import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebDAVClient } from '../../../src/core/sync/webdav';
import { createPositionsTransport } from '../../../src/core/sync/transport';

const cfg = { url: 'https://dav.example/or', username: '', password: '' };
const never = () => new Promise<string>(() => {});
const response = (text: () => Promise<string>) => ({ status: 200, ok: true, text }) as Response;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function setup(text: () => Promise<string>, headerDelay = 0) {
  let signal: AbortSignal | null | undefined;
  const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
    signal = init?.signal;
    if (headerDelay) await new Promise((resolve) => setTimeout(resolve, headerDelay));
    return response(text);
  });
  const client = createWebDAVClient(cfg, { fetch: fetchImpl, timeoutMs: 100 });
  return { client, fetchImpl, signal: () => signal };
}

describe('one WebDAV deadline, including the body (#168)', () => {
  it.each(['download', 'list'] as const)('%s terminates even if the body ignores abort', async (operation) => {
    const { client, signal } = setup(never);
    const pending = operation === 'download' ? client.download('positions.json') : client.list();
    const verdict = pending.then(() => 'resolved', (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(100);
    expect(await Promise.race([verdict, Promise.resolve('HUNG')])).toMatchObject({ kind: 'network' });
    expect(signal()?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not give the body a fresh timeout after slow headers', async () => {
    const { client } = setup(() => new Promise((resolve) => setTimeout(() => resolve('too late'), 30)), 80);
    const verdict = client.download('positions.json').then(() => 'resolved', (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(99);
    expect(await Promise.race([verdict, Promise.resolve('pending')])).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(await Promise.race([verdict, Promise.resolve('HUNG')])).toMatchObject({ kind: 'network' });
    await vi.advanceTimersByTimeAsync(10);
    expect(await verdict).toMatchObject({ kind: 'network' });
  });

  it.each(['download', 'list'] as const)('%s classifies a rejected body as a network failure', async (operation) => {
    const { client } = setup(async () => { throw new Error('body connection lost'); });
    await expect(operation === 'download' ? client.download('positions.json') : client.list())
      .rejects.toMatchObject({ kind: 'network', message: expect.stringContaining('body connection lost') });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns a body completed within the combined deadline and clears the timer', async () => {
    const { client } = setup(() => new Promise((resolve) => setTimeout(() => resolve('fresh file'), 20)), 60);
    const pending = client.download('positions.json');
    await vi.advanceTimersByTimeAsync(80);
    expect(await pending).toBe('fresh file');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a request still waiting for headers', async () => {
    const { client, signal } = setup(async () => 'late', 200);
    const verdict = client.download('positions.json').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(100);
    expect(await verdict).toMatchObject({ kind: 'network' });
    expect(signal()?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
  });

  it('releases the transport and lets a queued forced run read the next response', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(never))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const client = createWebDAVClient(cfg, { fetch: fetchImpl, timeoutMs: 100 });
    const onSynced = vi.fn();
    const upload = vi.spyOn(client, 'upload');
    const adopt = vi.fn(() => []);
    const transport = createPositionsTransport({
      enabled: () => true, client: async () => client, local: () => [], adopt,
      now: () => Date.now(), report: () => {}, onSynced,
    });
    const first = transport.flush('launch');
    await vi.advanceTimersByTimeAsync(0);
    const next = transport.flush('play');
    await vi.advanceTimersByTimeAsync(100);
    expect(await Promise.race([first, Promise.resolve('HUNG')])).toMatchObject({ result: 'error', uploaded: false });
    expect(await Promise.race([next, Promise.resolve('HUNG')])).toMatchObject({ result: 'ok', trigger: 'play' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onSynced).toHaveBeenCalledTimes(2);
    expect(adopt).toHaveBeenCalledTimes(1);
    expect(upload).not.toHaveBeenCalled();
    expect(transport.running()).toBe(false);
  });
});
