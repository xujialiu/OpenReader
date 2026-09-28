import { expect, it, vi } from 'vitest';
import { DEFAULT_SENTENCES_AT_ONCE, DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';
import type { SynthesisResult } from '../../src/core/providers/types';
import type { Chapter, NarrationPlan } from '../../src/offline/model';
import { speechKeying } from '../../src/offline/speech';

/**
 * #75: a Download goes on while a Reading plays, in the foreground and with the
 * phone locked. The runtime used to hold the scheduler back for as long as the
 * reader said it was playing, so a download stood still for the whole of a
 * Reading. Nothing about a Reading holds a download back now; what keeps the
 * Reading ahead is the Provider's own queue where it has one, and Speechify's is
 * told which requests are a download's. Away from the screen a playing Reading
 * keeps the app running, so the end of the background time does not stop the
 * download either. The platform is behind the same test doubles as
 * `runtime.test.ts`, with the app's state and the end of the background time
 * driven by the test.
 */
const mock = vi.hoisted(() => ({
  open: vi.fn<() => Promise<unknown>>(),
  /** Each synthesis the runtime sent, with the Speechify settings its provider was built with. */
  sent: [] as { text: string; speechify: unknown }[],
  /** Texts whose request is held out until the test lets it go, by `release`. */
  held: new Set<string>(),
  pending: new Map<string, () => void>(),
  /** Every AppState listener the runtime registered (#76 adds one of its own), called in order. */
  appStateListeners: [] as ((state: string) => void)[],
  appState: (state: string) => {
    mock.appStateNow = state;
    mock.appStateListeners.forEach((listener) => listener(state));
  },
  appStateNow: 'active',
  expired: null as null | (() => void),
  beginBackground: vi.fn(async () => true),
  /** Refused, as the simulator refuses it, unless a test answers otherwise (ADR 0052). */
  submitContinued: vi.fn(async (): Promise<boolean> => false),
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
    addListener: (event: string, listener: () => void) => {
      if (event === 'expired') mock.expired = listener;
      return { remove() {} };
    },
    beginBackground: mock.beginBackground,
    endBackground: async () => {},
    submitContinued: mock.submitContinued,
    updateContinued: async () => {},
    finishContinued: async () => {},
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
  createProvider: (_id: string, configuration: { speechify: unknown }) => ({
    id: 'speechify', capabilities: { wordTimestamps: true }, listVoices: async () => [],
    synthesize: (text: string) => {
      mock.sent.push({ text, speechify: configuration.speechify });
      const clip: SynthesisResult = { audio: 'encoded', bytes: new Uint8Array([1]), mediaType: 'audio/mp4' };
      return new Promise<SynthesisResult>((resolve) => {
        if (mock.held.has(text)) mock.pending.set(text, () => resolve(clip));
        else resolve(clip);
      });
    },
  }),
}));
vi.mock('../../src/offline/database', () => ({ offlineRepository: () => mock.open() }));

const { configureDownloads, downloadTasks, downloadsReady, enqueue, offlineProvider, setReadingPlays, startDownloads } = await import('../../src/offline/runtime');

const settings: AppSettings = {
  ...DEFAULT_SETTINGS, provider: 'speechify', enabledProviders: ['speechify'], voice: 'en-US/george',
  sentencesAtOnce: { ...DEFAULT_SENTENCES_AT_ONCE, speechify: 2 },
};
const voice = { provider: 'speechify' as const, voice: 'en-US/george', label: 'George' };
const chapter: Chapter = { id: 'a', title: 'A', depth: 0, parent: null, section: 0, texts: [], textCount: 0, textsLoaded: false, prepared: true };
/** Chapter `a` of each document holds these texts. */
const books = new Map<string, string[]>();

/** A catalogue whose chapter `a` holds each document's texts, and which remembers what was saved. */
function catalogue() {
  const saved = new Set<string>();
  const saveClip = vi.fn(async (_document: string, _voice: unknown, text: string) => { saved.add(text); return true; });
  mock.open.mockResolvedValue({
    tasks: async () => [],
    catalog: { saveTasks: async () => {}, speechKeying: async () => speechKeying(settings) },
    plan: async (): Promise<NarrationPlan> => ({ version: 2, chapters: [chapter] }),
    chapter: async (document: string) => ({ ...chapter, texts: books.get(document) ?? [], textCount: books.get(document)?.length ?? 0, textsLoaded: true }),
    progress: async () => [],
    hasClip: async (_document: string, _voice: unknown, text: string) => saved.has(text),
    readClip: async () => ({ clip: null, dropped: false }),
    saveClip,
    inventory: async () => [],
    savedVoices: async () => [],
  });
  return { saved, saveClip };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const release = async (text: string) => {
  await vi.waitFor(() => expect(mock.pending.has(text)).toBe(true));
  mock.pending.get(text)!();
  mock.pending.delete(text);
};
const task = (document: string) => downloadTasks(document)[0]!;
/** Away from the screen with a download running, once the bounded background task has been granted. */
async function leave() {
  mock.beginBackground.mockClear();
  mock.appState('background');
  await vi.waitFor(() => expect(mock.beginBackground).toHaveBeenCalled());
  await tick();
}
/** A download of one chapter of `texts`, one sentence at a time, with every request held until released. */
async function downloading(document: string, texts: string[]) {
  books.set(document, texts);
  texts.forEach((text) => mock.held.add(text));
  const store = catalogue();
  configureDownloads({ ...settings, sentencesAtOnce: { ...settings.sentencesAtOnce, speechify: 1 } });
  const stop = startDownloads();
  await vi.waitFor(() => expect(downloadsReady()).toBe(true));
  enqueue(document, voice, ['a']);
  await vi.waitFor(() => expect(mock.pending.has(texts[0]!)).toBe(true));
  expect(task(document).state).toBe('downloading');
  return {
    store,
    /** Back to the foreground and no Reading, as the next test expects to find it. */
    stop: () => { mock.appState('active'); setReadingPlays(false); stop(); },
  };
}

it('writes a queued download while a Reading\'s request is out, and tells Speechify which requests are the download\'s', async () => {
  const { saveClip } = catalogue();
  books.set('book', ['One.', 'Two.']);
  mock.held.add('Read now.');
  configureDownloads(settings);
  const stop = startDownloads();
  try {
    await vi.waitFor(() => expect(downloadsReady()).toBe(true));
    const reading = offlineProvider('book', settings).synthesize('Read now.', { voice: voice.voice, signal: new AbortController().signal });
    await vi.waitFor(() => expect(mock.pending.has('Read now.')).toBe(true));

    enqueue('book', voice, ['a']);
    await vi.waitFor(() => expect(saveClip).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(task('book').state).toBe('done'));
    // Both clips were saved while the Reading's own request was still out.
    expect(mock.sent.map((request) => request.text)).toEqual(['Read now.', 'One.', 'Two.']);
    // The Reading's request is not marked, so it goes ahead of the download's still waiting (#75);
    // the download's carries the owner's Sentences at once for Speechify (#64).
    expect(mock.sent[0]!.speechify).toEqual({ apiKey: 'test-key' });
    expect(mock.sent[1]!.speechify).toEqual({ apiKey: 'test-key', atOnce: 2, download: true });

    await release('Read now.');
    expect((await reading).audio).toBe('encoded');
  } finally {
    stop();
  }
});

it('goes on after the background time runs out while a Reading plays away from the screen', async () => {
  const run = await downloading('away-playing', ['Away 1.', 'Away 2.', 'Away 3.']);
  try {
    setReadingPlays(true);
    await leave();
    mock.expired!();
    expect(task('away-playing').state).toBe('downloading');
    await release('Away 1.');
    await release('Away 2.');
    await release('Away 3.');
    await vi.waitFor(() => expect(task('away-playing').state).toBe('done'));
    expect([...run.store.saved]).toEqual(['Away 1.', 'Away 2.', 'Away 3.']);
  } finally {
    run.stop();
  }
});

it('is interrupted when the Reading stops after the background time ran out, and goes on when the app comes back', async () => {
  const run = await downloading('away-paused', ['Paused 1.', 'Paused 2.']);
  try {
    setReadingPlays(true);
    await leave();
    mock.expired!();
    // The lock screen's Pause: nothing keeps the app running any more.
    setReadingPlays(false);
    expect(task('away-paused').state).toBe('interrupted');
    // What was out is kept; nothing more is asked for.
    await release('Paused 1.');
    await vi.waitFor(() => expect(run.store.saved.has('Paused 1.')).toBe(true));
    await tick();
    expect(mock.pending.has('Paused 2.')).toBe(false);
    expect(task('away-paused').state).toBe('interrupted');

    mock.appState('active');
    await release('Paused 2.');
    await vi.waitFor(() => expect(task('away-paused').state).toBe('done'));
  } finally {
    run.stop();
  }
});

it('goes on again when a Reading starts away from the screen after the background time interrupted it', async () => {
  const run = await downloading('away-started', ['Started 1.', 'Started 2.']);
  try {
    await leave();
    // No Reading: the end of the background time interrupts the download, as it always has.
    mock.expired!();
    expect(task('away-started').state).toBe('interrupted');
    await release('Started 1.');
    await vi.waitFor(() => expect(run.store.saved.has('Started 1.')).toBe(true));
    await tick();
    expect(mock.pending.has('Started 2.')).toBe(false);

    // The lock screen's Play: the Reading keeps the app running, and the download goes on beside it.
    setReadingPlays(true);
    await release('Started 2.');
    await vi.waitFor(() => expect(task('away-started').state).toBe('done'));
  } finally {
    run.stop();
  }
});

it('goes on away from the screen under a continued task the phone accepted after the app left, though the bounded time was refused', async () => {
  // The app left while the submission was out, so the bounded time was asked for, and refused.
  let answer = (_running: boolean) => {};
  mock.submitContinued.mockImplementationOnce(() => new Promise<boolean>((resolve) => { answer = resolve; }));
  mock.beginBackground.mockImplementationOnce(async () => false);
  const run = await downloading('away-continued', ['Continued 1.', 'Continued 2.']);
  try {
    mock.beginBackground.mockClear();
    mock.appState('background');
    await vi.waitFor(() => expect(mock.beginBackground).toHaveBeenCalled());
    await tick();
    answer(true);
    await tick();
    await release('Continued 1.');
    await release('Continued 2.');
    await vi.waitFor(() => expect(task('away-continued').state).toBe('done'));
    expect([...run.store.saved]).toEqual(['Continued 1.', 'Continued 2.']);
  } finally {
    run.stop();
  }
});
