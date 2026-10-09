/**
 * The two Non-Consumables in App Store Connect (#148, ADR 0075), and the length
 * of the Trial the first one starts.
 *
 * The trial's identifier names no length, so a change of length keeps the
 * product; only its display name, "30-day Trial", and `TRIAL_DAYS` follow it.
 */
export const TRIAL_PRODUCT = 'top.xujialiu.openreader.trial';
export const UNLOCK_PRODUCT = 'top.xujialiu.openreader.unlock';
export const PRODUCTS = [TRIAL_PRODUCT, UNLOCK_PRODUCT] as const;

export const TRIAL_DAYS = 30;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const TRIAL_MS = TRIAL_DAYS * DAY_MS;
