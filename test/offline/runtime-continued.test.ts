import { beforeEach, expect, it, vi } from 'vitest';
import type { DownloadTask } from '../../src/offline/model';

/**
 * The runtime's half of ADR 0052 (#77): a download the owner starts or resumes
 * on the screen, or one that goes on by itself when the app is launched or
 * comes back to the foreground, is submitted as a continued processing task,
 * which keeps the app running when the owner leaves it; without one, leaving
 * asks for the bounded background time as before. When the phone ends it, at
 * the owner's stop in the Live Activity or by itself, the downloads it covered
 * are paused as Pause all pauses them. The native module is doubled, as in
 * `runtime.test.ts`. The Document's plan never arrives, so the scheduler holds
 * a started download `queued` and nothing is fetched.
 */
const mock = vi.hoisted(() => ({
  open: vi.fn<() => Promise<unknown>>(),
  /** Every AppState listener the runtime registered (#76 adds one of its own), called in order. */
  appStateListeners: [] as ((state: string) => void)[],
  appState: (state: string) => {
    mock.appStateNow = state;
    mock.appStateListeners.forEach((listener) => listener(state));
  },
  appStateNow: 'active',
  connectivity: null as null | ((event: { connected: boolean }) => void),
  expired: null as null | (() => void),
  continuedExpired: null as null | (() => void),
  submitContinued: vi.fn(async (_title: string, _subtitle: string, _completed: number, _total: number) => true),
  updateContinued: vi.fn(async (_title: string, _subtitle: string, _completed: number, _total: number) => {}),
  finishContinued: vi.fn(async (_success: boolean) => {}),
  beginBackground: vi.fn(async () => true),
  endBackground: vi.fn(async () => {}),
  /** The catalogue's progress, which what the phone shows is read from before each submission. */
  progress: vi.fn(async (): Promise<unknown[]> => []),
  /** Every save of the downloads; the last is what the next launch reads back. */
  saveTasks: vi.fn(async (_tasks: DownloadTask[]) => {}),
}));
vi.mock('react-native', () => ({
  AppState: {
    get currentState() { return mock.appStateNow; },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      mock.appStateListeners.push(listener);
      return { remove() { mock.appStateListeners = mock.appStateListeners.filter((l) => l !== listener); } };
    },
  },
  Platform: { OS: 'ios' },
}));
vi.mock('expo-file-system', () => ({ FileMode: { ReadOnly: 'r' } }));
vi.mock('../../modules/open-reader-offline', () => ({
  offlineNative: {
    addListener(event: string, listener: never) {
      if (event === 'connectivity') mock.connectivity = listener;
      if (event === 'expired') mock.expired = listener;
      if (event === 'continuedExpired') mock.continuedExpired = listener;
      return { remove() {} };
    },
    beginBackground: mock.beginBackground,
    endBackground: mock.endBackground,
    submitContinued: mock.submitContinued,
    updateContinued: mock.updateContinued,
    finishContinued: mock.finishContinued,
  },
}));
vi.mock('../../src/app/library', () => ({
  documentFile: () => { throw new Error('The document file is not read here.'); },
}));
vi.mock('../../src/keys/store', () => ({
  readProviderKey: async () => ({ outcome: 'found', secret: 'test-key' }),
  readGatewayHeaders: async () => ({ outcome: 'found', secret: '' }),
}));
vi.mock('../../src/core/providers/factory', () => ({
  createProvider: () => { throw new Error('Nothing is synthesized here.'); },
}));
vi.mock('../../src/offline/database', () => ({ offlineRepository: () => mock.open() }));

const voice = { provider: 'fish' as const, voice: 'A', label: 'A' };

/** A fresh runtime, with a catalogue holding `stored` and a plan that never arrives. */
async function start(stored: DownloadTask[] = []) {
  vi.resetModules();
  const runtime = await import('../../src/offline/runtime');
  mock.open.mockResolvedValue({
    tasks: async () => stored,
    catalog: { saveTasks: mock.saveTasks, speechKeying: async () => null },
    plan: () => new Promise(() => {}),
    progress: () => mock.progress(),
  });
  runtime.nameDocuments([{ id: 'book', title: 'My Vampire System' }]);
  const stop = runtime.startDownloads();
  await vi.waitFor(() => expect(runtime.downloadsReady()).toBe(true));
  return { runtime, stop };
}
beforeEach(() => {
  vi.clearAllMocks();
  // Each test imports a fresh runtime, which reads the app's state as it loads.
  mock.appStateNow = 'active';
  mock.appStateListeners = [];
  mock.submitContinued.mockImplementation(async () => true);
  mock.progress.mockImplementation(async () => []);
});

it('submits a download the owner starts on the screen, named as the Library names its Document', async () => {
  const { runtime, stop } = await start();
  try {
    runtime.enqueue('book', voice, ['a', 'b']);
    await vi.waitFor(() => expect(mock.submitContinued).toHaveBeenCalledWith('My Vampire System', '0 of 2 chapters', 0, 2000));
    // Leaving the app: the continued task keeps it running, so the bounded time is not asked for.
    mock.appState('background');
    expect(runtime.downloadTasks('book')[0].state).toBe('queued');
    expect(mock.beginBackground).not.toHaveBeenCalled();
    // A rename is shown.
    runtime.nameDocuments([{ id: 'book', title: 'Book One' }]);
    await vi.waitFor(() => expect(mock.updateContinued).toHaveBeenLastCalledWith('Book One', '0 of 2 chapters', 0, 2000));
  } finally {
    stop();
  }
});

it('asks for the bounded time as before when the phone refuses the continued task', async () => {
  mock.submitContinued.mockImplementation(async () => false);
  const { runtime, stop } = await start();
  try {
    runtime.enqueue('book', voice, ['a']);
    await vi.waitFor(() => expect(mock.submitContinued).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    mock.appState('background');
    expect(mock.beginBackground).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});

it('submits a download restored at launch in the foreground, since opening the app is the owner\'s action', async () => {
  const stored: DownloadTask = { id: 't', document: 'book', voice, chapters: ['a', 'b'], state: 'downloading', error: null, failed: [] };
  const { runtime, stop } = await start([stored]);
  try {
    expect(runtime.downloadTasks('book')[0].state).toBe('queued');
    await vi.waitFor(() => expect(mock.submitContinued).toHaveBeenCalledWith('My Vampire System', '0 of 2 chapters', 0, 2000));
    // Leaving the app: the continued task keeps it running.
    await new Promise((resolve) => setTimeout(resolve, 10));
    mock.appState('background');
    expect(mock.beginBackground).not.toHaveBeenCalled();
    expect(mock.submitContinued).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});

it('submits a download restored at a launch away from the screen only once the app comes to the foreground', async () => {
  mock.appStateNow = 'background';
  const stored: DownloadTask = { id: 't', document: 'book', voice, chapters: ['a'], state: 'queued', error: null, failed: [] };
  const { stop } = await start([stored]);
  try {
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mock.submitContinued).not.toHaveBeenCalled();
    mock.appState('active');
    await vi.waitFor(() => expect(mock.submitContinued).toHaveBeenCalledTimes(1));
  } finally {
    stop();
  }
});

it('submits nothing at launch or on coming back when no download goes on by itself', async () => {
  const stored: DownloadTask[] = [
    { id: 'p', document: 'book', voice, chapters: ['a'], state: 'paused', error: null, failed: [], paused: ['a'] },
    { id: 'd', document: 'other', voice, chapters: ['a'], state: 'done', error: null, failed: [] },
    { id: 'b', document: 'third', voice, chapters: ['a'], state: 'blocked', error: 'The key was refused.', failed: [] },
  ];
  const { stop } = await start(stored);
  try {
    mock.appState('background');
    mock.appState('active');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mock.submitContinued).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

it('submits nothing for a ring that pauses; a ring that resumes submits', async () => {
  const stored: DownloadTask = { id: 't', document: 'book', voice, chapters: ['a', 'b'], state: 'queued', error: null, failed: [] };
  // Refused at launch, as the simulator refuses every one, so that each later submission shows.
  mock.submitContinued.mockImplementation(async () => false);
  const { runtime, stop } = await start([stored]);
  try {
    await vi.waitFor(() => expect(mock.submitContinued).toHaveBeenCalledTimes(1));
    const [task] = runtime.downloadTasks('book');
    runtime.toggleChapter(task, 'a');
    expect(task).toMatchObject({ state: 'queued', paused: ['a'] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mock.submitContinued).toHaveBeenCalledTimes(1);
    runtime.toggleChapter(task, 'a');
    await vi.waitFor(() => expect(mock.submitContinued).toHaveBeenCalledTimes(2));
  } finally {
    stop();
  }
});

it('finishes the continued task at Pause all, and submits it again at Resume all', async () => {
  const { runtime, stop } = await start();
  try {
    runtime.enqueue('book', voice, ['a', 'b']);
    await vi.waitFor(() => expect(mock.submitContinued).toHaveBeenCalledTimes(1));
    const [task] = runtime.downloadTasks('book');
    runtime.toggleTask(task);
    expect(task.state).toBe('paused');
    await vi.waitFor(() => expect(mock.finishContinued).toHaveBeenCalledWith(true));
    expect(mock.updateContinued).toHaveBeenLastCalledWith('My Vampire System', '0 of 2 chapters', 0, 2000);
    runtime.toggleTask(task);
    expect(task.state).toBe('queued');
    await vi.waitFor(() => expect(mock.submitContinued).toHaveBeenCalledTimes(2));
  } finally {
    stop();
  }
});

/** Downloads that do not go on by themselves, which the end of a continued task leaves as they are. */
const stoppedElsewhere = (): DownloadTask[] => [
  { id: 'old', document: 'other', voice, chapters: ['x'], state: 'blocked', error: 'The key was refused.', failed: [] },
  { id: 'held', document: 'third', voice, chapters: ['y', 'z'], state: 'paused', error: null, failed: [], paused: ['z'] },
  { id: 'saved', document: 'fourth', voice, chapters: ['w'], state: 'done', error: null, failed: [] },
];

it('pauses the downloads the continued task covered when it ends away from the screen, as Pause all does; coming back submits nothing, and Resume all submits again', async () => {
  const { runtime, stop } = await start(stoppedElsewhere());
  try {
    runtime.enqueue('book', voice, ['a', 'b', 'c']);
    await vi.waitFor(() => expect(mock.submitContinued).toHaveBeenCalledTimes(1));
    const [task] = runtime.downloadTasks('book');
    runtime.toggleChapter(task, 'c');
    task.state = 'downloading';
    // The owner's iPhone, 2026-09-28 19:19: locked; the stop in the Live Activity opened the app, which
    // went back to the background, and the task ended 6 s later (#77).
    mock.appState('background');
    mock.appState('active');
    mock.appState('background');
    expect(mock.submitContinued).toHaveBeenCalledTimes(1);
    mock.continuedExpired!();
    expect(task).toMatchObject({ state: 'paused', paused: ['a', 'b', 'c'] });
    expect(runtime.downloadTasks('other')[0]).toMatchObject({ state: 'blocked', error: 'The key was refused.' });
    expect(runtime.downloadTasks('third')[0]).toMatchObject({ state: 'paused', paused: ['z'] });
    expect(runtime.downloadTasks('fourth')[0].state).toBe('done');
    await vi.waitFor(() => expect(mock.saveTasks).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: task.id, state: 'paused', paused: ['a', 'b', 'c'] })]),
    ));
    // Opening the app does not resume it, and so submits nothing; leaving asks for nothing either.
    mock.appState('active');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(task.state).toBe('paused');
    expect(mock.submitContinued).toHaveBeenCalledTimes(1);
    mock.appState('background');
    expect(mock.beginBackground).not.toHaveBeenCalled();
    mock.appState('active');
    runtime.toggleTask(task);
    expect(task.state).toBe('queued');
    await vi.waitFor(() => expect(mock.submitContinued).toHaveBeenCalledTimes(2));
  } finally {
    stop();
  }
});

it('pauses the downloads the continued task covered when it ends on the screen, and neither leaving nor coming back asks for anything', async () => {
  const { runtime, stop } = await start(stoppedElsewhere());
  try {
    runtime.enqueue('book', voice, ['a']);
    runtime.enqueue('second', voice, ['b']);
    await vi.waitFor(() => expect(mock.submitContinued).toHaveBeenCalledTimes(1));
    const [task] = runtime.downloadTasks('book');
    task.state = 'downloading';
    mock.continuedExpired!();
    expect(task).toMatchObject({ state: 'paused', paused: ['a'] });
    expect(runtime.downloadTasks('second')[0]).toMatchObject({ state: 'paused', paused: ['b'] });
    expect(runtime.downloadTasks('other')[0].state).toBe('blocked');
    expect(runtime.downloadTasks('third')[0]).toMatchObject({ state: 'paused', paused: ['z'] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    mock.appState('background');
    expect(mock.beginBackground).not.toHaveBeenCalled();
    mock.appState('active');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mock.submitContinued).toHaveBeenCalledTimes(1);
    expect(mock.finishContinued).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

it('finishes the continued task as a success at Pause all, though a download of another Document is blocked', async () => {
  // The owner's iPhone, 2026-09-28 19:26:52: `complete with success: 0` after Pause all (#77).
  const { runtime, stop } = await start(stoppedElsewhere());
  try {
    runtime.enqueue('book', voice, ['a', 'b']);
    await vi.waitFor(() => expect(mock.submitContinued).toHaveBeenCalledTimes(1));
    runtime.toggleTask(runtime.downloadTasks('book')[0]);
    await vi.waitFor(() => expect(mock.finishContinued).toHaveBeenCalledWith(true));
  } finally {
    stop();
  }
});

it('submits nothing more on coming back while the continued task still runs', async () => {
  const { runtime, stop } = await start();
  try {
    runtime.enqueue('book', voice, ['a']);
    await vi.waitFor(() => expect(mock.submitContinued).toHaveBeenCalledTimes(1));
    mock.appState('background');
    mock.appState('active');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mock.submitContinued).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});

it('submits again on each return to the foreground after a refusal, and leaving after each asks for the bounded time', async () => {
  mock.submitContinued.mockImplementation(async () => false);
  const { runtime, stop } = await start();
  try {
    runtime.enqueue('book', voice, ['a']);
    await vi.waitFor(() => expect(mock.submitContinued).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    mock.appState('background');
    expect(mock.beginBackground).toHaveBeenCalledTimes(1);
    mock.appState('active');
    await vi.waitFor(() => expect(mock.submitContinued).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 10));
    mock.appState('background');
    expect(mock.beginBackground).toHaveBeenCalledTimes(2);
  } finally {
    stop();
  }
});

it('submits nothing for a download started away from the screen', async () => {
  const { runtime, stop } = await start();
  try {
    mock.appState('background');
    runtime.enqueue('book', voice, ['a']);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mock.submitContinued).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

/** A submission held out until the test answers it, as the phone's answer is. */
function heldSubmission() {
  const held = { answer: (_running: boolean) => {} };
  mock.submitContinued.mockImplementation(() => new Promise<boolean>((resolve) => { held.answer = resolve; }));
  return held;
}
/** The next read of what the phone shows, held until the test lets it go. */
function heldRead() {
  const held = { release: () => {} };
  mock.progress.mockImplementationOnce(() => new Promise<unknown[]>((resolve) => { held.release = () => resolve([]); }));
  return held;
}

it('begins the bounded time on leaving while a submission is out, and keeps it when the phone refuses', async () => {
  const submission = heldSubmission();
  const { runtime, stop } = await start();
  try {
    runtime.enqueue('book', voice, ['a']);
    await vi.waitFor(() => expect(mock.submitContinued).toHaveBeenCalledTimes(1));
    const [task] = runtime.downloadTasks('book');
    task.state = 'downloading';
    mock.beginBackground.mockClear();
    mock.endBackground.mockClear();
    mock.appState('background');
    // At 8aa75f6 a submission out counted as holding the app, and nothing was begun here.
    expect(mock.beginBackground).toHaveBeenCalledTimes(1);
    submission.answer(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mock.endBackground).not.toHaveBeenCalled();
    expect(mock.beginBackground).toHaveBeenCalledTimes(1);
    // Its end interrupts the download, as the end of the bounded time always has.
    mock.expired!();
    expect(task.state).toBe('interrupted');
  } finally {
    stop();
  }
});

it('gives the bounded time back when the phone accepts a submission after the app left, and its late end interrupts nothing', async () => {
  const submission = heldSubmission();
  const { runtime, stop } = await start();
  try {
    runtime.enqueue('book', voice, ['a']);
    await vi.waitFor(() => expect(mock.submitContinued).toHaveBeenCalledTimes(1));
    const [task] = runtime.downloadTasks('book');
    task.state = 'downloading';
    mock.beginBackground.mockClear();
    mock.endBackground.mockClear();
    mock.appState('background');
    expect(mock.beginBackground).toHaveBeenCalledTimes(1);
    submission.answer(true);
    await vi.waitFor(() => expect(mock.endBackground).toHaveBeenCalledTimes(1));
    expect(mock.endBackground.mock.invocationCallOrder[0]).toBeGreaterThan(mock.beginBackground.mock.invocationCallOrder[0]);
    // The bounded time's own end, arriving anyway: the continued task keeps the app, and the download, running.
    mock.expired!();
    expect(task.state).toBe('downloading');
    // The continued task's end pauses it, as Pause all does.
    mock.continuedExpired!();
    expect(task).toMatchObject({ state: 'paused', paused: ['a'] });
  } finally {
    stop();
  }
});

it('submits nothing when the app leaves while what the phone would show is being read, and begins the bounded time', async () => {
  const read = heldRead();
  const { runtime, stop } = await start();
  try {
    runtime.enqueue('book', voice, ['a']);
    await vi.waitFor(() => expect(mock.progress).toHaveBeenCalledTimes(1));
    mock.beginBackground.mockClear();
    mock.appState('background');
    expect(mock.beginBackground).toHaveBeenCalledTimes(1);
    read.release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mock.submitContinued).not.toHaveBeenCalled();
    // Back on the screen, it is submitted.
    mock.appState('active');
    await vi.waitFor(() => expect(mock.submitContinued).toHaveBeenCalledTimes(1));
  } finally {
    stop();
  }
});

it('submits nothing for the simulated lock\'s flicker back to active on its way to the background', async () => {
  // The final simulator run at 8aa75f6: inactive, active for up to a second, then background; the
  // flicker's submission went out after the background, with no background time until it was refused.
  mock.submitContinued.mockImplementation(async () => false);
  const { runtime, stop } = await start();
  try {
    runtime.enqueue('book', voice, ['a']);
    await vi.waitFor(() => expect(mock.submitContinued).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const read = heldRead();
    mock.beginBackground.mockClear();
    mock.appState('inactive');
    mock.appState('active');
    await vi.waitFor(() => expect(mock.progress).toHaveBeenCalledTimes(2));
    mock.appState('background');
    expect(mock.beginBackground).toHaveBeenCalledTimes(2);
    read.release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mock.submitContinued).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});
