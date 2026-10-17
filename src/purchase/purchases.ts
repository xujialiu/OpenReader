import { withTimeout } from '../core/timeout';
import { accessOf, speaks, type Access } from './access';
import { purchaseCache, type PurchaseCache } from './cache';
import { PRODUCTS, TRIAL_PRODUCT, UNLOCK_PRODUCT } from './products';
import { applyTransaction, EMPTY_RECORD, mergeRecord, sameRecord, type PurchaseRecord } from './record';
import { parseSource, sameSource, type PurchaseSource, type Store, type StoreProduct, type StorePurchase, type StoreTransaction } from './store';

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
  unavailable(reason?: 'verification'): Promise<void>;
  /** Restore finished, and the Unlock is still not owned. */
  nothingToRestore(): Promise<void>;
}

export interface PurchaseDeps {
  /** `PURCHASE_LOCK`, handed in so a test can have either. */
  lockOn: boolean;
  store: Store;
  /** Only source-bound versioned records can supply a fallback. Legacy records load as null. */
  record: { load(source?: PurchaseSource): PurchaseCache | null; save(record: PurchaseCache): void };
  ask: PurchaseAsker;
  now(): number;
  log(line: string): void;
  /** How long the products are waited for before the App Store counts as out of reach. */
  productTimeoutMs?: number;
  verificationTimeoutMs?: number;
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
 *   may speak now. Foreground callers share one question; a locked remote
 *   caller is refused immediately, even while that question is open.
 * - `startTrial`, `unlock` and `restore` are the Settings rows.
 *
 * What is owned comes from verified StoreKit reads at startup, on foreground
 * entry and after Restore, and from verified purchase results and updates.
 * A kept fallback is used only after the read identifies a matching source.
 */
export interface Purchases {
  start(): void;
  /** Waits for startup and any source recheck already in progress. */
  ready(): Promise<void>;
  /** Recheck on foreground entry or an explicit retry; no purchase or sign-in is initiated. */
  refresh(): Promise<void>;
  /** Whether that first read has settled, so that a lock is known and not merely not yet disproved. */
  settled(): boolean;
  /** How long the running Trial has left, by this controller's clock; null outside a Trial. */
  trialLeft(): number | null;
  access(): Access;
  allowsSpeech(): boolean;
  /** A new intent must wait for any source recheck; already-authorized work need not. */
  canStartSpeech(): boolean;
  /** The Unlock's price in the person's currency, once the products have loaded. */
  price(): string | null;
  /** Whether product loading or purchase verification is unavailable. */
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
  let cached = deps.lockOn ? deps.record.load() : null;
  let record: PurchaseRecord = EMPTY_RECORD;
  let source: PurchaseSource | null = null;
  let verificationFailed = false;
  let revision = 0;
  let stopped = false;
  let checking: Promise<boolean> | null = null;
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

  const access = (): Access => deps.lockOn && verificationFailed ? { kind: 'unavailable' }
    : accessOf({ lockOn: deps.lockOn, unlocked: record.unlocked, trialStartedAt: record.trialStartedAt, now: deps.now() });

  function prior(nextSource: PurchaseSource | null): PurchaseRecord {
    if (sameSource(source, nextSource)) return record;
    const kept = nextSource ? deps.record.load(nextSource) : null;
    return kept && sameSource(kept.source, nextSource) ? kept.record : EMPTY_RECORD;
  }

  function keep(next: PurchaseRecord, nextSource: PurchaseSource | null): void {
    const changed = verificationFailed || !sameRecord(next, record) || !sameSource(source, nextSource);
    record = next;
    source = nextSource;
    verificationFailed = false;
    if (nextSource && (!cached || !sameSource(cached.source, nextSource) || !sameRecord(cached.record, next))) {
      cached = purchaseCache(nextSource, next);
      deps.record.save(cached);
    }
    // A source identifier is not a diagnostic; it never enters the Debug Log.
    if (changed) {
      log(`owned: unlocked ${next.unlocked}, trial began ${next.trialStartedAt === null ? 'never' : new Date(next.trialStartedAt).toISOString()}`);
      notify();
    }
  }

  function unavailable(): false {
    verificationFailed = true;
    notify();
    return false;
  }

  async function readSnapshot(turn: number): Promise<boolean> {
    try {
      const answer = await withTimeout(store.snapshot(PRODUCTS), deps.verificationTimeoutMs ?? DEFAULT_PRODUCT_TIMEOUT_MS,
        () => new Error('Purchase verification did not respond.'));
      if (stopped) return false;
      if (turn !== revision) return !verificationFailed;
      const nextSource = parseSource(answer.source);
      const owned = answer.owned.filter((item) => PRODUCTS.some((id) => id === item.productId) && Number.isFinite(item.purchaseDate));
      // A verified live entitlement can authorize this run even if no app identity
      // is available. Nothing from such an unscoped read is persisted or inherited.
      if (!nextSource && !owned.length && (cached || record.unlocked || record.trialStartedAt !== null)) return unavailable();
      keep(mergeRecord(prior(nextSource), owned, answer.revoked), nextSource);
      return true;
    } catch (problem) {
      if (stopped) return false;
      if (turn !== revision) return !verificationFailed;
      log(`purchases could not be verified; the kept record is unchanged: ${String(problem)}`);
      return unavailable();
    }
  }

  function refresh(): Promise<boolean> {
    if (!deps.lockOn) return Promise.resolve(true);
    const job = readSnapshot(++revision).finally(() => {
      if (checking === job) { checking = null; if (!stopped) notify(); }
    });
    checking = job;
    return job;
  }

  const canStartSpeech = () => !deps.lockOn || read && checking === null && speaks(access());

  function bought(transaction: StoreTransaction): void {
    ++revision; // An older read cannot undo a newer verified transaction.
    const nextSource = parseSource(transaction.source);
    keep(applyTransaction(prior(nextSource), transaction), nextSource);
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
    let result: StorePurchase;
    try {
      result = await store.purchase(id);
      if (result.outcome === 'purchased' && (result.transaction.productId !== id || result.transaction.revoked ||
          !Number.isFinite(result.transaction.purchaseDate))) throw new Error('The purchase could not be verified.');
    } catch (problem) {
      if (stopped) return false;
      log(`purchase of ${id} failed: ${String(problem)}`);
      await ask.unavailable();
      return false;
    }
    if (stopped) return false;
    log(`purchase of ${id}: ${result.outcome}`);
    if (result.outcome !== 'purchased') return false;
    bought(result.transaction);
    return speaks(access());
  }

  /**
   * Restore Purchase. When the App Store has answered and the Unlock is still
   * not owned, the person is told there was nothing to restore (decision of
   * 2026-10-09). Only an explicit cancellation is silent; another failure
   * says the App Store could not be reached (#164).
   */
  async function restoring(): Promise<boolean> {
    try {
      if (await store.sync() === 'cancelled') return speaks(access());
    } catch (problem) {
      if (stopped) return false;
      log(`restore did not finish: ${String(problem)}`);
      await ask.unavailable();
      return speaks(access());
    }
    if (!(await refresh())) {
      if (!stopped) await ask.unavailable('verification');
      return false;
    }
    log(`restored: ${access().kind}`);
    if (!record.unlocked) await ask.nothingToRestore();
    return speaks(access());
  }

  async function question(): Promise<boolean> {
    if (!ask.canAsk()) {
      log('locked, and not asked away from the screen');
      return false;
    }
    if (verificationFailed && !(await refresh())) {
      if (!stopped && ask.canAsk()) await ask.unavailable('verification');
      return false;
    }
    if (speaks(access())) return true;
    const price = unlockPrice(await loadProducts());
    if (stopped) return false;
    const now = access();
    if (speaks(now)) return true;
    if (!ask.canAsk()) return false;
    if (now.kind === 'unavailable') {
      await ask.unavailable('verification');
      return false;
    }
    if (!price) {
      await ask.unavailable();
      return false;
    }
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
      stopped = false;
      stopListening = store.listen((transaction) => {
        if (stopped || !PRODUCTS.some((id) => id === transaction.productId)) return;
        log(`transaction: ${transaction.productId} ${transaction.revoked ? 'revoked' : 'owned'}`);
        if (!verificationFailed && sameSource(source, parseSource(transaction.source))) bought(transaction);
        else void refresh(); // An event from another source must not select that source by itself.
      });
      firstRead = refresh().then(() => {
        if (stopped) return;
        read = true;
        notify();
      });
      void loadProducts();
    },
    ready: async () => { await firstRead; if (checking) await checking; },
    refresh: async () => { await refresh(); },
    settled: () => read,
    trialLeft() {
      const now = access();
      return now.kind === 'trial' ? now.endsAt - deps.now() : null;
    },
    access,
    allowsSpeech: () => speaks(access()),
    canStartSpeech,
    price: () => unlockPrice(products),
    unavailable: () => failedProducts || verificationFailed,
    async askForSpeech() {
      if (!deps.lockOn) return true;
      // A remote press never waits for verification or for a foreground question.
      if (!ask.canAsk() && !canStartSpeech()) return false;
      await firstRead;
      while (checking && !stopped) await checking;
      if (stopped) return false;
      if (speaks(access())) return true;
      // A locked remote press must not wait on an unanswered foreground alert (#163).
      if (!ask.canAsk()) return false;
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
      stopped = true;
      checking = null;
      ++revision;
      stopListening?.();
      stopListening = null;
      listeners.clear();
    },
  };
}
