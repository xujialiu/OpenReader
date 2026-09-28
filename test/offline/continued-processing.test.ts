import { expect, it, vi } from 'vitest';
import { continuedShown, createContinuedProcessing, type ContinuedNative, type ContinuedShown } from '../../src/offline/continued-processing';
import type { DownloadTask, NarrationPlan } from '../../src/offline/model';

/**
 * ADR 0053: what the phone shows for a download away from the screen, and when
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

/** Chapters a to f, each of ten texts, prepared. */
const six: NarrationPlan = {
  version: 2,
  chapters: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, title: id, depth: 0, parent: null, texts: [], textCount: 10 })),
};

it('leaves out the chapters the owner paused while the download goes on, unless they are complete, and keeps failed ones', () => {
  // It read `49 of 188 chapters` with 140 paused (#77).
  const task = download({ chapters: ['a', 'b', 'c', 'd', 'e', 'f'], paused: ['b', 'c'], failed: ['e'], current: 'd' });
  const shown = continuedShown(task, 'Book', [
    { id: 'a', count: 10, complete: true },
    { id: 'b', count: 10, complete: true },
    { id: 'c', count: 3, complete: false },
    { id: 'd', count: 5, complete: false },
    { id: 'e', count: 0, complete: false },
  ], six);
  // a and b are complete, b although paused; c is paused and left out; d, e (failed) and f are still counted.
  expect(shown).toEqual({ title: 'Book', subtitle: '2 of 5 chapters', completed: 2500, total: 5000 });
});

it('moves the bar for no paused chapter, even the one the writer is leaving', () => {
  const task = download({ chapters: ['a', 'b', 'c'], paused: ['b'], current: 'b' });
  expect(continuedShown(task, 'Book', [{ id: 'b', count: 5, complete: false }], six))
    .toEqual({ title: 'Book', subtitle: '0 of 2 chapters', completed: 0, total: 2000 });
});

it.each([
  ['Pause all', { state: 'paused' as const, paused: ['a', 'b', 'c', 'd'] }],
  ['the ring that paused the last chapter going on', { state: 'paused' as const, paused: ['c', 'd'] }],
])('counts the whole download again once it is paused as a whole, by %s, so the last report is never a full count', (_, over) => {
  const task = download({ chapters: ['a', 'b', 'c', 'd'], ...over });
  expect(continuedShown(task, 'Book', [
    { id: 'a', count: 10, complete: true },
    { id: 'b', count: 10, complete: true },
  ], six)).toEqual({ title: 'Book', subtitle: '2 of 4 chapters', completed: 2000, total: 4000 });
});

function harness(tasks: DownloadTask[], { submit = async () => true, update = async () => {}, read = async () => {} }: {
  submit?: () => Promise<boolean>; update?: () => Promise<void>;
  /** Stands for the catalogue read behind what the phone shows. */
  read?: () => Promise<void>;
} = {}) {
  const calls: string[] = [];
  /** Whether the app is in the foreground, as the runtime tells it. */
  const app = { foreground: true };
  const native: ContinuedNative = {
    submitContinued: vi.fn(async (title: string, subtitle: string) => { calls.push(`submit ${title} · ${subtitle}`); return submit(); }),
    updateContinued: vi.fn(async (title: string, subtitle: string) => { calls.push(`update ${title} · ${subtitle}`); await update(); }),
    finishContinued: vi.fn(async (success: boolean) => { calls.push(`finish ${success}`); }),
  };
  // The state stands in for the count, so each call says which moment it showed.
  const shown = async (task: DownloadTask): Promise<ContinuedShown> => {
    await read();
    return { title: task.document, subtitle: `${task.state}`, completed: 0, total: 1000 };
  };
  const continued = createContinuedProcessing({ native, tasks: () => tasks, shown, foreground: () => app.foreground });
  return { continued, native, calls, app };
}

it('submits once for downloads that go on, and afterwards only reports', async () => {
  const tasks = [download({ state: 'queued' })];
  const { continued, calls } = harness(tasks);
  expect(await continued.start()).toBe(true);
  expect(continued.running()).toBe(true);
  tasks[0].state = 'downloading';
  expect(await continued.start()).toBe(true);
  await vi.waitFor(() => expect(calls).toEqual(['submit book · queued', 'update book · downloading']));
});

it('submits nothing when no download goes on by itself', async () => {
  const { continued, native } = harness([download({ state: 'paused' })]);
  expect(await continued.start()).toBe(false);
  expect(native.submitContinued).not.toHaveBeenCalled();
  expect(continued.running()).toBe(false);
});

it('holds nothing when the phone refuses the task', async () => {
  const { continued } = harness([download()], { submit: async () => false });
  expect(await continued.start()).toBe(false);
  expect(continued.running()).toBe(false);
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
  expect(continued.running()).toBe(false);
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

it('judges its success by the downloads it covered, not by one elsewhere that stopped before it', async () => {
  // The owner's iPhone, 2026-09-28 19:26:52: Pause all finished the task with success 0, for an old
  // download of another Document that sat `blocked` (#77).
  const tasks = [download(), download({ id: 'old', document: 'other', state: 'blocked', error: 'The key was refused.' })];
  const { continued, calls } = harness(tasks);
  await continued.start();
  tasks[0].state = 'paused';
  continued.follow();
  await vi.waitFor(() => expect(calls.at(-1)).toBe('finish true'));
});

it('covers a download that starts going on while it runs, and judges it too', async () => {
  const tasks = [download(), download({ id: 'later', document: 'other', state: 'blocked' })];
  const { continued, calls } = harness(tasks);
  await continued.start();
  // Resumed while the task runs.
  tasks[1].state = 'queued';
  continued.follow();
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  tasks[0].state = 'done';
  tasks[1].state = 'blocked';
  continued.follow();
  await vi.waitFor(() => expect(calls.at(-1)).toBe('finish false'));
});

it('names, as the phone ends it, the downloads it covered that still go on by themselves, and leaves the others', async () => {
  const tasks = [
    download({ id: 'w', state: 'downloading' }),
    download({ id: 'q', document: 'second', state: 'queued' }),
    download({ id: 'n', document: 'third', state: 'waiting' }),
    download({ id: 'b', document: 'old', state: 'blocked' }),
    download({ id: 'p', document: 'fifth', state: 'paused' }),
  ];
  const { continued } = harness(tasks);
  await continued.start();
  // Covered, but done before the end.
  tasks[1].state = 'done';
  continued.follow();
  expect(continued.expired().map((task) => task.id)).toEqual(['w', 'n']);
  expect(continued.running()).toBe(false);
});

it('names nothing when the phone ends a task it never ran', () => {
  const { continued } = harness([download()]);
  expect(continued.expired()).toEqual([]);
});

it('reports nothing more once the phone has ended the task, and a later start submits again', async () => {
  const tasks = [download()];
  const { continued, native, calls } = harness(tasks);
  await continued.start();
  continued.expired();
  expect(continued.running()).toBe(false);
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
  expect(continued.running()).toBe(true);
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

it('submits nothing when the app left while what the phone would show was being read, and runs nothing', async () => {
  // Final simulator run at 8aa75f6: the read took long enough for the app to reach the background
  // first, and the submission went out 0.85-0.96 s after it (#77).
  let release = () => {};
  const read = new Promise<void>((resolve) => { release = resolve; });
  const { continued, native, app } = harness([download()], { read: () => read });
  const started = continued.start();
  app.foreground = false;
  release();
  expect(await started).toBe(false);
  expect(native.submitContinued).not.toHaveBeenCalled();
  expect(continued.running()).toBe(false);
  // Back on the screen, the next start submits.
  app.foreground = true;
  expect(await continued.start()).toBe(true);
  expect(native.submitContinued).toHaveBeenCalledTimes(1);
});

it('does not count a task being submitted as running, only one the phone accepted', async () => {
  let answer = (_running: boolean) => {};
  const { continued, native } = harness([download()], { submit: () => new Promise<boolean>((resolve) => { answer = resolve; }) });
  const started = continued.start();
  await vi.waitFor(() => expect(native.submitContinued).toHaveBeenCalled());
  expect(continued.running()).toBe(false);
  answer(true);
  expect(await started).toBe(true);
  expect(continued.running()).toBe(true);
});
