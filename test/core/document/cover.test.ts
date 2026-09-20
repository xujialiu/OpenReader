import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readDocumentCover } from '../../../src/core/document/cover';
import { bytesAsArchive } from '../../../src/core/document/zip';

function epub(packageXml: string, imageName = 'OPS/images/cover.png') {
  return zipSync({
    'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OPS/package.opf': strToU8(packageXml),
    [imageName]: new Uint8Array([137, 80, 78, 71]),
    'OPS/large-chapter.xhtml': strToU8('not needed for the cover'.repeat(20000)),
  });
}
describe('local EPUB covers', () => {
  it('reads an EPUB 3 cover without inflating chapters', () => {
    const bytes = epub('<package><manifest><item id="art" properties="nav cover-image" href="images/cover.png" media-type="image/png"/></manifest></package>');
    expect(readDocumentCover(bytesAsArchive(bytes))).toEqual({ extension: 'png', bytes: new Uint8Array([137, 80, 78, 71]) });
  });
  it('resolves an EPUB 2 metadata reference and escaped relative paths', () => {
    const bytes = epub('<package><metadata><meta name="cover" content="art"/></metadata><manifest><item id="art" href="../Pictures/my%20cover.png" media-type="image/png"/></manifest></package>', 'Pictures/my cover.png');
    expect(readDocumentCover(bytesAsArchive(bytes))?.extension).toBe('png');
  });
  it('returns no cover for documents without one', () => {
    expect(readDocumentCover(bytesAsArchive(epub('<package><manifest/></package>')))).toBeNull();
  });
  it('does not follow remote cover addresses', () => {
    expect(() => readDocumentCover(bytesAsArchive(epub('<package><manifest><item properties="cover-image" href="https://example.com/art.png" media-type="image/png"/></manifest></package>')))).toThrow('inside its document');
  });
  it('refuses members above the image size budget before reading them', () => {
    const bytes = epub('<package><manifest><item properties="cover-image" href="images/cover.png" media-type="image/png"/></manifest></package>');
    const copy = bytes.slice();
    const view = new DataView(copy.buffer);
    for (let at = 0; at < copy.length - 46; at++) {
      if (view.getUint32(at, true) !== 0x02014b50) continue;
      const name = new TextDecoder().decode(copy.subarray(at + 46, at + 46 + view.getUint16(at + 28, true)));
      if (name === 'OPS/images/cover.png') view.setUint32(at + 24, 9 * 1024 * 1024, true);
    }
    expect(() => readDocumentCover(bytesAsArchive(copy))).toThrow('too large');
  });
});
