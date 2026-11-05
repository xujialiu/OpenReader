import { describe, expect, it, vi } from 'vitest';
import { SynthesisError } from '../../src/core/providers/errors';
import type { DownloadTask, NarrationPlan } from '../../src/offline/model';
import { createScheduler, type SchedulerDeps } from '../../src/offline/scheduler';

function fixture(over: Partial<SchedulerDeps> = {}) {
  const task: DownloadTask = { id: 't', document: 'book', voice: { provider: 'fish', voice: 'v', label: 'V' }, chapters: ['one'], state: 'queued', error: null, failed: [] };
  const tasks = [task];
  const plan: NarrationPlan = { version: 2, chapters: [{ id: 'one', title: 'One', depth: 0, parent: null, texts: ['One.'], prepared: true }] };
  const saved = new Set<string>();
  const fetch = vi.fn(async (_task: DownloadTask, text: string) => { saved.add(text); });
  const changed = vi.fn(async () => {});
  const completed = vi.fn(async () => new Set(saved.has('One.') ? ['one'] : []));
  const deps: SchedulerDeps = { tasks: () => tasks, plan: () => plan, changed, completed,
    connected: () => true, allowed: () => true, exists: (_, text) => saved.has(text), fetch, wait: async () => {}, ...over };
  return { task, tasks, plan, saved, fetch, changed, completed, deps, scheduler: createScheduler(deps) };
}

describe('a store failure cannot leave a Download running without a pass (#253)', () => {
  it.each(['initial plan', 'completed chapters', 'window plan'] as const)('blocks and explicitly resumes after a failed %s read', async (where) => {
    const f = fixture();
    const plan = vi.fn(async () => f.plan);
    f.deps.plan = plan;
    if (where === 'initial plan') plan.mockRejectedValueOnce(new Error('Read failed'));
    if (where === 'window plan') plan.mockResolvedValueOnce(f.plan).mockRejectedValueOnce(new Error('Read failed'));
    if (where === 'completed chapters') f.completed.mockRejectedValueOnce(new Error('Read failed'));
    await expect(f.scheduler.run()).resolves.toBeUndefined();
    expect(f.task).toMatchObject({ state: 'blocked', error: 'Read failed', writing: [] });
    expect(f.fetch).not.toHaveBeenCalled();
    // A lifecycle kick does not secretly spend after a storage failure.
    await f.scheduler.run();
    expect(f.fetch).not.toHaveBeenCalled();
    f.task.state = 'queued'; // explicit Resume
    await f.scheduler.run();
    expect(f.task).toMatchObject({ state: 'done', error: null, writing: [] });
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not resurrect a task removed during a failing read', async () => {
    const f = fixture();
    f.completed.mockImplementationOnce(async () => { f.tasks.length = 0; throw new Error('Read failed'); });
    await expect(f.scheduler.run()).resolves.toBeUndefined();
    expect(f.tasks).toEqual([]);
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('preserves a manual pause made during a failing read', async () => {
    const f = fixture();
    f.completed.mockImplementationOnce(async () => { f.task.state = 'paused'; throw new Error('Read failed'); });
    await expect(f.scheduler.run()).resolves.toBeUndefined();
    expect(f.task.state).toBe('paused');
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('clears writing even when the initial state save fails', async () => {
    const f = fixture();
    f.changed.mockRejectedValueOnce(new Error('Write failed'));
    await expect(f.scheduler.run()).resolves.toBeUndefined();
    expect(f.task).toMatchObject({ state: 'blocked', error: 'Write failed', writing: [] });
  });
});

it('finishes a manually paused selection completed by the last outstanding request (#171)', async () => {
  const f = fixture();
  f.fetch.mockImplementationOnce(async (_task, text) => {
    f.task.state = 'paused';
    f.task.paused = ['one'];
    f.saved.add(text);
  });
  await f.scheduler.run();
  expect(f.task).toMatchObject({ state: 'done', paused: [], error: null, writing: [] });
});

it('drains outstanding replies even if recording another chapter failure cannot be saved (#253)', async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const f = fixture({ concurrency: () => 2 });
  f.task.chapters.push('two');
  f.plan.chapters.push({ id: 'two', title: 'Two', depth: 0, parent: null, texts: ['Two.'], prepared: true });
  f.fetch.mockImplementation(async (_task, text) => {
    if (text === 'One.') {
      await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(2));
      throw new SynthesisError('unknown', 'Refused');
    }
    await held;
    f.saved.add(text);
  });
  f.changed.mockImplementation(async () => { if (f.task.failed.length) throw new Error('Write failed'); });
  let ended = false;
  const pass = f.scheduler.run().catch((error: unknown) => error).finally(() => { ended = true; });
  await vi.waitFor(() => expect(f.task.failed).toEqual(['one']));
  // Let the failed save propagate; the other reply still owns this pass.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const endedBeforeReply = ended;
  release();
  await pass;
  expect(endedBeforeReply).toBe(false);
  expect(f.saved.has('Two.')).toBe(true);
  expect(f.task).toMatchObject({ state: 'blocked', writing: [] });
});

it('waits for other in-flight replies before leaving a pass whose state save fails (#253)', async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const f = fixture({ concurrency: () => 2 });
  f.plan.chapters[0].texts.push('Two.');
  f.fetch.mockImplementation(async (_task, text) => {
    if (text === 'Two.') await held;
    f.saved.add(text);
  });
  f.changed.mockImplementation(async () => {
    if (f.saved.has('One.') && !f.saved.has('Two.')) throw new Error('Write failed');
  });
  let ended = false;
  const pass = f.scheduler.run().finally(() => { ended = true; });
  await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(2));
  expect(ended).toBe(false);
  release();
  await pass;
  expect(f.saved.has('Two.')).toBe(true);
  expect(f.task.state).toBe('blocked');
  expect(f.task.writing).toEqual([]);
});
