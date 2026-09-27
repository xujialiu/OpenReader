import { expect, it, vi } from 'vitest';
import { continuedShown, createContinuedProcessing, type ContinuedNative, type ContinuedShown } from '../../src/offline/continued-processing';
import type { DownloadTask, NarrationPlan } from '../../src/offline/model';

/**
 * ADR 0052: what the phone shows for a download away from the screen, and when
 * the continued processing task is submitted, reported and finished. The rules
 * are a pure module with the native side doubled; `runtime-continued.test.ts`
 * checks the runtime's wiring of them.
 */
const voice = { provider: 'fish' as const, voice: 'A', label: 'A' };
const download = (over: Partial<DownloadTask> = {}): DownloadTask => ({
  id: 't', document: 'book', voice, chapters: ['a', 'b', 'c'], state: 'downloading', error: null, failed: [], ...over,
});
const plan: NarrationPlan = {
  version: 2,
  chapters: [
    { id: 'a', title: 'One', depth: 0, parent: null, texts: [], textCount: 10 },
    { id: 'b', title: 'Two', depth: 0, parent: null, texts: [], textCount: 40 },
    { id: 'c', title: 'Three', depth: 0, parent: null, texts: [], prepared: false },
  ],
};

it('counts the chapters of the download that are saved, and moves within the chapter being written', () => {
  const shown = continuedShown(download({ current: 'b' }), 'My Vampire System', [
    { id: 'a', count: 10, complete: true },
    { id: 'b', count: 10, complete: false },
    { id: 'c', count: 0, complete: false },
  ], plan);
  expect(shown).toEqual({ title: 'My Vampire System', subtitle: '1 of 3 chapters', completed: 1250, total: 3000 });
});

it('counts a chapter whose text is not yet prepared as nothing written', () => {
  expect(continuedShown(download({ current: 'c' }), 'Book', [{ id: 'a', count: 10, complete: true }], plan))
    .toMatchObject({ subtitle: '1 of 3 chapters', completed: 1000 });
});

it('says chapter, not chapters, of a download of one', () => {
  expect(continuedShown(download({ chapters: ['a'] }), 'Book', [], plan).subtitle).toBe('0 of 1 chapter');
});

it('counts only the chapters in the download, whatever else of the document is saved', () => {
  expect(continuedShown(download({ chapters: ['b'] }), 'Book', [{ id: 'a', count: 10, complete: true }], plan))
    .toMatchObject({ subtitle: '0 of 1 chapter', completed: 0, total: 1000 });
});

function harness(tasks: DownloadTask[], { submit = async () => true, update = async () => {} }: {
  submit?: () => Promise<boolean>; update?: () => Promise<void>;
} = {}) {
  const calls: string[] = [];
  const native: ContinuedNative = {
    submitContinued: vi.fn(async (title: string, subtitle: string) => { calls.push(`submit ${title} · ${subtitle}`); return submit(); }),
    updateContinued: vi.fn(async (title: string, subtitle: string) => { calls.push(`update ${title} · ${subtitle}`); await update(); }),
    finishContinued: vi.fn(async (success: boolean) => { calls.push(`finish ${success}`); }),
  };
  // The state stands in for the count, so each call says which moment it showed.
  const shown = async (task: DownloadTask): Promise<ContinuedShown> =>
    ({ title: task.document, subtitle: `${task.state}`, completed: 0, total: 1000 });
  const continued = createContinuedProcessing({ native, tasks: () => tasks, shown });
  return { continued, native, calls };
}

it('submits once for downloads that go on, and afterwards only reports', async () => {
  const tasks = [download({ state: 'queued' })];
  const { continued, calls } = harness(tasks);
  expect(await continued.start()).toBe(true);
  expect(continued.holding()).toBe(true);
  tasks[0].state = 'downloading';
  expect(await continued.start()).toBe(true);
  await vi.waitFor(() => expect(calls).toEqual(['submit book · queued', 'update book · downloading']));
});

it('submits nothing when no download goes on by itself', async () => {
  const { continued, native } = harness([download({ state: 'paused' })]);
  expect(await continued.start()).toBe(false);
  expect(native.submitContinued).not.toHaveBeenCalled();
  expect(continued.holding()).toBe(false);
});

it('holds nothing when the phone refuses the task', async () => {
  const { continued } = harness([download()], { submit: async () => false });
  expect(await continued.start()).toBe(false);
  expect(continued.holding()).toBe(false);
});

it('shows the download being written, not the first one waiting its turn', async () => {
  const tasks = [download({ id: 'x', document: 'first', state: 'queued' }), download({ id: 'y', document: 'second', state: 'downloading' })];
  const { continued, calls } = harness(tasks);
  await continued.start();
  expect(calls).toEqual(['submit second · downloading']);
});

it('finishes once nothing goes on, after showing where the download ended, and succeeds when it is done', async () => {
  const tasks = [download()];
  const { continued, calls } = harness(tasks);
  await continued.start();
  tasks[0].state = 'done';
  continued.follow();
  await vi.waitFor(() => expect(calls).toEqual(['submit book · downloading', 'update book · done', 'finish true']));
  expect(continued.holding()).toBe(false);
});

it('finishes unsuccessfully when a download stopped by itself', async () => {
  const tasks = [download()];
  const { continued, calls } = harness(tasks);
  await continued.start();
  tasks[0].state = 'blocked';
  continued.follow();
  await vi.waitFor(() => expect(calls.at(-1)).toBe('finish false'));
});

it('counts a download the owner paused as a success', async () => {
  const tasks = [download()];
  const { continued, calls } = harness(tasks);
  await continued.start();
  tasks[0].state = 'paused';
  continued.follow();
  await vi.waitFor(() => expect(calls.at(-1)).toBe('finish true'));
});

it('reports nothing more once the phone has ended the task, and a later start submits again', async () => {
  const tasks = [download()];
  const { continued, native, calls } = harness(tasks);
  await continued.start();
  continued.expired();
  expect(continued.holding()).toBe(false);
  continued.follow();
  await Promise.resolve();
  expect(native.updateContinued).not.toHaveBeenCalled();
  expect(native.finishContinued).not.toHaveBeenCalled();
  await continued.start();
  expect(calls).toEqual(['submit book · downloading', 'submit book · downloading']);
});

it('submits after the finish it follows, never between its last update and its finish', async () => {
  const tasks = [download()];
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let first = true;
  const { continued, calls } = harness(tasks, { update: () => (first ? ((first = false), held) : Promise.resolve()) });
  await continued.start();
  tasks[0].state = 'paused';
  continued.follow();
  await vi.waitFor(() => expect(calls).toContain('update book · paused'));
  // Resumed while the finish is on its way out.
  tasks[0].state = 'queued';
  const again = continued.start();
  release();
  expect(await again).toBe(true);
  expect(calls).toEqual(['submit book · downloading', 'update book · paused', 'finish true', 'submit book · queued']);
  expect(continued.holding()).toBe(true);
});

it('finishes a task whose downloads ended while it was being submitted', async () => {
  const tasks = [download()];
  const { continued, calls } = harness(tasks, {
    submit: async () => {
      tasks[0].state = 'done';
      continued.follow();
      return true;
    },
  });
  expect(await continued.start()).toBe(true);
  await vi.waitFor(() => expect(calls).toEqual(['submit book · downloading', 'update book · done', 'finish true']));
});

it('coalesces reports asked for while one is waiting its turn', async () => {
  const tasks = [download()];
  const { continued, native } = harness(tasks);
  await continued.start();
  continued.follow();
  continued.follow();
  continued.follow();
  await vi.waitFor(() => expect(native.updateContinued).toHaveBeenCalledTimes(1));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(native.updateContinued).toHaveBeenCalledTimes(1);
});
