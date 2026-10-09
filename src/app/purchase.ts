/**
 * The Trial and the Unlock as the app asks about them (#148, ADR 0075;
 * CONTEXT.md), and the words they are put in.
 *
 * The rule is `src/purchase/purchases.ts`. This file holds the one controller
 * the shell configures as the app starts (`purchase-setup.ts`), so that the
 * Reading, the downloads and Settings ask the same one, and the words, which
 * stay platform-free like `consent.ts` so that a test reaches all of them. The
 * alert itself is `purchase-alert.ts`.
 *
 * Until the shell has configured it, a build with the lock lets nothing speak
 * and asks nothing, as the consent gate does; a build without the lock speaks.
 *
 * Nothing here, nor anywhere in the app, names a free way to get read-aloud:
 * not TestFlight, not building from source (Guidelines 2.2 and 2.3.1(a), DPLA
 * 7.4; ADR 0075).
 */
import { daysLeft, type Access } from '../purchase/access';
import { PURCHASE_LOCK } from '../purchase/mode';
import type { Purchases } from '../purchase/purchases';

/** Before the Trial, in the words the owner approved on 2026-10-09: its length, what stops, and the price (Guideline 3.1.1). */
export function trialQuestion(price: string): { title: string; message: string; start: string; notNow: string } {
  return {
    title: 'Read Aloud Free for 30 Days',
    message: `After 30 days, reading aloud and offline narration need a one-time purchase of ${price}. Reading documents stays free.`,
    start: 'Start Free Trial',
    notNow: 'Not Now',
  };
}

/** After the Trial, without the Unlock, in the words the owner approved on 2026-10-09. */
export function endedQuestion(price: string): { title: string; message: string; unlock: string; restore: string; notNow: string } {
  return {
    title: 'Your Free Trial Has Ended',
    message: `Unlock reading aloud and offline narration for good with a one-time purchase of ${price}.`,
    unlock: `Unlock for ${price}`,
    restore: 'Restore Purchase',
    notNow: 'Not Now',
  };
}

/** No product loads: offline, the App Store down, or a bundle ID with nothing to sell (decision of 2026-10-09). */
export const UNAVAILABLE = { title: 'Purchases Unavailable', message: "The App Store can't be reached right now.", ok: 'OK' } as const;

/** The Settings row's label (#148). */
export const READ_ALOUD = 'Read Aloud';

/**
 * What the Settings row says on its right: the days left, that the Trial has
 * ended, or that the Unlock is owned. Nothing before the Trial, which has no
 * state yet to report, and no row at all without the lock.
 */
export function readAloudValue(access: Access | null, now: number): string | undefined {
  if (!access) return undefined;
  if (access.kind === 'trial') {
    const left = daysLeft(access.endsAt, now);
    return `${left} ${left === 1 ? 'day' : 'days'} left`;
  }
  if (access.kind === 'ended') return 'Trial ended';
  if (access.kind === 'unlocked') return 'Unlocked';
  return undefined;
}

let current: Purchases | null = null;
let detach: (() => void) | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of [...listeners]) listener(); };

/** The one controller, set as the app starts and replaced only by the Debug harness (`purchase-setup.ts`). */
export function configurePurchases(next: Purchases | null): void {
  detach?.();
  detach = null;
  current?.stop();
  current = next;
  if (next) {
    detach = next.subscribe(notify);
    next.start();
  }
  notify();
}

/**
 * What the rest of the app calls. `allowsSpeech` asks nothing and answers at
 * once; `askForSpeech` is the gate in front of a press (`purchases.ts`).
 */
export const purchases = {
  allowsSpeech: (): boolean => (current ? current.allowsSpeech() : !PURCHASE_LOCK),
  askForSpeech: (): Promise<boolean> => (current ? current.askForSpeech() : Promise.resolve(!PURCHASE_LOCK)),
  access: (): Access | null => (current ? current.access() : PURCHASE_LOCK ? null : { kind: 'off' }),
  price: (): string | null => current?.price() ?? null,
  unavailable: (): boolean => current?.unavailable() ?? false,
  startTrial: (): Promise<boolean> => current?.startTrial() ?? Promise.resolve(!PURCHASE_LOCK),
  unlock: (): Promise<boolean> => current?.unlock() ?? Promise.resolve(!PURCHASE_LOCK),
  restore: (): Promise<boolean> => current?.restore() ?? Promise.resolve(!PURCHASE_LOCK),
  /** Told of every change: something bought, restored or revoked, the products loaded or not. */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};
