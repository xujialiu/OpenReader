import { describe, expect, it } from 'vitest';
import { bytesAsArchive } from '../../src/core/document/zip';
import { createLocator, readingPlaceAt } from '../../src/core/document/position';
import { indexReadingText, readingPercentage } from '../../src/renderer/reading-progress';
import { utf8, zip } from '../core/document/zip-fixture';

const archive = bytesAsArchive(zip([
  { name: 'META-INF/container.xml', data: utf8('<container><rootfile full-path="OPS/book.opf"/></container>') },
  { name: 'OPS/book.opf', data: utf8('<package><manifest><item id="a" href="a.xhtml"/><item id="b" href="b.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>') },
  { name: 'OPS/a.xhtml', data: utf8('<html><head><title>Not正文</title></head><body><p>12345678</p></body></html>') },
  { name: 'OPS/b.xhtml', data: utf8('<html><head/><body><p hidden>hidden</p><p>Read. <b>Next.</b></p><style>p { color: red }</style><p>' + 'a'.repeat(83) + '</p></body></html>') },
], { level: 6 }));
const yieldNow = async () => {};
const saved = (step: string, text: string, start = 0) =>
  readingPlaceAt(createLocator('epub', `epubcfi(/6/4[b]!/4/${step})`), text, start, text.length);

describe('Reading Progress', () => {
  it('weights sections by body text and locates the saved sentence inside its element', async () => {
    const lengths = await indexReadingText(archive, yieldNow);
    expect(lengths).toEqual([{ path: 'OPS/a.xhtml', length: 8 }, { path: 'OPS/b.xhtml', length: 93 }]);
    expect(await readingPercentage(archive, lengths, saved('4', 'Read. Next.', 6), yieldNow)).toBe(13);
    expect(await readingPercentage(archive, lengths, saved('4', 'Read.', 0), yieldNow)).toBe(8);
  });
  it('declines a stale locator, changed index or mismatched quotation', async () => {
    const lengths = await indexReadingText(archive, yieldNow);
    expect(await readingPercentage(archive, lengths, saved('2', 'hidden'), yieldNow)).toBeNull();
    expect(await readingPercentage(archive, lengths, saved('4', 'Elsewhere!'), yieldNow)).toBeNull();
    lengths[1].length++;
    expect(await readingPercentage(archive, lengths, saved('4', 'Read.'), yieldNow)).toBeNull();
  });
});
