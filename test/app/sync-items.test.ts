import { describe, expect, it } from 'vitest';

import { createLocator, readLocator, readingPositionAt, type DocumentId, type LibraryEntry } from '../../src/core/document';
import type { PositionsItem } from '../../src/core/sync/positions-file';
import { itemsOf, planAdoption, samePlace } from '../../src/app/sync-items';

/**
 * The two pure halves of adoption (issue #20): the shelf as the Positions File
 * sees it, and the file as the shelf takes it. The rule under test is the one
 * the design turned on — a position's **own** Stamp decides, never the entry's.
 */

const A = ('sha256:' + 'a'.repeat(64)) as DocumentId;
const B = ('sha256:' + 'b'.repeat(64)) as DocumentId;

const entry = (id: DocumentId, over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id,
  format: 'epub',
  publicationId: 'urn:isbn:123',
  publicationIdSource: 'unique-identifier',
  title: 'A Book',
  position: readingPositionAt(createLocator('epub', 'epubcfi(/6/8[cop]!/4/2/4/4[p2])'), 'Copyright by the author. Then more.', 0, 24, { at: 100, device: 'iPhone-aaaaaaaa' }),
  voice: null,
  // The shelf's Stamp is newer than the position's: the book was opened again since.
  stamp: { at: 500, device: 'iPhone-aaaaaaaa' },
  ...over,
});

const item = (id: DocumentId, at: number, over: Partial<PositionsItem> = {}): PositionsItem => ({
  id,
  format: 'epub',
  publicationId: null,
  locator: 'epubcfi(/6/34!/4/2/4/2/4)',
  anchor: { exact: 'A sentence from the desktop.', prefix: '', suffix: '' },
  stamp: { at, device: 'Desktop' },
  ...over,
});

describe('itemsOf', () => {
  it('writes one item per entry with a position, assertion-stripped, publicationId null, the position stamp and not the entry stamp', () => {
    const items = itemsOf([entry(A), entry(B, { position: null })], 'iPhone-bbbbbbbb');
    expect(items).toEqual([
      {
        id: A,
        format: 'epub',
        publicationId: null,
        locator: 'epubcfi(/6/8!/4/2/4/4)',
        anchor: { exact: 'Copyright by the author.', prefix: '', suffix: ' Then more.' },
        stamp: { at: 100, device: 'iPhone-aaaaaaaa' },
      },
    ]);
  });

  it('signs a position that has no device of its own with this device, keeping its time unknown', () => {
    // A version-1 Library position reads with the oldest Stamp, `{ at: 0, device: '' }`,
    // and the spec allows no empty device — an item written with one could never be
    // adopted anywhere (seen on the owner's server, 2026-09-21).
    const stampless = entry(A, { position: { ...entry(A).position!, stamp: { at: 0, device: '' } } });
    expect(itemsOf([stampless], 'iPhone-bbbbbbbb')[0].stamp).toEqual({ at: 0, device: 'iPhone-bbbbbbbb' });
    expect(itemsOf([entry(A)], 'iPhone-bbbbbbbb')[0].stamp).toEqual({ at: 100, device: 'iPhone-aaaaaaaa' });
  });
});

describe('samePlace', () => {
  const place = (cfi: string, exact: string) => readingPositionAt(createLocator('epub', cfi), `${exact} Then more.`, 0, exact.length, { at: 1, device: 'x' });

  it('is the same sentence in the same Block, whichever way the locator is spelled', () => {
    expect(samePlace(place('epubcfi(/6/8[cop]!/4/2/4/4[p2])', 'Copyright by the author.'), place('epubcfi(/6/8!/4/2/4/4)', 'Copyright by the author.'), 'epub')).toBe(true);
  });

  it('is not the same place when the Block or the sentence differs', () => {
    expect(samePlace(place('epubcfi(/6/8!/4/2/4/4)', 'Copyright by the author.'), place('epubcfi(/6/8!/4/2/4/6)', 'Copyright by the author.'), 'epub')).toBe(false);
    expect(samePlace(place('epubcfi(/6/8!/4/2/4/4)', 'Copyright by the author.'), place('epubcfi(/6/8!/4/2/4/4)', 'Then more.'), 'epub')).toBe(false);
  });

  it('never calls two places the same across formats', () => {
    expect(samePlace(place('epubcfi(/6/8!/4/2/4/4)', 'x'), place('epubcfi(/6/8!/4/2/4/4)', 'x'), 'pdf' as never)).toBe(false);
  });
});

describe('planAdoption', () => {
  it('takes an item newer than the position, however new the entry stamp is', () => {
    // The entry was opened at 500; the desktop read at 200; the phone's own place is from 100. The desktop wins.
    const plan = planAdoption([entry(A)], [item(A, 200)]);
    expect(plan.adopted).toEqual([A]);
    const taken = plan.entries[0];
    expect(readLocator(taken.position!.locator, 'epub')).toBe('epubcfi(/6/34!/4/2/4/2/4)');
    expect(taken.position!.anchor.exact).toBe('A sentence from the desktop.');
    expect(taken.position!.stamp).toEqual({ at: 200, device: 'Desktop' });
    // The shelf's Stamp is already newer and stays.
    expect(taken.stamp).toEqual({ at: 500, device: 'iPhone-aaaaaaaa' });
  });

  it('moves the shelf stamp up when the adopted position is newer than it', () => {
    const plan = planAdoption([entry(A)], [item(A, 900)]);
    expect(plan.entries[0].stamp).toEqual({ at: 900, device: 'Desktop' });
  });

  it('keeps the local position when the item is not newer, and returns the same array', () => {
    const entries = [entry(A)];
    expect(planAdoption(entries, [item(A, 100)]).entries).toBe(entries);
    expect(planAdoption(entries, [item(A, 99)]).adopted).toEqual([]);
  });

  it('gives a Document with no position whatever the file holds', () => {
    const plan = planAdoption([entry(B, { position: null })], [item(B, 1)]);
    expect(plan.adopted).toEqual([B]);
    expect(plan.entries[0].position!.stamp.at).toBe(1);
  });

  it('ignores items for Documents not on the shelf, and items in another format', () => {
    const entries = [entry(A)];
    expect(planAdoption(entries, [item(B, 999)]).adopted).toEqual([]);
    expect(planAdoption(entries, [item(A, 999, { format: 'pdf' })]).adopted).toEqual([]);
  });
});
