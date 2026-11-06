import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const directory = new URL('../manual-test/library-and-reader/', import.meta.url);
const source = readFileSync(new URL('lookup-fetch-gate-install.js', directory), 'utf8');
const url = 'https://api.dictionaryapi.dev/api/v2/entries/en/hope';
type RecordState = { state: string; startedAt: number; heldAt: number | null; releasedAt: number | null; abortedAt: number | null };
type Gate = { count: number; waiting: boolean; aborted: boolean; requests: RecordState[]; release(): number; restore(): void };
function setup() {
  const response = { ok: true };
  const original = vi.fn(async () => response);
  const runtime: { fetch: (input: string, init?: { signal: AbortSignal }) => Promise<typeof response>; __hopeGate?: Gate } = { fetch: original };
  runInNewContext(source, runtime);
  const gate = runtime.__hopeGate;
  if (!gate) throw new Error('Gate was not installed');
  return { response, original, runtime, gate };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('the pending-lookup diagnostic does not misdate aborts or pretend to release them (#346)', () => {
  it('calls the real fetch once, withholds delivery, then releases exactly that response', async () => {
    const { runtime, original, response, gate } = setup();
    const controller = new AbortController();
    let delivered = false;
    const pending = runtime.fetch(url, { signal: controller.signal }).then(value => { delivered = true; return value; });
    await flush();
    expect(original).toHaveBeenCalledTimes(1);
    expect(delivered).toBe(false);
    expect(gate).toMatchObject({ count: 1, waiting: true, aborted: false });
    expect(gate.requests[0]).toMatchObject({ state: 'held', heldAt: expect.any(Number), abortedAt: null });
    expect(gate.release()).toBe(1);
    expect(await pending).toBe(response);
    expect(gate.release()).toBe(0);
    // A later cleanup of the app's completed request is not a pending-fold abort.
    controller.abort();
    expect(gate.aborted).toBe(false);
    expect(gate.requests[0]).toMatchObject({ state: 'released', releasedAt: expect.any(Number), abortedAt: null });
    gate.restore();
    expect(runtime.fetch).toBe(original);
    expect(runtime.__hopeGate).toBeUndefined();
  });

  it('records a pending abort at its actual time and refuses to report it as released', async () => {
    const { runtime, gate } = setup();
    const controller = new AbortController();
    const pending = runtime.fetch(url, { signal: controller.signal });
    await flush();
    controller.abort();
    await expect(pending).rejects.toThrow('Aborted');
    expect(gate).toMatchObject({ waiting: false, aborted: true });
    expect(gate.requests[0]).toMatchObject({ state: 'aborted', abortedAt: expect.any(Number), releasedAt: null });
    expect(gate.release()).toBe(0);
    gate.restore();
  });

  it('passes other URLs through and restores a held response without leaking a pending promise', async () => {
    const { runtime, original, response, gate } = setup();
    expect(await runtime.fetch('https://api.dictionaryapi.dev/api/v2/entries/en/other')).toBe(response);
    expect(gate.count).toBe(0);
    const pending = runtime.fetch(url);
    await flush();
    gate.restore();
    expect(await pending).toBe(response);
    expect(runtime.fetch).toBe(original);
    expect(original).toHaveBeenCalledTimes(2);
  });
});
