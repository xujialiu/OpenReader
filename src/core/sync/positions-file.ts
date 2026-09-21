/**
 * The **Positions File** (CONTEXT.md): `xujialiu-positions.json` in the Sync
 * Folder, every device's Reading Positions keyed by Document Id, written by the
 * phones and by the desktop plugin alike.
 *
 * The contract is the plugin repository's `docs/spec/SYNC-FORMAT.md`, section
 * 6; this file implements it and adds nothing to it. Three rules from there are
 * load-bearing enough to restate:
 *
 * - **Canonical bytes.** Two writers holding the same items produce the same
 *   text — compact JSON, keys in a fixed order, items sorted by `id` — so the
 *   transport can compare text to decide whether to upload at all.
 * - **Carry through, never drop.** An item this build cannot use (a `format` it
 *   does not implement, a field it cannot validate) is re-emitted with its six
 *   fields as parsed and is never adopted. A phone that dropped the desktop's
 *   PDF positions on its way through would be erasing them for every machine.
 *   The one item that is dropped is one with no `id` string, which nothing can
 *   key, and that drop is counted rather than silent.
 * - **A newer version is left alone.** Not read, not written. A malformed file
 *   is treated as absent and healed by the next upload, which is safe because
 *   every device holds its own items locally (spec 2.2).
 */

import type { TextAnchor } from '../document/anchor';
import { newerThan, type Stamp } from '../document/stamp';

export const POSITIONS_FILENAME = 'xujialiu-positions.json';
export const POSITIONS_FORMAT = 'xujialiu-positions';
/** The only version this build writes, and the highest it reads. */
export const POSITIONS_VERSION = 1;

/** The formats this build can adopt a position for. Everything else is carried through. */
const USABLE_FORMATS: readonly string[] = ['epub'];

const DOCUMENT_ID = /^sha256:[0-9a-f]{64}$/;

/** One item of the file, validated: every field is what the spec says it is, and the format is one this build implements. */
export interface PositionsItem {
  id: string;
  format: string;
  publicationId: string | null;
  locator: string;
  anchor: TextAnchor;
  stamp: Stamp;
}

/**
 * An item this build carries through without using: its `id`, and its six
 * fields exactly as parsed. `stamp` is kept separately when it could be read,
 * because a carried item still takes part in the merge by its Stamp.
 */
export interface CarriedItem {
  id: string;
  carried: true;
  fields: Record<string, unknown>;
  stamp: Stamp | null;
}

export type FileItem = PositionsItem | CarriedItem;

export type PositionsParse =
  | { ok: true; version: number; items: FileItem[]; /** Items with no `id` string, which nothing can key. */ dropped: number }
  | { ok: false; reason: 'malformed'; why: string }
  | { ok: false; reason: 'newer'; version: number };

export function isCarried(item: FileItem): item is CarriedItem {
  return (item as CarriedItem).carried === true;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const ITEM_KEYS = ['id', 'format', 'publicationId', 'locator', 'anchor', 'stamp'] as const;

function parseStamp(raw: unknown): Stamp | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.at !== 'number' || !Number.isInteger(raw.at) || typeof raw.device !== 'string' || !raw.device) return null;
  return { at: raw.at, device: raw.device };
}

function parseItem(raw: unknown): FileItem | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null;
  const id = raw.id;
  const fields: Record<string, unknown> = {};
  for (const key of ITEM_KEYS) fields[key] = raw[key];
  const stamp = parseStamp(raw.stamp);
  const carried: CarriedItem = { id, carried: true, fields, stamp };

  if (!DOCUMENT_ID.test(id)) return carried;
  if (typeof raw.format !== 'string' || !USABLE_FORMATS.includes(raw.format)) return carried;
  if (raw.publicationId !== null && typeof raw.publicationId !== 'string') return carried;
  if (typeof raw.locator !== 'string' || !raw.locator) return carried;
  const anchor = raw.anchor;
  if (!isRecord(anchor) || typeof anchor.exact !== 'string' || !anchor.exact) return carried;
  if (typeof anchor.prefix !== 'string' || typeof anchor.suffix !== 'string') return carried;
  if (!stamp) return carried;
  return {
    id,
    format: raw.format,
    publicationId: raw.publicationId,
    locator: raw.locator,
    anchor: { exact: anchor.exact, prefix: anchor.prefix, suffix: anchor.suffix },
    stamp,
  };
}

/** Read a positions file. `malformed` is treated as absent by the caller; `newer` must be left alone. */
export function parsePositionsFile(text: string): PositionsParse {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'malformed', why: 'not JSON' };
  }
  if (!isRecord(file)) return { ok: false, reason: 'malformed', why: 'not an object' };
  if (file.format !== POSITIONS_FORMAT) return { ok: false, reason: 'malformed', why: 'not a positions file' };
  const version = file.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return { ok: false, reason: 'malformed', why: 'no version' };
  if (!Array.isArray(file.items)) return { ok: false, reason: 'malformed', why: 'no items' };
  if (version > POSITIONS_VERSION) return { ok: false, reason: 'newer', version };

  const items: FileItem[] = [];
  let dropped = 0;
  for (const raw of file.items) {
    const item = parseItem(raw);
    if (item) items.push(item);
    else dropped++;
  }
  return { ok: true, version, items, dropped };
}

/** `id` order as the spec has it: by UTF-16 code unit, which for these ASCII ids is byte order. */
function byId(a: FileItem, b: FileItem): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function itemJson(item: FileItem): Record<string, unknown> {
  if (isCarried(item)) {
    const out: Record<string, unknown> = {};
    for (const key of ITEM_KEYS) out[key] = item.fields[key];
    return out;
  }
  return {
    id: item.id,
    format: item.format,
    publicationId: item.publicationId,
    locator: item.locator,
    anchor: { exact: item.anchor.exact, prefix: item.anchor.prefix, suffix: item.anchor.suffix },
    stamp: { at: item.stamp.at, device: item.stamp.device },
  };
}

/**
 * The canonical text of these items: compact, keys in the spec's order, sorted
 * by `id`, one item per `id` (the first wins, which `mergePositions` has already
 * decided). Equal content is equal text.
 */
export function serializePositionsFile(items: readonly FileItem[]): string {
  const seen = new Set<string>();
  const unique: FileItem[] = [];
  for (const item of [...items].sort(byId)) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  return JSON.stringify({ format: POSITIONS_FORMAT, version: POSITIONS_VERSION, items: unique.map(itemJson) });
}

function stampOf(item: FileItem): Stamp | null {
  return isCarried(item) ? item.stamp : item.stamp;
}

/**
 * The union per `id`: the greater `stamp.at` wins, an equal one keeps `mine`,
 * so merging a file into itself changes nothing. An item whose Stamp could not
 * be read loses to any that has one, and two such keep `mine`'s. Nothing is
 * ever removed (spec 6.7).
 */
export function mergePositions(mine: readonly FileItem[], theirs: readonly FileItem[]): FileItem[] {
  const byKey = new Map<string, FileItem>();
  for (const item of mine) if (!byKey.has(item.id)) byKey.set(item.id, item);
  for (const item of theirs) {
    const held = byKey.get(item.id);
    if (!held) {
      byKey.set(item.id, item);
      continue;
    }
    const candidate = stampOf(item);
    if (!candidate) continue;
    const kept = stampOf(held);
    if (!kept || newerThan(candidate, kept)) byKey.set(item.id, item);
  }
  return [...byKey.values()].sort(byId);
}

/** The items this build can act on, out of a merged list. */
export function usableItems(items: readonly FileItem[]): PositionsItem[] {
  return items.filter((item): item is PositionsItem => !isCarried(item));
}
