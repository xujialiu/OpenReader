import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configurePurchases, NOTHING_TO_RESTORE, purchases, UNAVAILABLE } from '../../src/app/purchase';
import { alertAsker } from '../../src/app/purchase-alert';
import { DAY_MS, TRIAL_MS, TRIAL_PRODUCT, UNLOCK_PRODUCT } from '../../src/purchase/products';
import { createPurchases } from '../../src/purchase/purchases';
import { storeKitStore } from '../../src/purchase/storekit';
import type { StorePurchase } from '../../src/purchase/store';

/**
 * Real: `storeKitStore()` (the adapter over the Swift module), `createPurchases`
 * with the lock on, `alertAsker`, and the app's one controller in
 * `src/app/purchase.ts`, whose `purchases.restore()` is what the Purchase
 * page's Restore Purchase row calls (`purchase-screen.tsx`).
 *
 * Doubled: the Swift module (`storeNative`), the phone's `Alert` and
 * `AppState`, the fallback record (in memory) and the clock (pinned).
 */
const NOW = Date.UTC(2026, 9, 11, 12);

/** A native network failure after Expo's error wrapping. No message text is classified. */
const NO_NETWORK = () => new Error('UnexpectedException: The operation couldn’t be completed. (NSURLErrorDomain error -1009.)');

const phone = vi.hoisted(() => ({
  /** The title of every alert raised, in order. */
  alerts: [] as string[],
  /** Which button of the ended alert is pressed. */
  press: 'Not Now',
  sync: (): Promise<'restored' | 'cancelled'> => Promise.resolve('restored'),
  purchase: (): Promise<StorePurchase> => Promise.resolve({ outcome: 'cancelled' }),
  owned: [] as { productId: string; purchaseDate: number }[],
}));

vi.mock('react-native', () => ({
  AppState: { currentState: 'active' },
  Alert: {
    alert(title: string, _message: string, buttons: { text: string; onPress(): void }[]) {
      phone.alerts.push(title);
      (buttons.find((button) => button.text === phone.press) ?? buttons[0]).onPress();
    },
  },
}));
vi.mock('../../modules/open-reader-store', () => ({
  storeNative: {
    products: async () => [
      { id: TRIAL_PRODUCT, displayName: '30-day Trial', displayPrice: '$0.00' },
      { id: UNLOCK_PRODUCT, displayName: 'Unlock Read Aloud', displayPrice: '$4.99' },
    ],
    purchase: () => phone.purchase(),
    snapshot: async () => ({ source: { environment: 'production', appTransactionId: 'owner' }, owned: phone.owned, revoked: [] }),
    sync: () => phone.sync(),
    addListener: () => ({ remove() {} }),
  },
}));

/** The Debug Log's `purchase` lines. */
let logged: string[] = [];

async function launch(): Promise<void> {
  configurePurchases(createPurchases({
    lockOn: true,
    store: storeKitStore(),
    record: { load: () => null, save: () => {} },
    ask: alertAsker,
    now: () => NOW,
    log: (line) => logged.push(line),
  }));
  await purchases.ready();
}

beforeEach(() => {
  logged = [];
  phone.alerts = [];
  phone.press = 'Not Now';
  phone.sync = () => Promise.resolve('restored');
  phone.purchase = () => Promise.resolve({ outcome: 'cancelled' });
  phone.owned = [];
});
afterEach(() => configurePurchases(null));

describe('completed and cancelled operations', () => {
  it('a restore that finishes with nothing owned says No Purchase Found', async () => {
    await launch();
    expect(await purchases.restore()).toBe(false);
    expect(phone.alerts).toEqual([NOTHING_TO_RESTORE.title]);
  });

  it('a sign-in the owner cancelled says nothing (decision of 2026-10-09)', async () => {
    await launch();
    phone.sync = () => Promise.resolve('cancelled');
    expect(await purchases.restore()).toBe(false);
    expect(phone.alerts).toEqual([]);
  });

  it('a purchase that fails for want of the App Store says Purchases Unavailable', async () => {
    await launch();
    phone.purchase = () => Promise.reject(NO_NETWORK());
    expect(await purchases.unlock()).toBe(false);
    expect(phone.alerts).toEqual([UNAVAILABLE.title]);
  });
});

describe('Restore Purchase when the App Store cannot be reached', () => {
  it('tells the owner something from Settings > Purchase > Restore Purchase', async () => {
    await launch();
    phone.sync = () => Promise.reject(NO_NETWORK());
    expect(await purchases.restore()).toBe(false);
    expect(phone.alerts, `Debug Log: ${logged.at(-1)}`).toEqual([UNAVAILABLE.title]);
  });

  it('tells the owner something from the ended alert\'s Restore Purchase', async () => {
    phone.owned = [{ productId: TRIAL_PRODUCT, purchaseDate: NOW - TRIAL_MS - DAY_MS }];
    await launch();
    phone.press = 'Restore Purchase';
    phone.sync = () => Promise.reject(NO_NETWORK());
    expect(await purchases.askForSpeech()).toBe(false);
    expect(phone.alerts, `Debug Log: ${logged.at(-1)}`).toEqual(['Your Free Trial Has Ended', UNAVAILABLE.title]);
  });

  it.each(['Request Canceled', '无法连接商店', 'Unknown error'])('does not infer cancellation from the error text: %s', async (message) => {
    await launch();
    phone.sync = () => Promise.reject(new Error(message));
    expect(await purchases.restore()).toBe(false);
    expect(phone.alerts).toEqual([UNAVAILABLE.title]);
  });

  it('can retry and restore successfully after a failed attempt', async () => {
    await launch();
    phone.sync = () => Promise.reject(NO_NETWORK());
    expect(await purchases.restore()).toBe(false);
    phone.alerts = [];
    phone.sync = async () => {
      phone.owned = [{ productId: UNLOCK_PRODUCT, purchaseDate: NOW }];
      return 'restored';
    };
    expect(await purchases.restore()).toBe(true);
    expect(purchases.access()).toEqual({ kind: 'unlocked' });
    expect(phone.alerts).toEqual([]);
  });

  it('keeps cancellation from the ended alert silent and does not change the Trial', async () => {
    phone.owned = [{ productId: TRIAL_PRODUCT, purchaseDate: NOW - TRIAL_MS - DAY_MS }];
    await launch();
    phone.press = 'Restore Purchase';
    phone.sync = async () => 'cancelled';
    expect(await purchases.askForSpeech()).toBe(false);
    expect(purchases.access()).toEqual({ kind: 'ended' });
    expect(phone.alerts).toEqual(['Your Free Trial Has Ended']);
  });
});
