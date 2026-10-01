/**
 * **One drawer at a time**, app-wide (#117, ADR 0066; the owner's Q43).
 *
 * The phone presents one sheet at a time: UIKit will not present a second
 * view controller over one that is already up, and SwiftUI's sheet is one.
 * Since the page stays usable at the Drawer Height, a drawer can be asked for
 * while another is up: More actions while Contents is open. Without this, the
 * second drawer silently failed to appear and was left "open" in its owner's
 * state, so its button did nothing until the reader was left (notes,
 * 2026-10-01 13:21 and 13:41).
 *
 * So every drawer asks here for its turn. A drawer asked for while another
 * is up closes that one (calls its `close`, which is its owner's `onClose`)
 * and waits; it is presented once the other's dismissal has finished
 * (`gone`). Every drawer (`drawer.tsx`), the lookup drawer included, takes
 * part through `useDrawerTurn`.
 *
 * Pure, so that a test can drive it: no React, no platform.
 */

export interface DrawerTurns {
  /** `id` wants to be up. Closes the drawer that is up, or the one already waiting, and waits behind it. */
  ask(id: string, close: () => void): void;
  /** `id` no longer wants to be up: its owner closed it. If it is up, its dismissal has begun. */
  leave(id: string): void;
  /** `id`, having left, has finished its dismissal, or was unmounted. The drawer waiting, if any, is up next. */
  gone(id: string): void;
  /** Whether `id` may be presented now. */
  isUp(id: string): boolean;
  subscribe(listener: () => void): () => void;
}

export function createDrawerTurns(): DrawerTurns {
  /** The drawer that is presented, or is being dismissed: nothing else may present until it is gone. */
  let up: string | null = null;
  /** Whether `up` still wants to be up, or has left and is on its way down. */
  let upWanted = false;
  let upClose: (() => void) | null = null;
  /** The drawer asked for while another was up: only the latest, because asking for one closes the one before. */
  let waiting: { id: string; close: () => void } | null = null;
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of [...listeners]) listener(); };

  return {
    ask(id, close) {
      if (up === id && upWanted) { upClose = close; return; }
      if (up === null) {
        up = id; upWanted = true; upClose = close;
        changed();
        return;
      }
      if (waiting && waiting.id !== id) waiting.close();
      waiting = { id, close };
      // The one that is up goes down; its owner's `onClose` turns it into a `leave`.
      if (upWanted && up !== id) upClose?.();
    },
    leave(id) {
      if (waiting?.id === id) { waiting = null; return; }
      if (up === id && upWanted) { upWanted = false; changed(); }
    },
    gone(id) {
      // Only a drawer that has left can be gone. iOS reported one dismissal
      // twice (notes, 2026-10-01 13:41), and the second must not take down the
      // drawer that came up after it, nor the same drawer asked for again.
      if (up !== id || upWanted) return;
      if (waiting) {
        up = waiting.id; upWanted = true; upClose = waiting.close; waiting = null;
      } else {
        up = null; upWanted = false; upClose = null;
      }
      changed();
    },
    isUp(id) {
      return up === id && upWanted;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
