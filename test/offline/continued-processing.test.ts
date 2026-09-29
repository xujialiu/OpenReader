import { expect, it, vi } from 'vitest';
import { continuedShown, createContinuedProcessing, type ContinuedDownload, type ContinuedNative, type ContinuedShown } from '../../src/offline/continued-processing';
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

/** One download of the batch, as the catalogue holds its Document in its voice. */
const entry = (task: DownloadTask, progress: ContinuedDownload['progress'] = [], of: NarrationPlan | null = plan): ContinuedDownload =>
  ({ task, progress, plan: of });

it('counts the chapters of the download that are saved, and moves within the chapter being written', () => {
  const shown = continuedShown([entry(download({ current: 'b' }), [
    { id: 'a', count: 10, complete: true },
    { id: 'b', count: 10, complete: false },
    { id: 'c', count: 0, complete: false },
  ])]);
  expect(shown).toEqual({ title: 'Downloading 1 book', subtitle: '1 of 3 chapters', completed: 1250, total: 3000, documents: ['book'] });
});

it('counts a chapter whose text is not yet prepared as nothing written', () => {
  expect(continuedShown([entry(download({ current: 'c' }), [{ id: 'a', count: 10, complete: true }])]))
    .toMatchObject({ subtitle: '1 of 3 chapters', completed: 1000 });
});

it('says chapter, not chapters, of a download of one', () => {
  expect(continuedShown([entry(download({ chapters: ['a'] }))]).subtitle).toBe('0 of 1 chapter');
});

it('counts only the chapters in the download, whatever else of the document is saved', () => {
  expect(continuedShown([entry(download({ chapters: ['b'] }), [{ id: 'a', count: 10, complete: true }])]))
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
  const shown = continuedShown([entry(task, [
    { id: 'a', count: 10, complete: true },
    { id: 'b', count: 10, complete: true },
    { id: 'c', count: 3, complete: false },
    { id: 'd', count: 5, complete: false },
    { id: 'e', count: 0, complete: false },
  ], six)]);
  // a and b are complete, b although paused; c is paused and left out; d, e (failed) and f are still counted.
  expect(shown).toEqual({ title: 'Downloading 1 book', subtitle: '2 of 5 chapters', completed: 2500, total: 5000, documents: ['book'] });
});

it('moves the bar for no paused chapter, even the one the writer is leaving', () => {
  const task = download({ chapters: ['a', 'b', 'c'], paused: ['b'], current: 'b' });
  expect(continuedShown([entry(task, [{ id: 'b', count: 5, complete: false }], six)]))
    .toMatchObject({ subtitle: '0 of 2 chapters', completed: 0, total: 2000 });
});

it.each([
  ['Pause all', { state: 'paused' as const, paused: ['a', 'b', 'c', 'd'] }],
  ['the ring that paused the last chapter going on', { state: 'paused' as const, paused: ['c', 'd'] }],
])('counts the whole download again once it is paused as a whole, by %s, so the last report is never a full count', (_, over) => {
  const task = download({ chapters: ['a', 'b', 'c', 'd'], ...over });
  expect(continuedShown([entry(task, [
    { id: 'a', count: 10, complete: true },
    { id: 'b', count: 10, complete: true },
  ], six)])).toEqual({ title: 'Downloading 1 book', subtitle: '2 of 4 chapters', completed: 2000, total: 4000, documents: ['book'] });
});

/** A plan of `n` chapters `c0`… of ten texts each, prepared. */
const chaptersPlan = (n: number): NarrationPlan => ({
  version: 2,
  chapters: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, title: `c${i}`, depth: 0, parent: null, texts: [], textCount: 10 })),
});
const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);
const saved = (n: number) => ids(n).map((id) => ({ id, count: 10, complete: true }));

it('counts the downloads of the batch together, and names how many books they are', () => {
  const shown = continuedShown([
    entry(download({ current: 'b' }), [{ id: 'a', count: 10, complete: true }, { id: 'b', count: 10, complete: false }]),
    entry(download({ id: 'u', document: 'second', chapters: ['a', 'b'], state: 'queued' })),
  ]);
  expect(shown).toEqual({ title: 'Downloading 2 books', subtitle: '1 of 5 chapters', completed: 1250, total: 5000, documents: ['book', 'second'] });
});

it('keeps a finished download in the count, so the count never goes back', () => {
  // The plan on #92: two books of 100 chapters, the first finished and the second at 20; a third of 50 added.
  const first = entry(download({ id: 'x', document: 'first', chapters: ids(100), state: 'done' }), saved(100), chaptersPlan(100));
  const second = entry(download({ id: 'y', document: 'second', chapters: ids(100), current: 'c20' }), saved(20), chaptersPlan(100));
  expect(continuedShown([first, second])).toMatchObject({ title: 'Downloading 2 books', subtitle: '120 of 200 chapters', completed: 120000, total: 200000 });
  const third = entry(download({ id: 'z', document: 'third', chapters: ids(50), state: 'queued' }), [], chaptersPlan(50));
  expect(continuedShown([first, second, third])).toMatchObject({ title: 'Downloading 3 books', subtitle: '120 of 250 chapters' });
});

it('counts a paused chapter only once saved in every download of the batch while one goes on, a whole download paused included', () => {
  const going = download({ id: 'w', chapters: ['a', 'b', 'c', 'd'], paused: ['b'], current: 'a' });
  // Paused as a whole by Pause all, with a saved and c failed.
  const held = download({ id: 'h', document: 'held', chapters: ['a', 'b', 'c', 'd'], state: 'paused', paused: ['a', 'b', 'd'], failed: ['c'] });
  // Paused as a whole before anything was saved: no chapter of it counts, and it is no book.
  const unsaved = download({ id: 'n', document: 'unsaved', chapters: ['a', 'b'], state: 'paused', paused: ['a', 'b'] });
  const batch = [
    entry(going, [{ id: 'a', count: 5, complete: false }], six),
    entry(held, [{ id: 'a', count: 10, complete: true }], six),
    entry(unsaved, [], six),
  ];
  // going: a, c, d; held: a (saved) and c (failed); unsaved: nothing.
  expect(continuedShown(batch)).toEqual({
    title: 'Downloading 2 books', subtitle: '1 of 5 chapters', completed: 1500, total: 5000, documents: ['book', 'held'],
  });
  // Once nothing of the batch goes on by itself, every chapter of every download counts: where it stopped.
  going.state = 'paused';
  going.paused = ['a', 'b', 'c', 'd'];
  expect(continuedShown(batch)).toEqual({
    title: 'Downloading 3 books', subtitle: '1 of 10 chapters', completed: 1500, total: 10000, documents: ['book', 'held', 'unsaved'],
  });
});

it('counts two voices of one Document as one book', () => {
  const shown = continuedShown([
    entry(download({ id: 'a1' })),
    entry(download({ id: 'b1', voice: { provider: 'fish', voice: 'B', label: 'B' }, state: 'queued' })),
  ]);
  expect(shown).toMatchObject({ title: 'Downloading 1 book', subtitle: '0 of 6 chapters', total: 6000, documents: ['book'] });
});

it('adds the saved share of each download\'s chapter being written, 1,000 units a chapter', () => {
  const shown = continuedShown([
    entry(download({ chapters: ['a', 'b'], current: 'a' }), [{ id: 'a', count: 5, complete: false }], six),
    entry(download({ id: 'u', document: 'second', chapters: ['a', 'b', 'c'], current: 'b' }), [
      { id: 'a', count: 10, complete: true },
      { id: 'b', count: 3, complete: false },
    ], six),
  ]);
  // 1 complete, and half of one chapter and three tenths of another.
  expect(shown).toMatchObject({ subtitle: '1 of 5 chapters', completed: 1800, total: 5000 });
});

it('shows a batch with no chapter at all as one chapter of units, so the phone never divides by nothing', () => {
  expect(continuedShown([])).toMatchObject({ subtitle: '0 of 0 chapters', completed: 0, total: 1000 });
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
    submitContinued: vi.fn(async (shown: ContinuedShown) => { calls.push(`submit ${shown.title} · ${shown.subtitle}`); return submit(); }),
    updateContinued: vi.fn(async (shown: ContinuedShown) => { calls.push(`update ${shown.title} · ${shown.subtitle}`); await update(); }),
    finishContinued: vi.fn(async (success: boolean) => { calls.push(`finish ${success}`); }),
  };
  // The batch's Documents stand in for the title and their states for the count, so each call says which
  // downloads it showed, at which moment.
  const shown = async (batch: readonly DownloadTask[]): Promise<ContinuedShown> => {
    await read();
    return {
      title: batch.map((task) => task.document).join('+'),
      subtitle: batch.map((task) => task.state).join('+'),
      completed: 0,
      total: 1000,
      documents: batch.map((task) => task.document),
    };
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

it('shows at its submission every download going on then, and none that has stopped', async () => {
  const tasks = [
    download({ id: 'x', document: 'first', state: 'queued' }),
    download({ id: 'b', document: 'old', state: 'blocked' }),
    download({ id: 'y', document: 'second', state: 'downloading' }),
  ];
  const { continued, calls } = harness(tasks);
  await continued.start();
  expect(calls).toEqual(['submit first+second · queued+downloading']);
});

it('keeps a finished download in its batch, takes in one that starts going on, and lets a deleted one go', async () => {
  // #92: the count never goes back while the task runs.
  const tasks = [
    download({ id: 'x', document: 'first' }),
    download({ id: 'y', document: 'second', state: 'queued' }),
    download({ id: 'z', document: 'third', state: 'paused' }),
  ];
  const { continued, calls } = harness(tasks);
  await continued.start();
  tasks[0].state = 'done';
  tasks[1].state = 'downloading';
  continued.follow();
  await vi.waitFor(() => expect(calls.at(-1)).toBe('update first+second · done+downloading'));
  // Resumed while the task runs.
  tasks[2].state = 'queued';
  continued.follow();
  await vi.waitFor(() => expect(calls.at(-1)).toBe('update first+second+third · done+downloading+queued'));
  // Deleted.
  tasks.splice(1, 1);
  continued.follow();
  await vi.waitFor(() => expect(calls.at(-1)).toBe('update first+third · done+queued'));
  // The last report, once nothing goes on, shows the whole batch where it stopped.
  tasks[1].state = 'paused';
  continued.follow();
  await vi.waitFor(() => expect(calls.slice(-2)).toEqual(['update first+third · done+paused', 'finish true']));
});

it('starts a new batch with a new task', async () => {
  const tasks = [download({ id: 'x', document: 'first' }), download({ id: 'y', document: 'second', state: 'paused' })];
  const { continued, calls } = harness(tasks);
  await continued.start();
  tasks[0].state = 'done';
  continued.follow();
  await vi.waitFor(() => expect(calls.at(-1)).toBe('finish true'));
  tasks[1].state = 'queued';
  await continued.start();
  expect(calls.at(-1)).toBe('submit second · queued');
});

it('shows nothing at its finish when every download of its batch was deleted', async () => {
  const tasks = [download()];
  const { continued, calls } = harness(tasks);
  await continued.start();
  tasks.splice(0, 1);
  continued.follow();
  await vi.waitFor(() => expect(calls).toEqual(['submit book · downloading', 'finish true']));
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
