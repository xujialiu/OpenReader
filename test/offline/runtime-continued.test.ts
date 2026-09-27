import { beforeEach, expect, it, vi } from 'vitest';
import type { DownloadTask } from '../../src/offline/model';

/**
 * The runtime's half of ADR 0052 (#77): a download the owner starts or resumes
 * on the screen is submitted as a continued processing task, which keeps the
 * app running when the owner leaves it; without one, leaving asks for the
 * bounded background time as before. The native module is doubled, as in
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
    catalog: { saveTasks: async () => {}, speechKeying: async () => null },
    plan: () => new Promise(() => {}),
    progress: async () => [],
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

it('submits nothing for a download restored at launch or on coming back, nor for a ring that pauses; a ring that resumes submits', async () => {
  const stored: DownloadTask = { id: 't', document: 'book', voice, chapters: ['a', 'b'], state: 'downloading', error: null, failed: [] };
  const { runtime, stop } = await start([stored]);
  try {
    const [task] = runtime.downloadTasks('book');
    expect(task.state).toBe('queued');
    mock.appState('background');
    expect(mock.beginBackground).toHaveBeenCalledTimes(1);
    mock.appState('active');
    runtime.toggleChapter(task, 'a');
    expect(task).toMatchObject({ state: 'queued', paused: ['a'] });
    await Promise.resolve();
    expect(mock.submitContinued).not.toHaveBeenCalled();
    runtime.toggleChapter(task, 'a');
    await vi.waitFor(() => expect(mock.submitContinued).toHaveBeenCalledTimes(1));
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

it('interrupts the download when the continued task ends away from the screen, and continues it on coming back without submitting again', async () => {
  const { runtime, stop } = await start();
  try {
    runtime.enqueue('book', voice, ['a']);
    await vi.waitFor(() => expect(mock.submitContinued).toHaveBeenCalledTimes(1));
    const [task] = runtime.downloadTasks('book');
    task.state = 'downloading';
    mock.appState('background');
    mock.continuedExpired!();
    expect(task.state).toBe('interrupted');
    mock.appState('active');
    expect(task.state).toBe('queued');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mock.submitContinued).toHaveBeenCalledTimes(1);
    expect(mock.beginBackground).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

it('leaves the download going on when the continued task ends on the screen, and leaving afterwards asks for the bounded time', async () => {
  const { runtime, stop } = await start();
  try {
    runtime.enqueue('book', voice, ['a']);
    await vi.waitFor(() => expect(mock.submitContinued).toHaveBeenCalledTimes(1));
    const [task] = runtime.downloadTasks('book');
    task.state = 'downloading';
    mock.continuedExpired!();
    expect(task.state).toBe('downloading');
    mock.appState('background');
    expect(mock.beginBackground).toHaveBeenCalledTimes(1);
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
