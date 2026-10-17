import { afterEach, expect, it, vi } from 'vitest';
import { purchaseCache, parseCache, type PurchaseCache } from '../../src/purchase/cache';
import { createFakeStore, FAKE_SOURCE, FAKE_UNLOCKED, fakeStateFor } from '../../src/purchase/fake-store';
import { PRODUCTS, TRIAL_PRODUCT, UNLOCK_PRODUCT } from '../../src/purchase/products';
import { createPurchases, type Purchases } from '../../src/purchase/purchases';
import { EMPTY_RECORD } from '../../src/purchase/record';
import type { Store, StoreSnapshot, StoreTransaction } from '../../src/purchase/store';

const SOURCE = { environment: 'production', appTransactionId: 'owner' } as const;
const EMPTY: StoreSnapshot = { source: SOURCE, owned: [], revoked: [] };
const NOW = Date.UTC(2026, 9, 17);
const controllers: Purchases[] = [];
afterEach(() => { controllers.splice(0).forEach((controller) => controller.stop()); vi.useRealTimers(); });

function setup(options: { cache?: PurchaseCache; snapshot?: () => Promise<StoreSnapshot>; store?: Partial<Store> } = {}) {
  let saved: PurchaseCache | null = options.cache ?? null;
  let listener: (event: StoreTransaction) => void = () => {};
  const asked: string[] = [];
  const store: Store = {
    ...createFakeStore({ ...FAKE_UNLOCKED, unlocked: false }, { now: () => NOW }),
    snapshot: options.snapshot ?? (async () => EMPTY),
    listen: (next) => { listener = next; return () => {}; },
    ...options.store,
  };
  const controller = createPurchases({
    lockOn: true, store, record: { load: () => saved, save: (next) => { saved = next; } },
    now: () => NOW, log: () => {}, verificationTimeoutMs: 100,
    ask: {
      canAsk: () => true, trial: async () => 'start', ended: async () => 'not-now',
      unavailable: async (reason) => { asked.push(reason ?? 'products'); }, nothingToRestore: async () => { asked.push('nothing'); },
    },
  });
  controllers.push(controller);
  controller.start();
  return { controller, asked, saved: () => saved, event: (event: StoreTransaction) => listener(event) };
}

it('rejects legacy, malformed and unknown-version caches instead of assigning them a production source', () => {
  const good = purchaseCache(SOURCE, { unlocked: true, trialStartedAt: null });
  expect(parseCache(JSON.parse(JSON.stringify(good)))).toEqual(good);
  for (const value of [null, {}, { unlocked: true, trialStartedAt: null }, { ...good, version: 3 },
    { ...good, source: { ...SOURCE, environment: 'unavailable' } }, { ...good, source: { ...SOURCE, appTransactionId: '' } },
    { ...good, record: { unlocked: true, trialStartedAt: 'never' } }]) expect(parseCache(value)).toBeNull();
});

it('never authorizes a kept Unlock before the first source read finishes', async () => {
  let answer!: (value: StoreSnapshot) => void;
  const { controller } = setup({ cache: purchaseCache(SOURCE, { unlocked: true, trialStartedAt: null }),
    snapshot: () => new Promise((resolve) => { answer = resolve; }) });
  expect(controller.allowsSpeech()).toBe(false);
  expect(controller.settled()).toBe(false);
  answer(EMPTY);
  await controller.ready();
  expect(controller.allowsSpeech()).toBe(true);
});

it('a failed verification preserves the cache, does not call it Trial ended, and can recover on Restore', async () => {
  const cache = purchaseCache(SOURCE, { unlocked: true, trialStartedAt: null });
  let fails = true;
  const { controller, saved, asked } = setup({ cache, snapshot: async () => { if (fails) throw new Error('offline'); return EMPTY; } });
  await controller.ready();
  expect(controller.access()).toEqual({ kind: 'unavailable' });
  expect(await controller.askForSpeech()).toBe(false);
  expect(asked).toEqual(['verification']);
  expect(saved()).toEqual(cache);
  fails = false;
  expect(await controller.restore()).toBe(true);
  expect(controller.access()).toEqual({ kind: 'unlocked' });
});

it('bounds verification and ignores the late result after timing out', async () => {
  vi.useFakeTimers();
  let answer!: (value: StoreSnapshot) => void;
  const cache = purchaseCache(SOURCE, { unlocked: true, trialStartedAt: null });
  const { controller, saved } = setup({ cache, snapshot: () => new Promise((resolve) => { answer = resolve; }) });
  await vi.advanceTimersByTimeAsync(100);
  await controller.ready();
  expect(controller.access()).toEqual({ kind: 'unavailable' });
  answer({ ...EMPTY, source: { ...SOURCE, appTransactionId: 'other' } });
  await Promise.resolve();
  expect(saved()).toEqual(cache);
  expect(controller.allowsSpeech()).toBe(false);
});

it('a verified current entitlement can authorize without a reusable identity, but is never cached', async () => {
  const { controller, saved } = setup({ snapshot: async () => ({ source: null, owned: [{ productId: UNLOCK_PRODUCT, purchaseDate: NOW }], revoked: [] }) });
  await controller.ready();
  expect(controller.allowsSpeech()).toBe(true);
  expect(saved()).toBeNull();
});

it('a new verified purchase carries its signed date and source, without relying on a later entitlement read', async () => {
  const date = NOW - 5000;
  const { controller, saved } = setup({ store: { purchase: async () => ({ outcome: 'purchased', transaction: {
    productId: TRIAL_PRODUCT, purchaseDate: date, revoked: false, source: SOURCE,
  } }) } });
  await controller.ready();
  expect(await controller.startTrial()).toBe(true);
  expect(saved()?.record.trialStartedAt).toBe(date);
  expect(saved()?.source).toEqual(SOURCE);
});

it('an older asynchronous read cannot overwrite a newer verified purchase', async () => {
  let answer!: (value: StoreSnapshot) => void;
  let reads = 0;
  const { controller, saved } = setup({ snapshot: () => ++reads === 1 ? Promise.resolve(EMPTY) : new Promise((resolve) => { answer = resolve; }),
    store: { purchase: async () => ({ outcome: 'purchased', transaction: {
      productId: UNLOCK_PRODUCT, purchaseDate: NOW, revoked: false, source: SOURCE,
    } }) } });
  await controller.ready();
  const old = controller.refresh();
  expect(await controller.unlock()).toBe(true);
  answer({ ...EMPTY, revoked: [UNLOCK_PRODUCT] });
  await old;
  expect(controller.allowsSpeech()).toBe(true);
  expect(saved()?.record.unlocked).toBe(true);
});

it('applies a same-source refund and does not apply a different-source refund', async () => {
  const { controller, event } = setup({ cache: purchaseCache(SOURCE, { unlocked: true, trialStartedAt: null }) });
  await controller.ready();
  event({ productId: UNLOCK_PRODUCT, purchaseDate: NOW, revoked: true, source: { ...SOURCE, appTransactionId: 'other' } });
  await controller.refresh();
  expect(controller.allowsSpeech()).toBe(true);
  event({ productId: UNLOCK_PRODUCT, purchaseDate: NOW, revoked: true, source: SOURCE });
  expect(controller.allowsSpeech()).toBe(false);
});

it('a refund discovered at launch clears only the verified source record', async () => {
  const { controller, saved } = setup({ cache: purchaseCache(SOURCE, { unlocked: true, trialStartedAt: null }),
    snapshot: async () => ({ ...EMPTY, revoked: [UNLOCK_PRODUCT] }) });
  await controller.ready();
  expect(controller.access()).toEqual({ kind: 'not-started' });
  expect(saved()?.record).toEqual(EMPTY_RECORD);
});

it('stopping a controller prevents its pending read from saving over the replacement controller', async () => {
  let answer!: (value: StoreSnapshot) => void;
  const { controller, saved } = setup({ snapshot: () => new Promise((resolve) => { answer = resolve; }) });
  controller.stop();
  answer({ ...EMPTY, owned: [{ productId: UNLOCK_PRODUCT, purchaseDate: NOW }] });
  await controller.ready();
  expect(saved()).toBeNull();
});

it('a new Play waits for a foreground source recheck instead of using the old identity', async () => {
  let answer!: (value: StoreSnapshot) => void;
  let reads = 0;
  const { controller } = setup({ cache: purchaseCache(SOURCE, { unlocked: true, trialStartedAt: null }),
    snapshot: () => ++reads === 1 ? Promise.resolve(EMPTY) : reads === 2
      ? new Promise((resolve) => { answer = resolve; }) : Promise.resolve({ ...EMPTY, source: null }) });
  await controller.ready();
  const checking = controller.refresh();
  expect(controller.canStartSpeech()).toBe(false);
  expect(controller.allowsSpeech()).toBe(true); // a Reading already allowed is not revoked mid-read
  let verdict: boolean | undefined;
  const press = controller.askForSpeech().then((yes) => { verdict = yes; });
  await Promise.resolve();
  await Promise.resolve();
  expect(verdict).toBeUndefined();
  answer({ ...EMPTY, source: null });
  await checking;
  await press;
  expect(verdict).toBe(false);
});

it('the device harness can independently exercise unavailable verification and Restore outcomes', async () => {
  const failed = fakeStateFor(FAKE_UNLOCKED, { verification: 'unavailable', restoreOutcome: 'failed' }, NOW)!;
  const fake = createFakeStore(failed, { now: () => NOW });
  await expect(fake.snapshot(PRODUCTS)).rejects.toThrow('verification');
  await expect(fake.sync()).rejects.toThrow('Restore failed');
  fake.set(fakeStateFor(failed, { verification: 'available', restoreOutcome: 'cancelled' }, NOW)!);
  expect((await fake.snapshot(PRODUCTS)).owned).toHaveLength(1);
  expect(await fake.sync()).toBe('cancelled');
  expect(fakeStateFor(failed, { verification: 'invented' }, NOW)).toBeNull();
  expect(fakeStateFor(failed, { restoreOutcome: 'invented' }, NOW)).toBeNull();
});

it('a fake store keeps test-only provenance and never pretends to be production', async () => {
  const fake = createFakeStore(FAKE_UNLOCKED, { now: () => NOW });
  expect((await fake.snapshot(PRODUCTS)).source).toEqual(FAKE_SOURCE);
  expect(FAKE_SOURCE.environment).toBe('xcode');
});
