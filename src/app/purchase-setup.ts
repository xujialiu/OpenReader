/** Formal-variant StoreKit startup. Metro substitutes a storage-free no-op for free/Debug (#324). */
import { Directory, File, Paths } from 'expo-file-system';
import { AppState } from 'react-native';

import { debugLog } from '../debug/debug-log';
import { PURCHASE_LOCK } from '../purchase/mode';
import { createPurchases, type Purchases } from '../purchase/purchases';
import { purchaseCacheStore } from '../purchase/cache';
import { storeKitStore } from '../purchase/storekit';
import { configurePurchases } from './purchase';
import { alertAsker } from './purchase-alert';

const folder = () => new Directory(Paths.document.parentDirectory, 'Library', 'Application Support');
const RECORD = 'purchase.json';

function readRecord(): unknown {
  try {
    const file = new File(folder(), RECORD);
    return file.exists ? JSON.parse(file.textSync()) : null;
  } catch (problem) {
    debugLog('purchase', `${RECORD} could not be read: ${String(problem)}`);
    return null;
  }
}

function writeRecord(value: unknown): void {
  try {
    folder().create({ intermediates: true, idempotent: true });
    new File(folder(), RECORD).write(JSON.stringify(value));
  } catch (problem) {
    debugLog('purchase', `${RECORD} could not be written: ${String(problem)}`);
  }
}

let current: Purchases | null = null;

function configure(): void {
  if (!PURCHASE_LOCK) {
    configurePurchases(null);
    return;
  }
  current = createPurchases({
    lockOn: true,
    store: storeKitStore(),
    record: purchaseCacheStore(readRecord, writeRecord),
    ask: alertAsker,
    now: () => Date.now(),
    log: (line) => debugLog('purchase', line),
  });
  configurePurchases(current);
}

export function startPurchases(): () => void {
  configure();
  const foreground = AppState.addEventListener('change', (state) => {
    if (state === 'active') void current?.refresh();
  });
  return () => {
    foreground.remove();
    current = null;
    configurePurchases(null);
  };
}
