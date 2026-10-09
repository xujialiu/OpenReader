import { describe, expect, it } from 'vitest';

import { createFakeStore, FAKE_UNLOCKED, fakeStateFor, type FakeStoreState } from '../../src/purchase/fake-store';
import { DAY_MS, TRIAL_MS, TRIAL_PRODUCT, UNLOCK_PRODUCT } from '../../src/purchase/products';
import { createPurchases, type PurchaseAsker } from '../../src/purchase/purchases';
import { EMPTY_RECORD, type PurchaseRecord } from '../../src/purchase/record';
import type { Store } from '../../src/purchase/store';

/**
 * #148, ADR 0075: the gate and the Settings rows against a pretend App Store.
 * The person's answers are scripted, and every question put is recorded.
 */
const START = Date.UTC(2026, 9, 9, 12);
const NOT_STARTED: FakeStoreState = { ...FAKE_UNLOCKED, unlocked: false };

function setup(options: {
  state?: FakeStoreState;
  record?: PurchaseRecord;
  answers?: { trial?: 'start' | 'not-now'; ended?: 'unlock' | 'restore' | 'not-now' };
  canAsk?: boolean;
  lockOn?: boolean;
  store?: Store;
} = {}) {
  const clock = { now: START };
  const asked: string[] = [];
  const saved: PurchaseRecord[] = [];
  const fake = createFakeStore(options.state ?? NOT_STARTED, { now: () => clock.now });
  const ask: PurchaseAsker = {
    canAsk: () => options.canAsk ?? true,
    trial: async (price) => { asked.push(`trial ${price}`); return options.answers?.trial ?? 'not-now'; },
    ended: async (price) => { asked.push(`ended ${price}`); return options.answers?.ended ?? 'not-now'; },
    unavailable: async () => { asked.push('unavailable'); },
    nothingToRestore: async () => { asked.push('nothing to restore'); },
  };
  const purchases = createPurchases({
    lockOn: options.lockOn ?? true,
    store: options.store ?? fake,
    record: { load: () => options.record ?? EMPTY_RECORD, save: (record) => saved.push(record) },
    ask,
    now: () => clock.now,
    log: () => {},
    productTimeoutMs: 50,
  });
  purchases.start();
  return { purchases, fake, asked, saved, clock };
}

describe('the gate in front of a press of Play or a download', () => {
  it('asks nothing and calls nothing in a build without the lock', async () => {
    const { purchases, fake, asked } = setup({ lockOn: false });
    expect(purchases.allowsSpeech()).toBe(true);
    expect(await purchases.askForSpeech()).toBe(true);
    expect(asked).toEqual([]);
    expect(fake.calls).toEqual({ products: 0, purchase: 0, entitlements: 0, sync: 0 });
    expect(purchases.access()).toEqual({ kind: 'off' });
  });

  it('lets someone with the Unlock through without a question', async () => {
    const { purchases, asked } = setup({ state: FAKE_UNLOCKED });
    await purchases.ready();
    expect(purchases.allowsSpeech()).toBe(true);
    expect(await purchases.askForSpeech()).toBe(true);
    expect(asked).toEqual([]);
  });

  it('offers the Trial at the price of the Unlock, and starting it lets the press go on', async () => {
    const { purchases, asked, saved, clock } = setup({ answers: { trial: 'start' } });
    await purchases.ready();
    expect(purchases.allowsSpeech()).toBe(false);
    expect(await purchases.askForSpeech()).toBe(true);
    expect(asked).toEqual(['trial $4.99']);
    expect(purchases.access()).toEqual({ kind: 'trial', endsAt: START + TRIAL_MS });
    expect(saved.at(-1)).toEqual({ unlocked: false, trialStartedAt: START });
    clock.now = START + TRIAL_MS - 1;
    expect(purchases.allowsSpeech()).toBe(true);
    clock.now = START + TRIAL_MS;
    expect(purchases.allowsSpeech()).toBe(false);
    expect(purchases.access()).toEqual({ kind: 'ended' });
  });

  it('starts nothing on Not Now, and asks again at the next press', async () => {
    const { purchases, asked, fake } = setup();
    expect(await purchases.askForSpeech()).toBe(false);
    expect(await purchases.askForSpeech()).toBe(false);
    expect(asked).toEqual(['trial $4.99', 'trial $4.99']);
    expect(fake.calls.purchase).toBe(0);
  });

  it('after the Trial offers the Unlock, and buying it speaks for good', async () => {
    const { purchases, asked, clock } = setup({ state: { ...NOT_STARTED, trialStartedAt: START - TRIAL_MS - DAY_MS }, answers: { ended: 'unlock' } });
    expect(await purchases.askForSpeech()).toBe(true);
    expect(asked).toEqual(['ended $4.99']);
    expect(purchases.access()).toEqual({ kind: 'unlocked' });
    clock.now = START + 400 * DAY_MS;
    expect(purchases.allowsSpeech()).toBe(true);
  });

  it('restores an Unlock StoreKit had not reported, from the alert', async () => {
    const store = createFakeStore({ ...FAKE_UNLOCKED, trialStartedAt: START - TRIAL_MS - DAY_MS }, { now: () => START });
    // Owned, but read back only once the App Store is asked again.
    const hidden: Store = { ...store, entitlements: async () => (store.calls.sync ? store.entitlements() : []), listen: () => () => {} };
    const { purchases, asked } = setup({ store: hidden, record: { unlocked: false, trialStartedAt: START - TRIAL_MS - DAY_MS }, answers: { ended: 'restore' } });
    await purchases.ready();
    expect(purchases.access()).toEqual({ kind: 'ended' });
    expect(await purchases.askForSpeech()).toBe(true);
    expect(asked).toEqual(['ended $4.99']);
    expect(purchases.access()).toEqual({ kind: 'unlocked' });
  });

  it('says the App Store is out of reach when no product loads, and lets nothing through', async () => {
    const { purchases, asked } = setup({ state: { ...NOT_STARTED, products: false } });
    expect(await purchases.askForSpeech()).toBe(false);
    expect(asked).toEqual(['unavailable']);
    expect(purchases.unavailable()).toBe(true);
  });

  it('treats a bundle ID with nothing to sell as out of reach', async () => {
    const store = createFakeStore(NOT_STARTED, { now: () => START });
    const { purchases, asked } = setup({ store: { ...store, products: async () => [] } });
    expect(await purchases.askForSpeech()).toBe(false);
    expect(asked).toEqual(['unavailable']);
  });

  it('gives up waiting for products that never come', async () => {
    const store = createFakeStore(NOT_STARTED, { now: () => START });
    const { purchases, asked } = setup({ store: { ...store, products: () => new Promise(() => {}) } });
    expect(await purchases.askForSpeech()).toBe(false);
    expect(asked).toEqual(['unavailable']);
  });

  it('puts no question with the app away from the screen, and lets nothing through', async () => {
    const { purchases, asked } = setup({ canAsk: false });
    expect(await purchases.askForSpeech()).toBe(false);
    expect(asked).toEqual([]);
  });

  it('puts one question however many presses wait on it', async () => {
    let answer: (choice: 'start' | 'not-now') => void = () => {};
    const store = createFakeStore(NOT_STARTED, { now: () => START });
    const asked: string[] = [];
    const purchases = createPurchases({
      lockOn: true, store, record: { load: () => EMPTY_RECORD, save: () => {} }, now: () => START, log: () => {},
      ask: {
        canAsk: () => true,
        trial: () => { asked.push('trial'); return new Promise((resolve) => { answer = resolve; }); },
        ended: async () => 'not-now',
        unavailable: async () => {},
        nothingToRestore: async () => {},
      },
    });
    purchases.start();
    const first = purchases.askForSpeech();
    const second = purchases.askForSpeech();
    await new Promise((resolve) => setTimeout(resolve, 0));
    answer('start');
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(asked).toEqual(['trial']);
  });

  it('lets nothing through when the purchase was cancelled, is waiting for a parent, or failed', async () => {
    for (const outcome of ['cancelled', 'pending', 'failed'] as const) {
      const { purchases, asked } = setup({ state: { ...NOT_STARTED, outcome }, answers: { trial: 'start' } });
      expect(await purchases.askForSpeech()).toBe(false);
      expect(asked).toEqual(outcome === 'failed' ? ['trial $4.99', 'unavailable'] : ['trial $4.99']);
    }
  });
});

describe('what is owned', () => {
  it('keeps an Unlock StoreKit stops reporting (FB22556883), until a refund is reported', async () => {
    const store = createFakeStore(NOT_STARTED, { now: () => START });
    const { purchases } = setup({ store, record: { unlocked: true, trialStartedAt: null } });
    await purchases.ready();
    expect(purchases.access()).toEqual({ kind: 'unlocked' });
    store.set({ ...store.state(), unlocked: true });
    store.revoke(UNLOCK_PRODUCT);
    expect(purchases.access()).toEqual({ kind: 'not-started' });
  });

  it('hears of an Unlock bought on another device, or approved by a parent, by itself', async () => {
    const { purchases, fake } = setup();
    await purchases.ready();
    let heard = 0;
    purchases.subscribe(() => heard++);
    fake.set({ ...fake.state(), unlocked: true });
    expect(purchases.allowsSpeech()).toBe(true);
    expect(heard).toBeGreaterThan(0);
  });

  it('keeps the Trial\'s date across launches through the record, and does not start a second Trial', async () => {
    const { purchases } = setup({ record: { unlocked: false, trialStartedAt: START - 10 * DAY_MS } });
    await purchases.ready();
    expect(purchases.access()).toEqual({ kind: 'trial', endsAt: START - 10 * DAY_MS + TRIAL_MS });
  });
});

describe('the Settings rows', () => {
  it('starts the Trial through the same disclosure', async () => {
    const { purchases, asked } = setup({ answers: { trial: 'start' } });
    expect(await purchases.startTrial()).toBe(true);
    expect(asked).toEqual(['trial $4.99']);
  });

  it('buys the Unlock with no alert of ours: the App Store\'s own sheet is the confirmation', async () => {
    const { purchases, asked, fake } = setup();
    expect(await purchases.unlock()).toBe(true);
    expect(asked).toEqual([]);
    expect(fake.calls.purchase).toBe(1);
    expect(purchases.access()).toEqual({ kind: 'unlocked' });
  });

  it('restores, and says whether the app may speak afterwards', async () => {
    const { purchases, fake } = setup();
    expect(await purchases.restore()).toBe(false);
    expect(fake.calls.sync).toBe(1);
  });

  it('knows the price once the products have loaded', async () => {
    const { purchases } = setup();
    await purchases.askForSpeech();
    expect(purchases.price()).toBe('$4.99');
  });
});

describe('Restore Purchase with nothing to restore', () => {
  it('says so once the App Store has answered without an Unlock, from the Settings row', async () => {
    const { purchases, asked } = setup();
    expect(await purchases.restore()).toBe(false);
    expect(asked).toEqual(['nothing to restore']);
  });

  it('says so from the ended alert too, and nothing plays', async () => {
    const { purchases, asked } = setup({ state: { ...NOT_STARTED, trialStartedAt: START - TRIAL_MS - DAY_MS }, answers: { ended: 'restore' } });
    expect(await purchases.askForSpeech()).toBe(false);
    expect(asked).toEqual(['ended $4.99', 'nothing to restore']);
  });

  it('says so during the Trial, which goes on', async () => {
    const { purchases, asked } = setup({ state: { ...NOT_STARTED, trialStartedAt: START - DAY_MS } });
    expect(await purchases.restore()).toBe(true);
    expect(asked).toEqual(['nothing to restore']);
  });

  it('says nothing when the restore did not finish, a sign-in cancelled', async () => {
    const store = createFakeStore(NOT_STARTED, { now: () => START });
    const { purchases, asked } = setup({ store: { ...store, sync: () => Promise.reject(new Error('userCancelled')) } });
    expect(await purchases.restore()).toBe(false);
    expect(asked).toEqual([]);
  });

  it('says nothing when the Unlock is found', async () => {
    const store = createFakeStore({ ...FAKE_UNLOCKED, unlocked: true }, { now: () => START });
    const hidden: Store = { ...store, entitlements: async () => (store.calls.sync ? store.entitlements() : []), listen: () => () => {} };
    const { purchases, asked } = setup({ store: hidden });
    expect(await purchases.restore()).toBe(true);
    expect(asked).toEqual([]);
  });

  it('stays silent on a purchase waiting for a parent\'s approval', async () => {
    const { purchases, asked } = setup({ state: { ...NOT_STARTED, outcome: 'pending' } });
    expect(await purchases.unlock()).toBe(false);
    expect(asked).toEqual([]);
  });

});

describe('the harness\'s states for a build with Debug Mode', () => {
  it('reads each command against the clock', () => {
    expect(fakeStateFor(FAKE_UNLOCKED, { state: 'not-started' }, START)).toMatchObject({ unlocked: false, trialStartedAt: null, products: true });
    const trial = fakeStateFor(FAKE_UNLOCKED, { state: 'trial', days: 12 }, START)!;
    expect(trial.trialStartedAt! + TRIAL_MS - START).toBe(12 * DAY_MS - 60_000);
    const soon = fakeStateFor(FAKE_UNLOCKED, { state: 'trial', seconds: 20 }, START)!;
    expect(soon.trialStartedAt! + TRIAL_MS - START).toBe(20_000);
    expect(fakeStateFor(FAKE_UNLOCKED, { state: 'ended' }, START)!.trialStartedAt).toBeLessThan(START - TRIAL_MS);
    expect(fakeStateFor(FAKE_UNLOCKED, { state: 'unavailable' }, START)).toMatchObject({ products: false, unlocked: true });
    expect(fakeStateFor(FAKE_UNLOCKED, { outcome: 'pending' }, START)).toMatchObject({ outcome: 'pending' });
    expect(fakeStateFor(FAKE_UNLOCKED, { state: 'sideways' }, START)).toBeNull();
    expect(fakeStateFor(FAKE_UNLOCKED, { state: 'trial' }, START)).toBeNull();
  });

  it('owns the trial product once bought, as StoreKit would', async () => {
    const store = createFakeStore(NOT_STARTED, { now: () => START });
    expect(await store.purchase(TRIAL_PRODUCT)).toBe('purchased');
    expect(await store.entitlements()).toEqual([{ productId: TRIAL_PRODUCT, purchaseDate: START }]);
  });
});
