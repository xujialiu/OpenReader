import { accessOf, speaks, type Access } from './access';
import { PRODUCTS, TRIAL_PRODUCT, UNLOCK_PRODUCT } from './products';
import { applyTransaction, mergeRecord, sameRecord, type PurchaseRecord } from './record';
import type { Store, StoreProduct } from './store';

/**
 * How the person is asked (#148, ADR 0075): the phone's own alert in the app
 * (`src/app/purchase-alert.ts`), a scripted one in a test. The words are
 * `src/app/purchase.ts`'s.
 */
export interface PurchaseAsker {
  /** Whether a question can be put now: only with the app in front, never from the Lock Screen. */
  canAsk(): boolean;
  /** Before the Trial: its length, what stops when it ends, and the price after it (Guideline 3.1.1). */
  trial(price: string): Promise<'start' | 'not-now'>;
  /** After the Trial, without the Unlock. */
  ended(price: string): Promise<'unlock' | 'restore' | 'not-now'>;
  /** No product loads: the App Store is out of reach, or this build's bundle ID sells nothing. */
  unavailable(): Promise<void>;
}

export interface PurchaseDeps {
  /** `PURCHASE_LOCK`, handed in so a test can have either. */
  lockOn: boolean;
  store: Store;
  /** The device's fallback record (`record.ts`), read once at creation and written on every change. */
  record: { load(): PurchaseRecord; save(record: PurchaseRecord): void };
  ask: PurchaseAsker;
  now(): number;
  log(line: string): void;
  /** How long the products are waited for before the App Store counts as out of reach. */
  productTimeoutMs?: number;
}

/**
 * The Trial and the Unlock, as the rest of the app asks about them (#148,
 * ADR 0075; CONTEXT.md).
 *
 * - `allowsSpeech` answers at once, from what is known now, and asks nothing:
 *   for the download scheduler, which may not raise an alert.
 * - `askForSpeech` is the gate in front of a press of Play or a download the
 *   person starts or resumes. It answers true at once when the app may speak.
 *   Otherwise it puts one question (the Trial, or its end, or the App Store out
 *   of reach), makes the purchase the person chose, and answers whether the app
 *   may speak now. One question at a time: every caller while it is open waits
 *   on the same answer.
 * - `startTrial`, `unlock` and `restore` are the Settings rows.
 *
 * What is owned comes from StoreKit as the app starts, again after every
 * purchase or restore, and from every transaction StoreKit reports by itself,
 * laid over the device's fallback record.
 */
export interface Purchases {
  start(): void;
  /** Settles once the first read of what is owned has. */
  ready(): Promise<void>;
  /** Whether that first read has settled, so that a lock is known and not merely not yet disproved. */
  settled(): boolean;
  /** How long the running Trial has left, by this controller's clock; null outside a Trial. */
  trialLeft(): number | null;
  access(): Access;
  allowsSpeech(): boolean;
  /** The Unlock's price in the person's currency, once the products have loaded. */
  price(): string | null;
  /** Whether the products could not be loaded the last time they were asked for. */
  unavailable(): boolean;
  askForSpeech(): Promise<boolean>;
  startTrial(): Promise<boolean>;
  unlock(): Promise<boolean>;
  restore(): Promise<boolean>;
  subscribe(listener: () => void): () => void;
  stop(): void;
}

const DEFAULT_PRODUCT_TIMEOUT_MS = 15_000;

export function createPurchases(deps: PurchaseDeps): Purchases {
  const { store, ask, log } = deps;
  let record = deps.lockOn ? deps.record.load() : { unlocked: false, trialStartedAt: null };
  let products: StoreProduct[] | null = null;
  let failedProducts = false;
  let loading: Promise<StoreProduct[] | null> | null = null;
  let asking: Promise<boolean> | null = null;
  let started = false;
  let stopListening: (() => void) | null = null;
  let firstRead: Promise<void> = Promise.resolve();
  let read = !deps.lockOn;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of [...listeners]) listener(); };

  const access = () => accessOf({ lockOn: deps.lockOn, unlocked: record.unlocked, trialStartedAt: record.trialStartedAt, now: deps.now() });

  function keep(next: PurchaseRecord): void {
    if (sameRecord(next, record)) return;
    record = next;
    deps.record.save(next);
    log(`owned: unlocked ${next.unlocked}, trial began ${next.trialStartedAt === null ? 'never' : new Date(next.trialStartedAt).toISOString()}`);
    notify();
  }

  async function refresh(): Promise<void> {
    try {
      const [owned, revoked] = await Promise.all([store.entitlements(), store.revoked(PRODUCTS)]);
      keep(mergeRecord(record, owned, revoked));
    } catch (problem) {
      log(`what is owned could not be read; the device's record stands: ${String(problem)}`);
    }
  }

  /** The products, loaded once and kept; asked for again only after a failure. */
  function loadProducts(): Promise<StoreProduct[] | null> {
    if (products) return Promise.resolve(products);
    if (loading) return loading;
    const timeout = deps.productTimeoutMs ?? DEFAULT_PRODUCT_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    loading = Promise.race([
      store.products(PRODUCTS),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${timeout} ms`)), timeout); }),
    ]).then((loaded) => {
      if (!loaded.some((product) => product.id === UNLOCK_PRODUCT) || !loaded.some((product) => product.id === TRIAL_PRODUCT))
        throw new Error(`the App Store has ${loaded.length ? loaded.map((product) => product.id).join(', ') : 'none of the products'}`);
      products = loaded;
      failedProducts = false;
      log(`products: ${loaded.map((product) => `${product.id} ${product.displayPrice}`).join(', ')}`);
      return loaded;
    }).catch((problem: unknown) => {
      failedProducts = true;
      log(`products did not load: ${String(problem)}`);
      return null;
    }).finally(() => {
      clearTimeout(timer);
      loading = null;
      notify();
    });
    return loading;
  }

  const unlockPrice = (loaded: StoreProduct[] | null) => loaded?.find((product) => product.id === UNLOCK_PRODUCT)?.displayPrice ?? null;

  /** The purchase the person chose. Rejected, it says the App Store could not be reached. */
  async function buy(id: string): Promise<boolean> {
    let outcome: string;
    try {
      outcome = await store.purchase(id);
    } catch (problem) {
      log(`purchase of ${id} failed: ${String(problem)}`);
      await ask.unavailable();
      return false;
    }
    log(`purchase of ${id}: ${outcome}`);
    if (outcome !== 'purchased') return false;
    // What was just bought counts at once; StoreKit's own date replaces it below.
    keep(id === UNLOCK_PRODUCT ? { ...record, unlocked: true } : { ...record, trialStartedAt: record.trialStartedAt ?? deps.now() });
    await refresh();
    return speaks(access());
  }

  async function restoring(): Promise<boolean> {
    try {
      await store.sync();
    } catch (problem) {
      log(`restore did not finish: ${String(problem)}`);
      return speaks(access());
    }
    await refresh();
    log(`restored: ${access().kind}`);
    return speaks(access());
  }

  async function question(): Promise<boolean> {
    if (!ask.canAsk()) {
      log('locked, and not asked away from the screen');
      return false;
    }
    const price = unlockPrice(await loadProducts());
    if (!price) {
      await ask.unavailable();
      return false;
    }
    const now = access();
    if (speaks(now)) return true;
    if (now.kind === 'not-started') {
      if ((await ask.trial(price)) !== 'start') return false;
      return buy(TRIAL_PRODUCT);
    }
    const choice = await ask.ended(price);
    if (choice === 'unlock') return buy(UNLOCK_PRODUCT);
    if (choice === 'restore') return restoring();
    return false;
  }

  /** One question at a time, shared by every caller while it is open. */
  function once(run: () => Promise<boolean>): Promise<boolean> {
    if (asking) return asking;
    asking = run().catch((problem: unknown) => {
      log(`the question failed: ${String(problem)}`);
      return false;
    }).finally(() => { asking = null; });
    return asking;
  }

  return {
    start() {
      if (started || !deps.lockOn) return;
      started = true;
      stopListening = store.listen((transaction) => {
        log(`transaction: ${transaction.productId} ${transaction.revoked ? 'revoked' : 'owned'}`);
        keep(applyTransaction(record, transaction));
      });
      firstRead = refresh().finally(() => {
        read = true;
        notify();
      });
      void loadProducts();
    },
    ready: () => firstRead,
    settled: () => read,
    trialLeft() {
      const now = access();
      return now.kind === 'trial' ? now.endsAt - deps.now() : null;
    },
    access,
    allowsSpeech: () => speaks(access()),
    price: () => unlockPrice(products),
    unavailable: () => failedProducts,
    async askForSpeech() {
      if (!deps.lockOn) return true;
      await firstRead;
      if (speaks(access())) return true;
      return once(question);
    },
    async startTrial() {
      if (!deps.lockOn) return true;
      await firstRead;
      if (access().kind !== 'not-started') return speaks(access());
      return once(question);
    },
    unlock() {
      return once(async () => {
        if (!unlockPrice(await loadProducts())) {
          await ask.unavailable();
          return false;
        }
        return buy(UNLOCK_PRODUCT);
      });
    },
    restore: () => once(restoring),
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    stop() {
      stopListening?.();
      stopListening = null;
      listeners.clear();
    },
  };
}
