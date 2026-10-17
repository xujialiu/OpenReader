import Module from 'node:module';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configurePurchases } from '../../src/app/purchase';
import { alertAsker } from '../../src/app/purchase-alert';
import { DEFAULT_SETTINGS } from '../../src/app/settings';
import { useReading, type Reading } from '../../src/app/use-reading';
import { useNowPlaying } from '../../src/now-playing';
import { createFakeStore, FAKE_UNLOCKED, type FakeStoreState } from '../../src/purchase/fake-store';
import { TRIAL_MS } from '../../src/purchase/products';
import { createPurchases } from '../../src/purchase/purchases';
import type { ReportedBlock } from '../../src/renderer/messages';

/**
 * Real: `useReading` (so `play()`), `useNowPlaying` and `restateNowPlaying`,
 * the one controller of `src/app/purchase.ts` over `createPurchases`, and
 * `alertAsker`. Doubled: the phone (`AppState`, `Alert`, the Swift Now Playing
 * module), the App Store (`fake-store.ts`), the renderer's bridge and the
 * playback engine, as `test/app/use-reading-resume.test.ts` doubles them.
 */
const phone = vi.hoisted(() => ({
  state: 'active' as 'active' | 'inactive' | 'background',
  /** Every alert raised, with where the app was when it went up. */
  alerts: [] as { title: string; appWas: string }[],
  /** Every `playing` the Swift module was told to show. */
  nowPlaying: [] as boolean[],
  /** The Lock Screen's button, once the app listens for it. */
  remote: null as null | ((event: { command: 'play' }) => void),
}));
const doubles = vi.hoisted(() => ({
  onBlocks: null as null | ((blocks: readonly unknown[], section: { index: number; href: string; spine: number }) => void),
  engines: [] as { clock: { onClip(cue: { utterance: number; words: null; duration: number; rate: number }): void } }[],
}));

vi.mock('react-native', () => ({
  useColorScheme: () => 'light',
  Platform: { OS: 'ios' },
  AppState: { get currentState() { return phone.state; } },
  Alert: { alert: (title: string) => { phone.alerts.push({ title, appWas: phone.state }); } },
}));
vi.mock('../../src/renderer', async () => ({
  ...(await vi.importActual<typeof import('../../src/renderer/cursor')>('../../src/renderer/cursor')),
  useReaderBridge: (options: { onBlocks: typeof doubles.onBlocks }) => {
    doubles.onBlocks = options.onBlocks;
    // Every call the hook makes on the page does nothing.
    const page: Record<string, unknown> = new Proxy({}, { get: (_, name) => (name === 'clock' ? page : name === 'readerProps' ? {} : () => {}) });
    return page;
  },
}));
vi.mock('../../src/playback', () => ({
  createPlaybackEngine: (deps: (typeof doubles.engines)[number]) => {
    doubles.engines.push(deps);
    return new Proxy({}, { get: (_, name) => (name === 'snapshot' ? () => ({ playing: false, utterance: 0, rate: 1, queued: 0, fetching: 0 }) : name === 'dispose' ? async () => {} : () => {}) });
  },
}));
vi.mock('../../src/offline/runtime', () => ({
  hasSavedVoice: () => false,
  inventoryReady: () => true,
  offlineProvider: () => ({ capabilities: { wordTimestamps: false } }),
}));
vi.mock('../../src/app/body-text-sizes', () => ({ readBodyTextSize: () => null, writeBodyTextSize: () => {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// The Swift module, which `src/now-playing` loads with `require`.
const loader = Module as unknown as { _load(request: string, ...rest: unknown[]): unknown };
const load = loader._load;
loader._load = function (request: string, ...rest: unknown[]) {
  if (!request.endsWith('modules/open-reader-now-playing')) return load.call(this, request, ...rest);
  return { default: {
    show: (reading: { playing: boolean }) => { phone.nowPlaying.push(reading.playing); },
    setPosition() {},
    hide() {},
    addListener: (_name: string, listener: typeof phone.remote) => { phone.remote = listener; return { remove() {} }; },
  } };
};
afterAll(() => { loader._load = load; });

const mounted = new Set<ReactTestRenderer>();
const START = Date.UTC(2026, 9, 11, 12);
const NOT_STARTED: FakeStoreState = { ...FAKE_UNLOCKED, unlocked: false };
const BLOCKS: ReportedBlock[] = [{ id: '0.0', text: 'Chapter one begins here.', role: 'paragraph', section: 's0.xhtml', sectionIndex: 0, cfi: 'epubcfi(/6/2[s0]!/4/2)' }];

/** A Document open in the Reader, its first section on the page, and a build with the lock asking this App Store. */
async function open(state: FakeStoreState) {
  const clock = { now: START };
  const store = createFakeStore(state, { now: () => clock.now });
  configurePurchases(createPurchases({
    lockOn: true,
    store,
    record: { load: () => null, save: () => {} },
    ask: alertAsker,
    now: () => clock.now,
    log: () => {},
  }));
  let reading: Reading;
  const settings = { ...DEFAULT_SETTINGS, provider: 'local' as const, enabledProviders: ['local' as const], voice: 'af_bella' };
  function Probe() {
    const now = useReading(settings, { hasKey: false, writtenAt: 0 }, null, 'sha256:' + 'f'.repeat(64));
    reading = now;
    // As `reading-view.tsx` wires the two hooks, without its wait for sync before `reading.play()`.
    useNowPlaying({
      title: 'A Document', chapter: '', cover: null, playing: now.status.playing, rate: 1,
      live: now.status.utterance !== null,
      onIntent: (intent) => (intent === 'play' ? now.play() : now.pause()),
    });
    return null;
  }
  let tree: ReactTestRenderer;
  /** Something that happens, with everything it sets off settled before the next line. */
  const step = (what: () => void) => act(async () => {
    what();
    await new Promise((resolve) => setImmediate(resolve));
  });
  await act(async () => { tree = create(createElement(Probe)); mounted.add(tree); });
  await step(() => doubles.onBlocks!(BLOCKS, { index: 0, href: 's0.xhtml', spine: 1 }));
  return {
    clock,
    step,
    playInTheApp: () => step(() => reading.play()),
    pause: () => step(() => reading.pause()),
    lock: () => { phone.state = 'background'; },
    playOnTheLockScreen: () => step(() => phone.remote!({ command: 'play' })),
    close: () => act(async () => { tree.unmount(); mounted.delete(tree); }),
  };
}

/** A Reading the end of the Trial found playing, paused since: Now Playing shows it, and read-aloud is locked. */
async function pausedAfterTheTrialEnded() {
  const app = await open({ ...NOT_STARTED, trialStartedAt: START - TRIAL_MS + 1000 });
  await app.playInTheApp();
  await app.step(() => doubles.engines[0].clock.onClip({ utterance: 0, words: null, duration: 1, rate: 1 }));
  app.clock.now = START + 2000;
  await app.pause();
  expect(phone.nowPlaying).toEqual([true, false]);
  phone.nowPlaying.length = 0;
  return app;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  phone.state = 'active';
  phone.alerts.length = 0;
  phone.nowPlaying.length = 0;
  doubles.engines.length = 0;
});
afterEach(async () => {
  await act(async () => { for (const tree of mounted) tree.unmount(); });
  mounted.clear();
  configurePurchases(null);
  vi.useRealTimers();
});

describe('a Play on the Lock Screen after the Trial is refused, and its button goes back to Play (design 0075)', () => {
  it('with no alert open: Now Playing is told playing, then paused 400 ms later', async () => {
    const app = await pausedAfterTheTrialEnded();
    app.lock();
    await app.playOnTheLockScreen();
    await app.step(() => { vi.advanceTimersByTime(400); });

    expect(phone.alerts).toEqual([]);
    expect(phone.nowPlaying).toEqual([true, false]);
    await app.close();
  });

  it('with the ended alert open and unanswered: the same', async () => {
    const app = await pausedAfterTheTrialEnded();
    await app.playInTheApp();
    expect(phone.alerts).toEqual([{ title: 'Your Free Trial Has Ended', appWas: 'active' }]);

    app.lock();
    await app.playOnTheLockScreen();
    await app.step(() => { vi.advanceTimersByTime(400); });

    expect(phone.nowPlaying).toEqual([true, false]);
    await app.close();
  });
});
