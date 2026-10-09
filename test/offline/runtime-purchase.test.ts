import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SENTENCES_AT_ONCE, DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';
import type { SynthesisResult } from '../../src/core/providers/types';
import type { Chapter, NarrationPlan } from '../../src/offline/model';
import { speechKeying } from '../../src/offline/speech';

/**
 * #148, ADR 0075: a download is speech, so it waits on the Trial and the
 * Unlock. Started or resumed from the drawer, it asks first, before Consent and
 * before a task exists. While read-aloud is locked, every download that would
 * go on is paused, as Pause all pauses it: one the end of the Trial catches
 * stops at the next sentence and is paused, and so is one requeued on a return
 * to the app. Nothing goes on away from the screen for it, and an Unlock that
 * arrives by itself resumes nothing. The platform is behind the doubles of
 * `runtime-reading.test.ts`; the App Store is the pretend one, and the
 * person's answers are scripted.
 */
const mock = vi.hoisted(() => ({
  open: vi.fn<() => Promise<unknown>>(),
  sent: [] as string[],
  held: new Set<string>(),
  pending: new Map<string, () => void>(),
  appStateListeners: [] as ((state: string) => void)[],
  appStateNow: 'active',
  appState: (state: string) => {
    mock.appStateNow = state;
    mock.appStateListeners.forEach((listener) => listener(state));
  },
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
    addListener: () => ({ remove() {} }),
    beginBackground: async () => true,
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
  createProvider: () => ({
    id: 'speechify', capabilities: { wordTimestamps: true }, listVoices: async () => [],
    synthesize: (text: string) => {
      mock.sent.push(text);
      const clip: SynthesisResult = { audio: 'encoded', bytes: new Uint8Array([1]), mediaType: 'audio/mp4' };
      return new Promise<SynthesisResult>((resolve) => {
        if (mock.held.has(text)) mock.pending.set(text, () => resolve(clip));
        else resolve(clip);
      });
    },
  }),
}));
vi.mock('../../src/offline/database', () => ({ offlineRepository: () => mock.open() }));

const { configureDownloads, downloadTasks, downloadsReady, goesOn, startDownload, startDownloads, toggleTask } = await import('../../src/offline/runtime');
const consentAsked: string[] = [];
(await import('../../src/app/consent')).configureConsent({ kept: () => false, keep: () => {}, ask: async (recipient) => { consentAsked.push(recipient.key); return true; } });
const { configurePurchases } = await import('../../src/app/purchase');
const { createPurchases } = await import('../../src/purchase/purchases');
const { createFakeStore, FAKE_UNLOCKED } = await import('../../src/purchase/fake-store');
const { DAY_MS, TRIAL_MS } = await import('../../src/purchase/products');

const settings: AppSettings = {
  ...DEFAULT_SETTINGS, provider: 'speechify', enabledProviders: ['speechify'], voice: 'en-US/george',
  sentencesAtOnce: { ...DEFAULT_SENTENCES_AT_ONCE, speechify: 1 },
};
const voice = { provider: 'speechify' as const, voice: 'en-US/george', label: 'George' };
const chapter: Chapter = { id: 'a', title: 'A', depth: 0, parent: null, section: 0, texts: [], textCount: 0, textsLoaded: false, prepared: true };
const books = new Map<string, string[]>();
const saved = new Set<string>();
mock.open.mockResolvedValue({
  tasks: async () => [],
  catalog: { saveTasks: async () => {}, speechKeying: async () => speechKeying(settings) },
  plan: async (): Promise<NarrationPlan> => ({ version: 2, chapters: [chapter] }),
  chapter: async (document: string) => ({ ...chapter, texts: books.get(document) ?? [], textCount: books.get(document)?.length ?? 0, textsLoaded: true }),
  progress: async () => [],
  hasClip: async (_document: string, _voice: unknown, text: string) => saved.has(text),
  readClip: async () => ({ clip: null, dropped: false }),
  saveClip: async (_document: string, _voice: unknown, text: string) => { saved.add(text); return true; },
  inventory: async () => [],
  savedVoices: async () => [],
});

const clock = { now: Date.UTC(2026, 9, 9, 12) };
const asked: string[] = [];
const answers: { trial: 'start' | 'not-now'; ended: 'unlock' | 'restore' | 'not-now' } = { trial: 'not-now', ended: 'not-now' };
let store = createFakeStore({ ...FAKE_UNLOCKED, unlocked: false }, { now: () => clock.now });
function configure(state: Parameters<typeof createFakeStore>[0]) {
  store = createFakeStore(state, { now: () => clock.now });
  let record = { unlocked: false, trialStartedAt: null as number | null };
  configurePurchases(createPurchases({
    lockOn: true,
    store,
    record: { load: () => record, save: (next) => { record = next; } },
    now: () => clock.now,
    log: () => {},
    ask: {
      canAsk: () => true,
      trial: async (price) => { asked.push(`trial ${price}`); return answers.trial; },
      ended: async (price) => { asked.push(`ended ${price}`); return answers.ended; },
      unavailable: async () => { asked.push('unavailable'); },
      nothingToRestore: async () => { asked.push('nothing to restore'); },
    },
  }));
}
configure({ ...FAKE_UNLOCKED, unlocked: false });
configureDownloads(settings);
startDownloads();
await vi.waitFor(() => expect(downloadsReady()).toBe(true));

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const release = async (text: string) => {
  await vi.waitFor(() => expect(mock.pending.has(text)).toBe(true));
  mock.pending.get(text)!();
  mock.pending.delete(text);
};

beforeEach(() => {
  asked.length = 0;
  consentAsked.length = 0;
  mock.sent.length = 0;
  answers.trial = 'not-now';
  answers.ended = 'not-now';
});

describe('a download started from the drawer while read-aloud is locked', () => {
  it('asks about the Trial before Consent and before its task exists; Not Now leaves nothing', async () => {
    configure({ ...FAKE_UNLOCKED, unlocked: false });
    books.set('refused', ['One.']);
    expect(await startDownload('refused', voice, ['a'])).toBe(false);
    expect(asked).toEqual(['trial $4.99']);
    expect(consentAsked).toEqual([]);
    expect(downloadTasks('refused')).toEqual([]);
  });

  it('starts once the Trial does, and is written', async () => {
    configure({ ...FAKE_UNLOCKED, unlocked: false });
    answers.trial = 'start';
    books.set('trial', ['Two.']);
    expect(await startDownload('trial', voice, ['a'])).toBe(true);
    expect(asked).toEqual(['trial $4.99']);
    expect(consentAsked).toEqual(['provider:speechify']);
    await vi.waitFor(() => expect(downloadTasks('trial')[0]?.state).toBe('done'));
    expect(mock.sent).toContain('Two.');
  });
});

describe('a download the end of the Trial catches', () => {
  it('stops at the next sentence and is paused, and an Unlock arriving by itself resumes nothing', async () => {
    configure({ ...FAKE_UNLOCKED, unlocked: false, trialStartedAt: clock.now - TRIAL_MS + DAY_MS });
    const texts = ['Three one.', 'Three two.', 'Three three.'];
    for (const text of texts) mock.held.add(text);
    books.set('caught', texts);
    expect(await startDownload('caught', voice, ['a'])).toBe(true);
    await release('Three one.');
    // The Trial ends while the second sentence is out.
    await vi.waitFor(() => expect(mock.pending.has('Three two.')).toBe(true));
    clock.now += DAY_MS;
    await release('Three two.');
    const task = downloadTasks('caught')[0]!;
    await vi.waitFor(() => expect(task.state).toBe('paused'));
    // Paused as Pause all pauses: the drawer offers Resume all.
    expect(task.paused).toEqual(['a']);
    expect(goesOn(task)).toBe(false);
    await tick();
    expect(mock.sent).not.toContain('Three three.');
    expect(asked).toEqual([]);

    // Bought on another device, or approved by a parent: nothing resumes by itself.
    store.set({ ...store.state(), unlocked: true });
    await tick();
    expect(task.state).toBe('paused');
    expect(mock.sent).not.toContain('Three three.');

    // Resume all goes on, with no question now.
    toggleTask(task);
    await release('Three three.');
    await vi.waitFor(() => expect(task.state).toBe('done'));
    expect(asked).toEqual([]);
  });

  it('asks before Resume all goes on after the Trial, and resumes once the Unlock is bought', async () => {
    configure({ ...FAKE_UNLOCKED, unlocked: true });
    books.set('paused', ['Four.']);
    expect(await startDownload('paused', voice, ['a'])).toBe(true);
    const task = downloadTasks('paused')[0]!;
    await vi.waitFor(() => expect(task.state).toBe('done'));
    task.state = 'paused';
    task.paused = ['a'];
    saved.delete('Four.');
    configure({ ...FAKE_UNLOCKED, unlocked: false, trialStartedAt: clock.now - TRIAL_MS - DAY_MS });
    toggleTask(task);
    await vi.waitFor(() => expect(asked).toEqual(['ended $4.99']));
    expect(task.paused).toEqual(['a']);
    answers.ended = 'unlock';
    toggleTask(task);
    await vi.waitFor(() => expect(asked).toEqual(['ended $4.99', 'ended $4.99']));
    await vi.waitFor(() => expect(task.state).toBe('done'));
  });
});

describe('a return to the app while read-aloud is locked', () => {
  it('pauses a download that would go on, and submits no continued task for it', async () => {
    configure({ ...FAKE_UNLOCKED, unlocked: true });
    books.set('away', ['Five one.', 'Five two.']);
    mock.held.add('Five one.');
    expect(await startDownload('away', voice, ['a'])).toBe(true);
    const task = downloadTasks('away')[0]!;
    await vi.waitFor(() => expect(mock.pending.has('Five one.')).toBe(true));
    // Away, the Trial ends with the app not running its timers: on the return
    // the download is requeued, as after the background time, and then paused.
    configure({ ...FAKE_UNLOCKED, unlocked: false, trialStartedAt: clock.now - TRIAL_MS - DAY_MS });
    await tick();
    mock.submitContinued.mockClear();
    task.state = 'interrupted';
    mock.appState('background');
    mock.appState('active');
    await vi.waitFor(() => expect(task.state).toBe('paused'));
    expect(mock.submitContinued).not.toHaveBeenCalled();
    mock.pending.get('Five one.')?.();
    mock.pending.delete('Five one.');
    await tick();
    expect(mock.sent).not.toContain('Five two.');
    expect(asked).toEqual([]);
  });
});
