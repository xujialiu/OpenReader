import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const START = Date.UTC(2026, 9, 17, 12);
const UNLOCK = 'top.xujialiu.openreader.unlock';
const TRIAL = 'top.xujialiu.openreader.trial';
const phone = vi.hoisted(() => ({
  files: new Map<string, string>(),
  environment: 'sandbox', account: 'internal', sourceKnown: true,
  owned: [] as { productId: string; purchaseDate: number }[],
  revoked: [] as string[],
  alerts: [] as string[], nativeReads: 0,
}));
vi.mock('expo-file-system', () => {
  class Directory {
    readonly path: string;
    constructor(...parts: (string | { path: string })[]) { this.path = parts.map((part) => typeof part === 'string' ? part : part.path).join('/'); }
    create() {}
  }
  class File {
    readonly path: string;
    constructor(directory: { path: string }, name: string) { this.path = `${directory.path}/${name}`; }
    get exists() { return phone.files.has(this.path); }
    textSync() { return phone.files.get(this.path)!; }
    write(text: string) { phone.files.set(this.path, text); }
  }
  return { Directory, File, Paths: { document: { parentDirectory: new Directory('Container') } } };
});
vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  Alert: { alert(title: string, _message: string, buttons: { text: string; onPress(): void }[]) {
    phone.alerts.push(title);
    (buttons.find((button) => button.text === 'Not Now') ?? buttons[0]).onPress();
  } },
}));
vi.mock('../../modules/open-reader-store', () => ({ storeNative: {
  products: async () => [
    { id: TRIAL, displayName: '30-day Trial', displayPrice: '$0.00' },
    { id: UNLOCK, displayName: 'Unlock', displayPrice: '$4.99' },
  ],
  purchase: async () => ({ outcome: 'cancelled' }),
  snapshot: async () => {
    phone.nativeReads++;
    return { source: phone.sourceKnown ? { environment: phone.environment, appTransactionId: phone.account } : null,
      owned: phone.owned, revoked: phone.revoked };
  },
  environment: async () => phone.sourceKnown ? phone.environment : 'unavailable',
  sync: async () => 'restored',
  addListener: () => ({ remove() {} }),
} }));
vi.mock('../../src/purchase/mode', () => ({ PURCHASE_LOCK: true }));
vi.mock('../../src/debug/mode', () => ({ DEBUG_MODE: false }));

const RECORD = 'Container/Library/Application Support/purchase.json';
let stop = () => {};
async function launch(environment: string, account = 'internal') {
  stop();
  phone.environment = environment;
  phone.account = account;
  phone.alerts = [];
  vi.resetModules();
  const setup = await import('../../src/app/purchase-setup');
  const { purchases } = await import('../../src/app/purchase');
  stop = setup.startPurchases();
  await purchases.ready();
  return purchases;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: START });
  phone.files.clear();
  phone.sourceKnown = true;
  phone.nativeReads = 0;
  phone.owned = [];
  phone.revoked = [];
});
afterEach(() => { stop(); vi.useRealTimers(); });

it.each(['not-started', 'unlocked', 'ended'] as const)('free copies leave the formal %s purchase and app data untouched (#324)', async (kind) => {
  phone.owned = kind === 'unlocked' ? [{ productId: UNLOCK, purchaseDate: START }]
    : kind === 'ended' ? [{ productId: TRIAL, purchaseDate: START - 40 * 86400000 }] : [];
  expect((await launch('production')).access()?.kind).toBe(kind);
  phone.files.set('Container/Documents/library.json', 'keep documents');
  phone.files.set('Container/Library/settings.json', 'keep settings and positions');
  stop(); stop = () => {};
  const kept = [...phone.files];
  const reads = phone.nativeReads;
  vi.resetModules();
  const { purchases: free } = await import('../../src/app/purchase-free');
  const { startPurchases } = await import('../../src/app/purchase-setup-free');
  const finish = startPurchases();
  expect(await free.askForSpeech()).toBe(true);
  expect(free.access()).toEqual({ kind: 'off' });
  expect(await free.unlock()).toBe(false);
  finish();
  expect([...phone.files]).toEqual(kept);
  expect(phone.nativeReads).toBe(reads);
  phone.owned = []; // Apple's same-source empty read must retain only genuine previous ownership.
  expect((await launch('production')).access()?.kind).toBe(kind);
  expect(phone.files.get('Container/Documents/library.json')).toBe('keep documents');
  expect(phone.files.get('Container/Library/settings.json')).toBe('keep settings and positions');
});

it('does not carry a verified sandbox Unlock into production across fresh JS runtimes', async () => {
  phone.owned = [{ productId: UNLOCK, purchaseDate: START }];
  expect((await launch('sandbox')).allowsSpeech()).toBe(true);
  phone.owned = [];
  const production = await launch('production');
  expect(production.allowsSpeech()).toBe(false);
  expect(production.access()).toEqual({ kind: 'not-started' });
  await production.askForSpeech();
  expect(phone.alerts).toEqual(['Read Aloud Free for 30 Days']);
});

it('does not count an expired sandbox Trial in production', async () => {
  phone.owned = [{ productId: TRIAL, purchaseDate: START - 40 * 86400000 }];
  expect((await launch('sandbox')).access()).toEqual({ kind: 'ended' });
  phone.owned = [];
  expect((await launch('production')).access()).toEqual({ kind: 'not-started' });
});

it('does not carry a Trial to a different verified app transaction identity', async () => {
  phone.owned = [{ productId: TRIAL, purchaseDate: START - 40 * 86400000 }];
  await launch('production', 'first');
  phone.owned = [];
  expect((await launch('production', 'second')).access()).toEqual({ kind: 'not-started' });
});

/** What 1.0.0 (7), the first App Store copy, keeps: one record naming no source (#316). */
const unscoped = (record: { unlocked: boolean; trialStartedAt: number | null }) => phone.files.set(RECORD, JSON.stringify(record));

it('counts the Unlock of an unscoped record once in production, without its Trial date or touching other app data (#316)', async () => {
  unscoped({ unlocked: true, trialStartedAt: START - 40 * 86400000 });
  phone.files.set('Container/Documents/library.json', 'keep this');
  const app = await launch('production');
  expect(app.access()).toEqual({ kind: 'unlocked' });
  expect(phone.files.get('Container/Documents/library.json')).toBe('keep this');
  expect(JSON.parse(phone.files.get(RECORD)!)).toEqual({ version: 2, records: [{ version: 2,
    source: { environment: 'production', appTransactionId: 'internal' }, record: { unlocked: true, trialStartedAt: null } }] });
  // Counted once: it is now that source's record, and nobody else's.
  expect((await launch('production')).access()).toEqual({ kind: 'unlocked' });
  expect((await launch('production', 'second')).access()).toEqual({ kind: 'not-started' });
});

it('does not count an unscoped Unlock under TestFlight or Xcode (#162, #316)', async () => {
  for (const environment of ['sandbox', 'xcode']) {
    phone.files.clear();
    unscoped({ unlocked: true, trialStartedAt: null });
    const app = await launch(environment);
    expect(app.access()).toEqual({ kind: 'not-started' });
    expect(JSON.parse(phone.files.get(RECORD)!).records).toEqual([{ version: 2,
      source: { environment, appTransactionId: 'internal' }, record: { unlocked: false, trialStartedAt: null } }]);
  }
});

it('does not count an unscoped Trial date in production (#316)', async () => {
  unscoped({ unlocked: false, trialStartedAt: START - 40 * 86400000 });
  const app = await launch('production');
  expect(app.access()).toEqual({ kind: 'not-started' });
  await app.askForSpeech();
  expect(phone.alerts).toEqual(['Read Aloud Free for 30 Days']);
});

it('lets a refund StoreKit reports in production clear an unscoped Unlock (#316)', async () => {
  unscoped({ unlocked: true, trialStartedAt: null });
  phone.revoked = [UNLOCK];
  expect((await launch('production')).access()).toEqual({ kind: 'not-started' });
  phone.revoked = [];
  expect((await launch('production')).access()).toEqual({ kind: 'not-started' });
});

it('keeps an unscoped Unlock unused and on disk until a production source is verified (#316)', async () => {
  unscoped({ unlocked: true, trialStartedAt: null });
  const kept = phone.files.get(RECORD);
  phone.sourceKnown = false;
  expect((await launch('production')).allowsSpeech()).toBe(false);
  expect(phone.files.get(RECORD)).toBe(kept);
  phone.sourceKnown = true;
  expect((await launch('production')).access()).toEqual({ kind: 'unlocked' });
});

it('keeps verified production ownership through an empty read from the same source', async () => {
  phone.owned = [{ productId: UNLOCK, purchaseDate: START }];
  await launch('production');
  phone.owned = [];
  expect((await launch('production')).allowsSpeech()).toBe(true);
});

it('keeps each verified source record when switching away and back', async () => {
  phone.owned = [{ productId: UNLOCK, purchaseDate: START }];
  await launch('production');
  phone.owned = [];
  expect((await launch('sandbox')).allowsSpeech()).toBe(false);
  expect((await launch('production')).allowsSpeech()).toBe(true);
});

it('does not use or erase a kept purchase when the current source is unavailable, and retries', async () => {
  phone.owned = [{ productId: UNLOCK, purchaseDate: START }];
  await launch('production');
  const kept = phone.files.get(RECORD);
  phone.owned = [];
  phone.sourceKnown = false;
  const app = await launch('production');
  expect(app.allowsSpeech()).toBe(false);
  expect(app.access()).toEqual({ kind: 'unavailable' });
  await app.askForSpeech();
  expect(phone.alerts).toEqual(['Purchases Unavailable']);
  expect(phone.files.get(RECORD)).toBe(kept);
  phone.sourceKnown = true;
  expect(await app.askForSpeech()).toBe(true);
  expect(app.access()).toEqual({ kind: 'unlocked' });
});
