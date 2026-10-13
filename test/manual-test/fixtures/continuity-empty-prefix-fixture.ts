/**
 * `An Empty Prefix Check of Play`, for the exact #161 trigger on the simulator:
 * the reported prefix is all empty, and empty sections also arrive out of
 * order, before any text has reported.
 *
 *     npx tsx test/manual-test/fixtures/continuity-empty-prefix-fixture.ts OUTPUT_DIRECTORY
 *
 * Writes `An Empty Prefix Check of Play.epub`. Five spine items:
 *
 * - `empty-a.xhtml`   — empty (hidden heading + non-breaking space)
 * - `empty-b.xhtml`   — empty
 * - `one.xhtml`       — The First Chapter,  three paragraphs of three sentences
 * - `two.xhtml`       — The Second Chapter, three paragraphs of three sentences
 * - `empty-last.xhtml`— empty, as the LAST spine item
 *
 * A fresh open at the start reports sections 0 and 1 — both empty — so the
 * whole reported prefix is empty when Play is pressed (#161: the reading used
 * to wait for ever on an already reported section). A Contents/browse to The
 * End while paused adds sections 3 (text) and 4 (empty) out of order, before
 * section 2 has reported. Every sentence names its chapter, paragraph and
 * number, so one line of the fake provider's request log maps to one Utterance.
 * The contents are an EPUB 2 `toc.ncx` on purpose (see fixtures/README.md).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { utf8, zip } from '../../core/document/zip-fixture';

const TITLE = 'An Empty Prefix Check of Play';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

const chapter = (name: string, ordinal: string) => {
  const out: string[] = [];
  for (let p = 1; p <= 3; p++) {
    const sentences: string[] = [];
    for (let s = 1; s <= 3; s++) {
      sentences.push(
        `<span id="s${p}${s}">${ordinal} chapter, paragraph ${p}, sentence ${s}, spoken plainly for the measurement.</span>`,
      );
    }
    out.push(`    <p>${sentences.join(' ')}</p>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${name}</title></head>
<body>
  <h2>${name}</h2>
${out.join('\n')}
</body>
</html>
`;
};

const emptyPage = (name: string, hidden: string) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${name}</title></head>
<body>
  <h1 style="display:none">${hidden}</h1>
  <p>&#160;</p>
</body>
</html>
`;

const PACKAGE = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:openreader:empty-prefix-check-of-play</dc:identifier>
    <dc:title>${TITLE}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-10-13T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="emptya" href="empty-a.xhtml" media-type="application/xhtml+xml"/>
    <item id="emptyb" href="empty-b.xhtml" media-type="application/xhtml+xml"/>
    <item id="one" href="one.xhtml" media-type="application/xhtml+xml"/>
    <item id="two" href="two.xhtml" media-type="application/xhtml+xml"/>
    <item id="emptylast" href="empty-last.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="emptya"/><itemref idref="emptyb"/><itemref idref="one"/><itemref idref="two"/><itemref idref="emptylast"/></spine>
</package>
`;

const navPoint = (id: string, playOrder: number, label: string, src: string) =>
  `    <navPoint id="${id}" playOrder="${playOrder}">
      <navLabel><text>${label}</text></navLabel>
      <content src="${src}"/>
    </navPoint>`;

const NCX = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:openreader:empty-prefix-check-of-play"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>
  <docTitle><text>${TITLE}</text></docTitle>
  <navMap>
${navPoint('np-a', 1, 'Empty A', 'empty-a.xhtml')}
${navPoint('np-b', 2, 'Empty B', 'empty-b.xhtml')}
${navPoint('np-one', 3, 'The First Chapter', 'one.xhtml')}
${navPoint('np-two', 4, 'The Second Chapter', 'two.xhtml')}
${navPoint('np-end', 5, 'The End', 'empty-last.xhtml')}
  </navMap>
</ncx>
`;

const outDir = process.argv[2];
if (outDir) {
  mkdirSync(outDir, { recursive: true });
  const book = zip([
    { name: 'mimetype', data: utf8('application/epub+zip') },
    { name: 'META-INF/container.xml', data: utf8(CONTAINER) },
    { name: 'OEBPS/content.opf', data: utf8(PACKAGE) },
    { name: 'OEBPS/toc.ncx', data: utf8(NCX) },
    { name: 'OEBPS/empty-a.xhtml', data: utf8(emptyPage('Empty A', 'Empty A')) },
    { name: 'OEBPS/empty-b.xhtml', data: utf8(emptyPage('Empty B', 'Empty B')) },
    { name: 'OEBPS/one.xhtml', data: utf8(chapter('The First Chapter', 'First')) },
    { name: 'OEBPS/two.xhtml', data: utf8(chapter('The Second Chapter', 'Second')) },
    { name: 'OEBPS/empty-last.xhtml', data: utf8(emptyPage('The End', 'The End')) },
  ]);
  writeFileSync(join(outDir, `${TITLE}.epub`), book);
  console.log(join(outDir, `${TITLE}.epub`));
}
