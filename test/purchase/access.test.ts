import { describe, expect, it } from 'vitest';

import { accessOf, daysLeft, speaks } from '../../src/purchase/access';
import { DAY_MS, TRIAL_MS } from '../../src/purchase/products';

/** #148, ADR 0075: the Trial's arithmetic and the order of the states. */
const NOW = Date.UTC(2026, 9, 9, 12);
const facts = { lockOn: true, unlocked: false, trialStartedAt: null as number | null, now: NOW };

describe('whether the app may speak', () => {
  it('is always yes in a build without the lock, whatever is owned', () => {
    expect(accessOf({ ...facts, lockOn: false })).toEqual({ kind: 'off' });
    expect(accessOf({ ...facts, lockOn: false, trialStartedAt: NOW - 2 * TRIAL_MS })).toEqual({ kind: 'off' });
    expect(speaks({ kind: 'off' })).toBe(true);
  });

  it('puts the Unlock before the Trial, so an ended Trial with the Unlock speaks', () => {
    expect(accessOf({ ...facts, unlocked: true, trialStartedAt: NOW - 2 * TRIAL_MS })).toEqual({ kind: 'unlocked' });
  });

  it('runs the Trial for thirty days from its purchase date, and not a moment longer', () => {
    const began = NOW - TRIAL_MS + 1;
    expect(accessOf({ ...facts, trialStartedAt: began })).toEqual({ kind: 'trial', endsAt: began + TRIAL_MS });
    expect(accessOf({ ...facts, trialStartedAt: NOW - TRIAL_MS })).toEqual({ kind: 'ended' });
    expect(speaks({ kind: 'trial', endsAt: NOW + 1 })).toBe(true);
    expect(speaks({ kind: 'ended' })).toBe(false);
  });

  it('offers the Trial to someone who has neither', () => {
    expect(accessOf(facts)).toEqual({ kind: 'not-started' });
    expect(speaks({ kind: 'not-started' })).toBe(false);
  });

  it('counts the days left as whole days, the last one as 1, and never more than thirty', () => {
    expect(daysLeft(NOW + TRIAL_MS, NOW)).toBe(30);
    expect(daysLeft(NOW + 12 * DAY_MS - 60_000, NOW)).toBe(12);
    expect(daysLeft(NOW + 1, NOW)).toBe(1);
    // A clock wound back before the Trial began.
    expect(daysLeft(NOW + 45 * DAY_MS, NOW)).toBe(30);
  });
});
