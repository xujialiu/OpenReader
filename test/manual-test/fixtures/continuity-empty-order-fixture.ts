/**
 * `An Empty Order Check of Play`, for the #161 defining trigger in the order
 * the original report describes: the reported prefix is all empty, and the
 * out-of-order arrival puts a KNOWN EMPTY section (5) beyond the unknown gap,
 * so a Play must skip the known empty 5 and obtain the first text at 6.
 *
 *     npx tsx test/manual-test/fixtures/continuity-empty-order-fixture.ts OUTPUT_DIRECTORY
 *
 * Writes `An Empty Order Check of Play.epub`. Eight spine items:
 *
 * - `blank-a.xhtml` … `blank-e.xhtml` — blank, ~1000 px each (a spacer div and
 *   a hidden h1; nothing a sentence could come from)
 * - `blank-f.xhtml` — blank and ~3000 px (several screens), so displaying it
 *   does not automatically render section 6
 * - `one.xhtml`     — The First Chapter,  three paragraphs of three sentences
 * - `two.xhtml`     — The Second Chapter, three paragraphs of three sentences
 *
 * A fresh open at the start reports sections 0 and 1 (both empty; the manager
 * holds two 1000 px views). A browse to The End while paused reports section 5
 * and then section 4 (both empty), so `known` stays 0 while 5 and 4 are known
 * and 2–3 are unknown. Play must skip the known empty 5, obtain 6, and start
 * reading there. Every sentence names its chapter, paragraph and number. The
 * contents are an EPUB 2 `toc.ncx` on purpose (see fixtures/README.md).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { utf8, zip } from '../../core/document/zip-fixture';

const TITLE = 'An Empty Order Check of Play';

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

const blankPage = (name: string, hidden: string, height: number) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${name}</title></head>
<body>
  <h1 style="display:none">${hidden}</h1>
  <div style="height:${height}px"></div>
</body>
</html>
`;

const PACKAGE = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:openreader:empty-order-check-of-play</dc:identifier>
    <dc:title>${TITLE}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-10-13T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="blanka" href="blank-a.xhtml" media-type="application/xhtml+xml"/>
    <item id="blankb" href="blank-b.xhtml" media-type="application/xhtml+xml"/>
    <item id="blankc" href="blank-c.xhtml" media-type="application/xhtml+xml"/>
    <item id="blankd" href="blank-d.xhtml" media-type="application/xhtml+xml"/>
    <item id="blanke" href="blank-e.xhtml" media-type="application/xhtml+xml"/>
    <item id="blankf" href="blank-f.xhtml" media-type="application/xhtml+xml"/>
    <item id="one" href="one.xhtml" media-type="application/xhtml+xml"/>
    <item id="two" href="two.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="blanka"/><itemref idref="blankb"/><itemref idref="blankc"/><itemref idref="blankd"/><itemref idref="blanke"/><itemref idref="blankf"/><itemref idref="one"/><itemref idref="two"/></spine>
</package>
`;

const navPoint = (id: string, playOrder: number, label: string, src: string) =>
  `    <navPoint id="${id}" playOrder="${playOrder}">
      <navLabel><text>${label}</text></navLabel>
      <content src="${src}"/>
    </navPoint>`;

const NCX = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:openreader:empty-order-check-of-play"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>
  <docTitle><text>${TITLE}</text></docTitle>
  <navMap>
${navPoint('np-a', 1, 'Blank A', 'blank-a.xhtml')}
${navPoint('np-b', 2, 'Blank B', 'blank-b.xhtml')}
${navPoint('np-c', 3, 'Blank C', 'blank-c.xhtml')}
${navPoint('np-d', 4, 'Blank D', 'blank-d.xhtml')}
${navPoint('np-e', 5, 'Blank E', 'blank-e.xhtml')}
${navPoint('np-f', 6, 'Blank F', 'blank-f.xhtml')}
${navPoint('np-one', 7, 'The First Chapter', 'one.xhtml')}
${navPoint('np-two', 8, 'The Second Chapter', 'two.xhtml')}
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
    { name: 'OEBPS/blank-a.xhtml', data: utf8(blankPage('Blank A', 'Blank A', 1000)) },
    { name: 'OEBPS/blank-b.xhtml', data: utf8(blankPage('Blank B', 'Blank B', 1000)) },
    { name: 'OEBPS/blank-c.xhtml', data: utf8(blankPage('Blank C', 'Blank C', 1000)) },
    { name: 'OEBPS/blank-d.xhtml', data: utf8(blankPage('Blank D', 'Blank D', 1000)) },
    { name: 'OEBPS/blank-e.xhtml', data: utf8(blankPage('Blank E', 'Blank E', 1000)) },
    { name: 'OEBPS/blank-f.xhtml', data: utf8(blankPage('Blank F', 'Blank F', 3000)) },
    { name: 'OEBPS/one.xhtml', data: utf8(chapter('The First Chapter', 'First')) },
    { name: 'OEBPS/two.xhtml', data: utf8(chapter('The Second Chapter', 'Second')) },
  ]);
  writeFileSync(join(outDir, `${TITLE}.epub`), book);
  console.log(join(outDir, `${TITLE}.epub`));
}
