import { describe, expect, it, vi } from 'vitest';
import { createScheduler } from '../../src/offline/scheduler';
import type { DownloadTask, NarrationPlan } from '../../src/offline/model';
import { SynthesisError } from '../../src/core/providers/errors';

function fixture() {
  const plan: NarrationPlan = { version: 1, chapters: [
    { id: 'a', title: 'A', depth: 0, parent: null, texts: ['One.', 'Two.'] },
    { id: 'b', title: 'B', depth: 0, parent: null, texts: ['Three.'] },
  ] };
  const tasks: DownloadTask[] = [{ id: '1', document: 'book', voice: { provider: 'fish', voice: 'A', label: 'A' },
    chapters: ['a', 'b'], state: 'queued', error: null, failed: [] }];
  const stored = new Set<string>();
  const fetch = vi.fn(async (_task: DownloadTask, text: string) => { stored.add(text); });
  const env = { online: true, allowed: true };
  const scheduler = createScheduler({ tasks: () => tasks, plan: () => plan, changed: vi.fn(),
    connected: () => env.online, allowed: () => env.allowed, exists: (_, text) => stored.has(text),
    fetch, wait: async () => {} });
  return { tasks, stored, fetch, env, scheduler };
}
describe('durable download scheduling', () => {
  it('reuses completed audio, in order, without overlapping workers', async () => {
    const f = fixture(); f.stored.add('One.');
    await Promise.all([f.scheduler.run(), f.scheduler.run()]);
    expect(f.fetch.mock.calls.map((c) => c[1])).toEqual(['Two.', 'Three.']);
    expect(f.tasks[0].state).toBe('done');
  });
  it('does not undo manual pause after an in-flight request settles', async () => {
    const f = fixture();
    f.fetch.mockImplementationOnce(async () => { f.tasks[0].state = 'paused'; });
    await f.scheduler.run();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.tasks[0].state).toBe('paused');
  });
  it('stops requesting on network loss and preserves the unfinished task', async () => {
    const f = fixture();
    f.fetch.mockImplementationOnce(async () => { f.env.online = false; throw new SynthesisError('network'); });
    await f.scheduler.run();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.tasks[0].state).toBe('waiting');
    expect(f.tasks[0].failed).toEqual([]);
  });
  it('bounds transient retries then continues later chapters without false whole completion', async () => {
    const f = fixture();
    f.fetch.mockImplementation(async (_, text) => { if (text === 'One.') throw new SynthesisError('network'); f.stored.add(text); });
    await f.scheduler.run();
    expect(f.fetch.mock.calls.map((c) => c[1])).toEqual(['One.', 'One.', 'One.', 'Three.']);
    expect(f.tasks[0].failed).toEqual(['a']);
    expect(f.stored.has('Two.')).toBe(false);
  });
  it.each(['auth', 'quota', 'no-key'] as const)('pauses all remaining requests on %s', async (kind) => {
    const f = fixture(); f.fetch.mockRejectedValue(new SynthesisError(kind));
    await f.scheduler.run();
    expect(f.tasks[0].state).toBe('blocked'); expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('does not resurrect a removed task', async () => {
    const f = fixture(); f.fetch.mockImplementationOnce(async () => { f.tasks.splice(0); });
    await f.scheduler.run(); expect(f.tasks).toEqual([]); expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('yields to playback/background expiration and can resume without repeating saved audio', async () => {
    const f = fixture(); f.fetch.mockImplementationOnce(async (_, text) => { f.stored.add(text); f.env.allowed = false; });
    await f.scheduler.run(); expect(f.tasks[0].state).toBe('interrupted');
    f.env.allowed = true; f.tasks[0].state = 'queued'; await f.scheduler.run();
    expect(f.fetch.mock.calls.map((c) => c[1])).toEqual(['One.', 'Two.', 'Three.']);
  });
  it('skips a paused book and proceeds to the next queued book with its own voice', async () => {
    const f = fixture(); const first = f.tasks[0]; first.state = 'paused';
    f.tasks.push({ ...first, id: '2', document: 'second', state: 'queued', voice: { ...first.voice, voice: 'B' } });
    await f.scheduler.run(); expect(first.state).toBe('paused');
    expect(f.fetch.mock.calls.every(([task]) => task.voice.voice === 'B')).toBe(true);
  });
});
