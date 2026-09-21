/**
 * A **Stamp** (CONTEXT.md): when something was last written and which device
 * wrote it, used to decide which of two copies wins.
 *
 * Its own file because two things carry one and they must not be confused. A
 * Library entry's Stamp moves whenever the owner touches the Document — opening
 * it, renaming it, reading it — and orders the shelf. A Reading Position's
 * Stamp moves **only when speech stops somewhere new**, and it is the one a
 * merge compares: opening a book on the phone to glance at the shelf must not
 * make the phone's older place beat the desktop's newer one, which is exactly
 * what comparing the entry's Stamp would do (issue #20).
 *
 * `at` is wall-clock milliseconds since the epoch. A number rather than a
 * formatted date because a number has one spelling and a date string has
 * several, and two devices comparing spellings is not a comparison. `device`
 * is the Device Name, opaque here: it only ever has to differ between devices,
 * and the merge never reads it.
 */
export interface Stamp {
  at: number;
  /** Which device wrote it. */
  device: string;
}

/**
 * The Stamp that loses to every other: what a position whose own Stamp could
 * not be read is given, so it loses a merge rather than winning it by accident
 * of when it was parsed. Also what a version-1 Library file's positions carry,
 * which had no Stamp of their own.
 */
export const OLDEST_STAMP: Stamp = { at: 0, device: '' };

/**
 * The Stamp for a position written now, above whatever was held.
 *
 * `max(now, previous + 1)` rather than `now`: a device whose clock runs slow
 * would otherwise write a Stamp older than the one it just adopted from a faster
 * machine, and the place it is actually reading would lose every merge to a place
 * it has already moved past. The desktop plugin's sampler applies the same rule.
 */
export function nextStamp(now: number, device: string, previous: Stamp | null | undefined): Stamp {
  const at = previous ? Math.max(now, previous.at + 1) : now;
  return { at, device };
}

/** Whether `candidate` beats `held`: strictly newer. An equal Stamp keeps what is held, so merging a copy into itself changes nothing. */
export function newerThan(candidate: Stamp, held: Stamp | null | undefined): boolean {
  return !held || candidate.at > held.at;
}
