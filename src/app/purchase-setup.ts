/**
 * The Trial and the Unlock configured as the app starts (#148, ADR 0075):
 * which App Store, where the device's fallback record is kept, and how the
 * person is asked. The shell calls `startPurchases` before the downloads start,
 * as it configures Consent, because a download left queued may be about to
 * speak.
 *
 * - **A build without the lock** configures nothing: everything speaks, and no
 *   StoreKit call is ever made.
 * - **A build with the lock and without Debug Mode**, which is every build
 *   that leaves the Mac for the App Store or TestFlight, asks StoreKit, and
 *   keeps its fallback record in `Library/Application Support/purchase.json`.
 *   Under Library the Files app never shows it, and nothing writes it into
 *   Shared Settings or a Settings Backup.
 * - **A build with Debug Mode** asks a pretend App Store instead, which starts
 *   as if the Unlock were owned, so that every test pressing Play plays, and
 *   which the walkthrough harness can put into any state, or swap for StoreKit
 *   (`storeCommand`; `test/manual-test/README.md`, "The Trial and the Unlock").
 *   Its choice is kept in `Library/Application Support/purchase-debug.json`, so
 *   a relaunch keeps it.
 */
import { Directory, File, Paths } from 'expo-file-system';

import { debugLog } from '../debug/debug-log';
import { DEBUG_MODE } from '../debug/mode';
import { createFakeStore, FAKE_UNLOCKED, fakeStateFor, type FakeStoreState } from '../purchase/fake-store';
import { PURCHASE_LOCK } from '../purchase/mode';
import { TRIAL_PRODUCT, UNLOCK_PRODUCT } from '../purchase/products';
import { createPurchases, type Purchases } from '../purchase/purchases';
import { EMPTY_RECORD, parseRecord, type PurchaseRecord } from '../purchase/record';
import type { Store } from '../purchase/store';
import { storeEnvironment, storeKitStore } from '../purchase/storekit';
import { configurePurchases, purchases } from './purchase';
import { alertAsker } from './purchase-alert';
import { hlog } from './walkthrough-harness';

const folder = () => new Directory(Paths.document.parentDirectory, 'Library', 'Application Support');

function readJson(name: string): unknown {
  try {
    const file = new File(folder(), name);
    return file.exists ? JSON.parse(file.textSync()) : null;
  } catch (problem) {
    debugLog('purchase', `${name} could not be read: ${String(problem)}`);
    return null;
  }
}

function writeJson(name: string, value: unknown): void {
  try {
    folder().create({ intermediates: true, idempotent: true });
    new File(folder(), name).write(JSON.stringify(value));
  } catch (problem) {
    debugLog('purchase', `${name} could not be written: ${String(problem)}`);
  }
}

const RECORD = 'purchase.json';
const DEBUG_CHOICE = 'purchase-debug.json';

/** What a build with Debug Mode asks: the pretend App Store, in its kept state, or StoreKit. */
interface DebugChoice {
  readonly use: 'fake' | 'real';
  readonly fake: FakeStoreState;
}

function readDebugChoice(): DebugChoice {
  const data = readJson(DEBUG_CHOICE) as Partial<DebugChoice> | null;
  const fake = data?.fake;
  return {
    use: data?.use === 'real' ? 'real' : 'fake',
    fake: fake && typeof fake === 'object'
      ? {
          products: fake.products !== false,
          trialStartedAt: typeof fake.trialStartedAt === 'number' ? fake.trialStartedAt : null,
          unlocked: fake.unlocked === true,
          outcome: ['purchased', 'pending', 'cancelled', 'failed'].includes(String(fake.outcome)) ? fake.outcome! : 'purchased',
        }
      : FAKE_UNLOCKED,
  };
}

let fake: ReturnType<typeof createFakeStore> | null = null;
let current: Purchases | null = null;

function configure(): void {
  if (!PURCHASE_LOCK) {
    fake = null;
    configurePurchases(null);
    return;
  }
  const choice = DEBUG_MODE ? readDebugChoice() : null;
  let store: Store;
  let record: { load(): PurchaseRecord; save(next: PurchaseRecord): void };
  if (choice?.use === 'fake') {
    fake = createFakeStore(choice.fake, { now: () => Date.now(), save: (state) => writeJson(DEBUG_CHOICE, { use: 'fake', fake: state }) });
    store = fake;
    // The pretend App Store keeps what it owns itself; the real record is left alone.
    let memory = EMPTY_RECORD;
    record = { load: () => memory, save: (next) => { memory = next; } };
  } else {
    fake = null;
    store = storeKitStore();
    record = { load: () => parseRecord(readJson(RECORD)), save: (next) => writeJson(RECORD, next) };
    if (DEBUG_MODE) void storeEnvironment().then((environment) => debugLog('purchase', `StoreKit environment: ${environment}`));
  }
  debugLog('purchase', `the lock is on; ${fake ? 'the pretend App Store of Debug Mode' : 'StoreKit'} decides`);
  const controller: Purchases = createPurchases({
    lockOn: true,
    store,
    record,
    ask: alertAsker,
    now: () => Date.now(),
    log: (line) => debugLog('purchase', line),
  });
  current = controller;
  configurePurchases(controller);
}

export function startPurchases(): () => void {
  configure();
  return () => {
    current = null;
    fake = null;
    configurePurchases(null);
  };
}

function say(): void {
  void (current?.ready() ?? Promise.resolve()).then(() => {
    const access = purchases.access();
    hlog(
      `store use=${!PURCHASE_LOCK ? 'none (no lock)' : fake ? 'fake' : 'storekit'} access=${access ? JSON.stringify(access) : null} ` +
        `allows=${purchases.allowsSpeech()} price=${purchases.price()} unavailable=${purchases.unavailable()}` +
        (fake ? ` fake=${JSON.stringify(fake.state())}` : ''),
    );
  });
}

/**
 * `{"do":"store", …}` from the walkthrough harness, in a build with Debug Mode
 * only. With nothing else, it reports. Otherwise:
 *
 * - `"use": "fake"` or `"real"`: the pretend App Store, or StoreKit;
 * - `"state"` (with `"days"` or `"seconds"` for `"trial"`) and `"outcome"`: what
 *   the pretend App Store owns and sells, and what its next purchase does
 *   (`fakeStateFor`). The app's controller is made afresh, as at a launch, so
 *   the products are loaded again;
 * - `"revoke": "unlock"` or `"trial"`: a refund, likewise;
 * - `"arrive": "unlock"`: the Unlock reported by itself while the app runs, as a
 *   purchase on another device or a parent's approval is, without a relaunch.
 */
export function storeCommand(command: Record<string, unknown>): void {
  if (!DEBUG_MODE) return;
  if (!PURCHASE_LOCK) return say();
  if (command.use === 'fake' || command.use === 'real') {
    writeJson(DEBUG_CHOICE, { ...readDebugChoice(), use: command.use });
    configure();
    return say();
  }
  if (command.arrive === 'unlock') {
    if (!fake) return hlog('store: StoreKit decides; send {"do":"store","use":"fake"} first');
    fake.set({ ...fake.state(), unlocked: true });
    return say();
  }
  const was = readDebugChoice();
  const changes = command.revoke !== undefined || command.state !== undefined || command.outcome !== undefined;
  if (!changes) return say();
  if (was.use !== 'fake') return hlog('store: StoreKit decides; send {"do":"store","use":"fake"} first');
  let next: FakeStoreState | null;
  if (command.revoke === 'unlock' || command.revoke === 'trial') {
    next = command.revoke === 'unlock' ? { ...was.fake, unlocked: false } : { ...was.fake, trialStartedAt: null };
    hlog(`store: ${command.revoke === 'unlock' ? UNLOCK_PRODUCT : TRIAL_PRODUCT} revoked`);
  } else {
    next = fakeStateFor(was.fake, command, Date.now());
    if (!next) return hlog(`store: not understood: ${JSON.stringify(command)}`);
  }
  writeJson(DEBUG_CHOICE, { use: 'fake', fake: next });
  configure();
  say();
}
