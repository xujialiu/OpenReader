import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  isCarried,
  mergePositions,
  parsePositionsFile,
  POSITIONS_FILENAME,
  POSITIONS_FORMAT,
  POSITIONS_VERSION,
  serializePositionsFile,
  usableItems,
  type FileItem,
  type PositionsItem,
} from '../../../src/core/sync/positions-file';

/**
 * `docs/spec/SYNC-FORMAT.md` section 6 in the plugin repository, as this side
 * implements it. The fixture is shared with the plugin byte for byte: what one
 * product writes the other must parse and re-emit unchanged.
 */

const FIXTURE = readFileSync(new URL('./fixtures/xujialiu-positions.v1.json', import.meta.url), 'utf8');

const A = 'sha256:' + 'a'.repeat(64);
const B = 'sha256:' + 'b'.repeat(64);
const C = 'sha256:' + 'c'.repeat(64);

const item = (over: Partial<PositionsItem> = {}): PositionsItem => ({
  id: B,
  format: 'epub',
  publicationId: null,
  locator: 'epubcfi(/6/34!/4/2/4/2/4)',
  anchor: { exact: '铁柱坐在村内的小路边，望着远处的群山。', prefix: '', suffix: '' },
  stamp: { at: 1_758_470_000_000, device: 'iPhone-3f9a2c1b' },
  ...over,
});

describe('the shared fixture', () => {
  it('names the file and the format the spec names', () => {
    expect(POSITIONS_FILENAME).toBe('xujialiu-positions.json');
    expect(POSITIONS_FORMAT).toBe('xujialiu-positions');
    expect(POSITIONS_VERSION).toBe(1);
  });

  it('round-trips to the same bytes', () => {
    const parsed = parsePositionsFile(FIXTURE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.dropped).toBe(0);
    expect(serializePositionsFile(parsed.items)).toBe(FIXTURE);
  });

  it('carries the pdf item through unchanged and never offers it for adoption', () => {
    const parsed = parsePositionsFile(FIXTURE);
    if (!parsed.ok) throw new Error('fixture did not parse');
    const pdf = parsed.items.find((one) => one.id === A);
    expect(pdf && isCarried(pdf)).toBe(true);
    expect(usableItems(parsed.items).map((one) => one.id)).toEqual([B]);
    // Carried, and still merged by its Stamp: a newer pdf item from elsewhere replaces it, an older one does not.
    const newer = { ...parsed.items.find((one) => one.id === A)!, stamp: { at: 2, device: 'Desktop' } } as FileItem;
    const merged = mergePositions(parsed.items, [newer]);
    expect(merged.find((one) => one.id === A)).toBe(newer);
    expect(serializePositionsFile(mergePositions(parsed.items, [{ ...newer, stamp: { at: 0, device: 'Desktop' } } as FileItem]))).toBe(FIXTURE);
  });

  it('reads the epub item as usable, every field validated', () => {
    const parsed = parsePositionsFile(FIXTURE);
    if (!parsed.ok) throw new Error('fixture did not parse');
    expect(usableItems(parsed.items)).toEqual([item()]);
  });
});

describe('serializePositionsFile', () => {
  it('is canonical: compact, keys in the spec order, items sorted by id', () => {
    const text = serializePositionsFile([item({ id: C }), item({ id: A })]);
    expect(text.startsWith('{"format":"xujialiu-positions","version":1,"items":[{"id":"sha256:aaaa')).toBe(true);
    expect(text).not.toContain('\n');
    expect(text).not.toContain(': ');
    const file = JSON.parse(text);
    expect(Object.keys(file)).toEqual(['format', 'version', 'items']);
    expect(Object.keys(file.items[0])).toEqual(['id', 'format', 'publicationId', 'locator', 'anchor', 'stamp']);
    expect(Object.keys(file.items[0].anchor)).toEqual(['exact', 'prefix', 'suffix']);
    expect(Object.keys(file.items[0].stamp)).toEqual(['at', 'device']);
    expect(file.items.map((one: { id: string }) => one.id)).toEqual([A, C]);
  });

  it('writes one item per id, keeping the first', () => {
    const text = serializePositionsFile([item({ stamp: { at: 5, device: 'x' } }), item({ stamp: { at: 9, device: 'y' } })]);
    expect(JSON.parse(text).items).toHaveLength(1);
    expect(JSON.parse(text).items[0].stamp.at).toBe(5);
  });

  it('writes nothing it was not given: no trailing newline, no indentation', () => {
    expect(serializePositionsFile([])).toBe('{"format":"xujialiu-positions","version":1,"items":[]}');
  });
});

describe('parsePositionsFile', () => {
  it('leaves a newer version alone', () => {
    const newer = JSON.stringify({ format: POSITIONS_FORMAT, version: POSITIONS_VERSION + 1, items: [] });
    expect(parsePositionsFile(newer)).toEqual({ ok: false, reason: 'newer', version: POSITIONS_VERSION + 1 });
  });

  it('calls a file malformed when it is not JSON, not this format, or has no items', () => {
    expect(parsePositionsFile('not json')).toMatchObject({ ok: false, reason: 'malformed' });
    expect(parsePositionsFile('[]')).toMatchObject({ ok: false, reason: 'malformed' });
    expect(parsePositionsFile(JSON.stringify({ format: 'zotero-tts-positions', version: 1, items: [] }))).toMatchObject({ ok: false, reason: 'malformed' });
    expect(parsePositionsFile(JSON.stringify({ format: POSITIONS_FORMAT, version: '1', items: [] }))).toMatchObject({ ok: false, reason: 'malformed' });
    expect(parsePositionsFile(JSON.stringify({ format: POSITIONS_FORMAT, version: 1, items: {} }))).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('drops only an item with no id string, and counts it', () => {
    const text = JSON.stringify({ format: POSITIONS_FORMAT, version: 1, items: [{ format: 'epub' }, 'x', null, item()] });
    const parsed = parsePositionsFile(text);
    expect(parsed.ok && parsed.dropped).toBe(3);
    expect(parsed.ok && parsed.items).toHaveLength(1);
  });

  it('carries an item it cannot use rather than dropping it: unknown format, bad locator, empty anchor, bad stamp, bad id', () => {
    const bad: unknown[] = [
      { ...item({ id: A }), format: 'snapshot' },
      { ...item({ id: B }), locator: '' },
      { ...item({ id: C }), anchor: { exact: '', prefix: '', suffix: '' } },
      { ...item({ id: 'sha256:' + 'd'.repeat(64) }), stamp: { at: 1.5, device: 'x' } },
      { ...item(), id: 'not-an-id' },
    ];
    const parsed = parsePositionsFile(JSON.stringify({ format: POSITIONS_FORMAT, version: 1, items: bad }));
    if (!parsed.ok) throw new Error('did not parse');
    expect(parsed.items).toHaveLength(5);
    expect(parsed.items.every(isCarried)).toBe(true);
    expect(usableItems(parsed.items)).toEqual([]);
    // And re-emitted with the six fields as they were.
    const out = JSON.parse(serializePositionsFile(parsed.items));
    expect(out.items.find((one: { id: string }) => one.id === A).format).toBe('snapshot');
    expect(out.items.find((one: { id: string }) => one.id === 'not-an-id').anchor.exact).toBe(item().anchor.exact);
  });

  it('carries a usable item whose stamp is not an integer, so a later writer with a real one wins', () => {
    const parsed = parsePositionsFile(JSON.stringify({ format: POSITIONS_FORMAT, version: 1, items: [{ ...item(), stamp: { at: 'yesterday', device: 'x' } }] }));
    if (!parsed.ok) throw new Error('did not parse');
    expect(isCarried(parsed.items[0]) && parsed.items[0].stamp).toBeNull();
    expect(mergePositions(parsed.items, [item({ stamp: { at: 1, device: 'y' } })])[0]).toEqual(item({ stamp: { at: 1, device: 'y' } }));
  });
});

describe('mergePositions', () => {
  it('takes the newer stamp per id and keeps mine on a tie', () => {
    const mine = [item({ stamp: { at: 10, device: 'phone' } })];
    expect(mergePositions(mine, [item({ stamp: { at: 11, device: 'desk' } })])[0].stamp).toEqual({ at: 11, device: 'desk' });
    expect(mergePositions(mine, [item({ stamp: { at: 10, device: 'desk' } })])[0].stamp).toEqual({ at: 10, device: 'phone' });
    expect(mergePositions(mine, [item({ stamp: { at: 9, device: 'desk' } })])[0].stamp).toEqual({ at: 10, device: 'phone' });
  });

  it('is a union: nothing is removed, and merging a file into itself changes nothing', () => {
    const parsed = parsePositionsFile(FIXTURE);
    if (!parsed.ok) throw new Error('fixture did not parse');
    expect(serializePositionsFile(mergePositions(parsed.items, parsed.items))).toBe(FIXTURE);
    const union = mergePositions([item({ id: C })], parsed.items);
    expect(union.map((one) => one.id)).toEqual([A, B, C]);
  });
});
