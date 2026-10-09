import { DAY_MS, TRIAL_DAYS, TRIAL_MS } from './products';

/**
 * Whether the app may speak, in ADR 0075's order (CONTEXT.md: **Trial**,
 * **Unlock**):
 *
 * 1. `off`: a build without the lock, which speaks and sells nothing;
 * 2. `unlocked`: the Unlock is owned;
 * 3. `trial`: the Trial is running, until `endsAt`;
 * 4. `ended`: the Trial has run out and the Unlock is not owned;
 * 5. `not-started`: neither, so the Trial is offered.
 */
export type Access =
  | { readonly kind: 'off' }
  | { readonly kind: 'unlocked' }
  | { readonly kind: 'trial'; readonly endsAt: number }
  | { readonly kind: 'ended' }
  | { readonly kind: 'not-started' };

/**
 * The Trial runs `TRIAL_DAYS` from its transaction's purchase date, against the
 * device's own clock. A clock wound back lengthens it; that is not defended
 * against (ADR 0075): the free routes make it pointless, and checking the time
 * over the network would mean a third party.
 */
export function accessOf(facts: { lockOn: boolean; unlocked: boolean; trialStartedAt: number | null; now: number }): Access {
  if (!facts.lockOn) return { kind: 'off' };
  if (facts.unlocked) return { kind: 'unlocked' };
  if (facts.trialStartedAt !== null) {
    const endsAt = facts.trialStartedAt + TRIAL_MS;
    return facts.now < endsAt ? { kind: 'trial', endsAt } : { kind: 'ended' };
  }
  return { kind: 'not-started' };
}

/** Whether the app may speak: without the lock, with the Unlock, or in the Trial. */
export function speaks(access: Access): boolean {
  return access.kind === 'off' || access.kind === 'unlocked' || access.kind === 'trial';
}

/**
 * Whole days left, counting a part of a day as a day, so the last day reads 1
 * and never 0. At most `TRIAL_DAYS`, which only a clock wound back exceeds.
 */
export function daysLeft(endsAt: number, now: number): number {
  return Math.min(TRIAL_DAYS, Math.max(1, Math.ceil((endsAt - now) / DAY_MS)));
}
