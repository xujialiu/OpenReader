import { useEffect, useState } from 'react';
import { View, type CellRendererProps, type FlatList, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import type { Chapter } from '../offline/model';
import { beginSweep, edgeSpeed, rowAt, rowChapters, sweepTo, type Extent, type Sweep } from './range-selection';

/**
 * How deep the band at each end of the list is where a sweep scrolls it by
 * itself, and how fast it goes at the edge and beyond, in points and points a
 * second: Files' own, measured on iOS 27.0 (ADR 0045).
 */
const EDGE_BAND = 24;
const EDGE_FASTEST = 1500;

export interface SweepRows {
  /** The rows as shown, top to bottom. */
  shown: Chapter[];
  chapters: Chapter[];
  collapsed: ReadonlySet<string>;
  /** The chapters a tap could choose now. */
  choosable: ReadonlySet<string>;
  selected: ReadonlySet<string>;
}

/**
 * The gesture, and what it needs to know about the list, kept in one object
 * made once per drawer: none of it is drawn, and all of it is read only while
 * fingers move, so it stays out of render entirely.
 */
export interface SelectableRows {
  ids: readonly string[];
  values: readonly (readonly string[])[];
  selected: ReadonlySet<string>;
  enabled?: boolean;
  /** Changing locations ends the old sweep and resets its scroll origin. */
  scope?: string;
  /** Floating actions cover this much of the viewport's bottom edge. */
  bottomInset?: number;
}

class SweepController<T> {
  private rows: SelectableRows = { ids: [], values: [], selected: new Set() };
  private select: (next: Set<string>) => void = () => {};
  private flatList: Pick<FlatList<T>, 'scrollToOffset'> | null = null;
  private readonly extents = new Map<string, Extent>();
  private scrolled = 0;
  private viewport = 0;
  private content = 0;
  private active: {
    rows: readonly (readonly string[])[]; ids: readonly string[]; state: Sweep;
    /** The row the fingers are over, and their height in the list. */
    at: number; y: number;
    last: number; timer: ReturnType<typeof setInterval>;
  } | null = null;

  readonly gesture = sweepGesture(this);
  // The Library wraps its ScrollView with this dependency: without it a vertical
  // two-finger drag can become a native scroll before the selection pan starts.
  readonly nativeGesture = Gesture.Native().requireExternalGestureToFail(this.gesture);

  private readonly Cell = recordingCell<T>(this.extents);

  readonly list = {
    ref: (list: Pick<FlatList<T>, 'scrollToOffset'> | null) => { this.flatList = list; },
    CellRendererComponent: this.Cell,
    scrollEventThrottle: 16,
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => { this.scrolled = event.nativeEvent.contentOffset.y; },
    onLayout: (event: LayoutChangeEvent) => { this.viewport = event.nativeEvent.layout.height; },
    onContentSizeChange: (_width: number, height: number) => { this.content = height; },
  };

  /** The drawer as it was last drawn, for the next sweep to read. */
  show(rows: SelectableRows, select: (next: Set<string>) => void): void {
    if (rows.enabled === false || rows.scope !== this.rows.scope ||
        rows.ids.length !== this.rows.ids.length || rows.ids.some((id, at) => id !== this.rows.ids[at]) ||
        rows.values.some((value, at) => value.length !== this.rows.values[at]?.length || value.some((id, index) => id !== this.rows.values[at]?.[index]))) this.end();
    if (rows.scope !== this.rows.scope) this.scrolled = 0;
    this.rows = rows;
    this.select = select;
  }

  private under(ids: readonly string[], y: number): number {
    return rowAt(ids.map((id) => this.extents.get(id)), this.scrolled + y);
  }

  begin(y: number): void {
    this.end();
    const { ids, values: rows, selected, enabled } = this.rows;
    if (enabled === false) return;
    const anchor = this.under(ids, y);
    if (anchor < 0) return;
    const state = beginSweep(rows, anchor, selected);
    this.active = { rows, ids, state, at: anchor, y, last: Date.now(), timer: setInterval(() => this.edge(), 16) };
    this.select(sweepTo(rows, state, anchor));
  }

  move(y: number): void {
    if (!this.active) return;
    this.active.y = y;
    this.follow();
  }

  private follow(): void {
    const now = this.active;
    if (!now) return;
    const at = this.under(now.ids, now.y);
    if (at < 0 || at === now.at) return;
    now.at = at;
    this.select(sweepTo(now.rows, now.state, at));
  }

  /** While the fingers are held in a band at either edge, the list scrolls by itself and the run follows it. */
  private edge(): void {
    const now = this.active;
    if (!now) return;
    const time = Date.now();
    const seconds = (time - now.last) / 1000;
    now.last = time;
    const speed = edgeSpeed(now.y, Math.max(0, this.viewport - (this.rows.bottomInset ?? 0)), EDGE_BAND, EDGE_FASTEST);
    if (!speed) return;
    const offset = Math.min(Math.max(0, this.content - this.viewport), Math.max(0, this.scrolled + speed * seconds));
    if (offset === this.scrolled) return;
    this.scrolled = offset;
    this.flatList?.scrollToOffset({ offset, animated: false });
    this.follow();
  }

  end(): void {
    if (this.active) clearInterval(this.active.timer);
    this.active = null;
  }
}

/**
 * A list cell that records where its row sits in the list's content while it
 * is mounted, and hands the list its own layout callback as the default cell
 * would. A mounted cell reports again whenever it moves; one the list has let
 * go of forgets its place, because a volume folded or opened above it since
 * would have moved it, and a stale place could claim the fingers.
 */
function recordingCell<T>(extents: Map<string, Extent>) {
  return function RecordingCell({ item: _item, onLayout, cellKey, index: _index, ...cell }: CellRendererProps<T>) {
    useEffect(() => () => { extents.delete(cellKey); }, [cellKey]);
    return <View {...cell} onLayout={(event: LayoutChangeEvent) => {
      extents.set(cellKey, { top: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height });
      onLayout?.(event);
    }} />;
  };
}

/**
 * The two-finger pan, calling into `sweep` by name: Expo's Babel preset turns
 * a gesture's callbacks into worklets, rewriting each arrow function as a
 * plain one, so a callback written as `() => this.begin()` inside the class
 * met `this` undefined (measured, ADR 0045).
 */
function sweepGesture<T>(sweep: SweepController<T>) {
  return Gesture.Pan().minPointers(2).minDistance(0).runOnJS(true)
    .onStart((event) => sweep.begin(event.y))
    .onUpdate((event) => sweep.move(event.y))
    .onFinalize(() => sweep.end());
}

/**
 * Two fingers dragged over the download drawer's list select the rows under
 * them, and the list scrolls by itself while they are held at either edge
 * (#57, ADR 0045). The rules are `range-selection.ts`; this is the gesture
 * and the list it reads.
 *
 * The gesture is gesture-handler's pan for two pointers, activated on its
 * first movement so the list's own one-finger pan, which waits for about ten
 * points, never scrolls under two fingers. Its callbacks run on the JavaScript
 * thread (`runOnJS`): Expo's Babel preset turns them into worklets, and with no
 * Reanimated installed a worklet callback is never called (measured, ADR 0045).
 *
 * The row under the fingers comes from where each shown row was last laid out
 * in the list's content, recorded by the cell wrapper the list is given,
 * because rows differ in height and only a window of them is ever rendered.
 */
export function useSweep(rows: SweepRows, select: (next: Set<string>) => void) {
  return useRowSweep<Chapter>({
    ids: rows.shown.map((row) => row.id), values: rowChapters(rows.shown, rows.chapters, rows.collapsed, rows.choosable), selected: rows.selected,
  }, select);
}

/** Shared mechanics for the Library and chapter list; callers define what each row selects. */
export function useRowSweep<T>(rows: SelectableRows, select: (next: Set<string>) => void) {
  const [controller] = useState(() => new SweepController<T>());
  // After render, never during it: the gesture reads them only when fingers move.
  useEffect(() => controller.show(rows, select));
  useEffect(() => () => controller.end(), [controller]);
  return { gesture: controller.gesture, nativeGesture: controller.nativeGesture, list: controller.list };
}
