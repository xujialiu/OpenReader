import { descendants, type Chapter } from '../offline/model';

/**
 * Two fingers dragged over the download drawer's list select the run of rows
 * under them, as the phone's own lists do (#57, design 0045, ADR 0045).
 *
 * The phone's rules, measured in Files on iOS 27.0 (ADR 0045): the run is every
 * row from the one the sweep began on to the one under the fingers, so moving
 * back toward the start gives rows back; a sweep that begins on a selected row
 * takes rows out of the selection instead; one sweep adds to what earlier ones
 * left. What is the drawer's own is what a row stands for, because its rows are
 * not all chapters: a chapter row stands for itself when it can be chosen, a
 * collapsed volume for every chapter folded under it that can be, and anything
 * that cannot be chosen, a downloaded chapter or one with a ring, for nothing.
 *
 * Pure, as the row rule is, so the suite checks it without rendering.
 */

/**
 * What crossing each shown row selects, in the order the rows are shown.
 *
 * An expanded volume stands only for its own text, if it has any that can be
 * chosen: the chapters under it are rows of their own, which the sweep crosses
 * anyway. A collapsed one stands for its own text and everything folded under
 * it, which is what a tap on it chooses.
 */
export function rowChapters(
  shown: readonly Chapter[],
  chapters: Chapter[],
  collapsed: ReadonlySet<string>,
  choosable: ReadonlySet<string>,
): string[][] {
  const parents = new Set(chapters.map((c) => c.parent));
  return shown.map((row) => {
    if (parents.has(row.id) && collapsed.has(row.id))
      return descendants(chapters, row.id).map((c) => c.id).filter((id) => choosable.has(id));
    return choosable.has(row.id) ? [row.id] : [];
  });
}

export interface Sweep {
  /** The row the sweep began on. */
  anchor: number;
  /** Whether it adds to the selection or takes from it, decided by the row it began on. */
  select: boolean;
  /** The selection as it was when the sweep began. */
  before: ReadonlySet<string>;
}

/**
 * A sweep beginning on row `anchor`. It takes rows out when that row stands
 * for chapters that are all selected already, and adds them otherwise, a row
 * that stands for nothing included.
 */
export function beginSweep(rows: readonly (readonly string[])[], anchor: number, selected: ReadonlySet<string>): Sweep {
  const here = rows[anchor] ?? [];
  return { anchor, select: !(here.length > 0 && here.every((id) => selected.has(id))), before: new Set(selected) };
}

/** The selection while the fingers are over row `current`: the rows from the anchor to it changed, and nothing else. */
export function sweepTo(rows: readonly (readonly string[])[], sweep: Sweep, current: number): Set<string> {
  const next = new Set(sweep.before);
  const from = Math.max(0, Math.min(sweep.anchor, current));
  const to = Math.min(rows.length - 1, Math.max(sweep.anchor, current));
  for (let at = from; at <= to; at++)
    for (const id of rows[at]) {
      if (sweep.select) next.add(id);
      else next.delete(id);
    }
  return next;
}

export interface Extent { top: number; height: number }

/**
 * The shown row at content offset `y`. Above the first row it is the first and
 * below the last the last; a row not laid out yet, which the list has never
 * rendered, is passed over for the nearest one that has been.
 */
export function rowAt(extents: readonly (Extent | undefined)[], y: number): number {
  let nearest = -1;
  let distance = Infinity;
  for (let at = 0; at < extents.length; at++) {
    const extent = extents[at];
    if (!extent) continue;
    if (y >= extent.top && y < extent.top + extent.height) return at;
    const away = y < extent.top ? extent.top - y : y - (extent.top + extent.height) + 1;
    if (away < distance) { nearest = at; distance = away; }
  }
  return nearest;
}

/**
 * How fast the list scrolls by itself, in points a second, while the fingers
 * are `y` points below the top of a list `height` points tall: nothing outside
 * a band `band` deep at either edge, and faster the deeper into the band,
 * up to `fastest` at the edge and beyond it. Negative is up.
 */
export function edgeSpeed(y: number, height: number, band: number, fastest: number): number {
  if (y < band) return -fastest * Math.min(1, (band - y) / band);
  if (y > height - band) return fastest * Math.min(1, (y - (height - band)) / band);
  return 0;
}
