/**
 * `An Empty Gap Check of Play`, for the exact #161 trigger that needs a stable
 * state: the reported prefix is ALL empty (three blank spine items tall enough
 * that the continuous manager stops at them), the next section is unreported,
 * and empty/text sections can arrive out of order beyond the gap.
 *
 *     npx tsx test/manual-test/fixtures/continuity-empty-gap-fixture.ts OUTPUT_DIRECTORY
 *
 * Writes `An Empty Gap Check of Play.epub`. Six spine items:
 *
 * - `blank-a.xhtml`   — blank, ~1000 px tall (a spacer div and a hidden h1;
 *   nothing a sentence could come from)
 * - `blank-b.xhtml`   — blank, ~1000 px
 * - `blank-c.xhtml`   — blank, ~1000 px
 * - `one.xhtml`       — The First Chapter,  three paragraphs of three sentences
 * - `two.xhtml`       — The Second Chapter, three paragraphs of three sentences
 * - `blank-end.xhtml` — blank, the LAST spine item
 *
 * A fresh open at the start renders and reports sections 0–2 only: the whole
 * reported prefix is empty and section 3 is unknown. A browse to The End while
 * paused reports 4 (text) and 5 (empty) out of order, leaving the gap at 3.
 * Every sentence names its chapter, paragraph and number. The contents are an
 * EPUB 2 `toc.ncx` on purpose (see fixtures/README.md).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { utf8, zip } from '../../core/document/zip-fixture';

const TITLE = 'An Empty Gap Check of Play';

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

const blankPage = (name: string, hidden: string) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${name}</title></head>
<body>
  <h1 style="display:none">${hidden}</h1>
  <div style="height:1000px"></div>
</body>
</html>
`;

const PACKAGE = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:openreader:empty-gap-check-of-play</dc:identifier>
    <dc:title>${TITLE}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-10-13T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="blanka" href="blank-a.xhtml" media-type="application/xhtml+xml"/>
    <item id="blankb" href="blank-b.xhtml" media-type="application/xhtml+xml"/>
    <item id="blankc" href="blank-c.xhtml" media-type="application/xhtml+xml"/>
    <item id="one" href="one.xhtml" media-type="application/xhtml+xml"/>
    <item id="two" href="two.xhtml" media-type="application/xhtml+xml"/>
    <item id="blankend" href="blank-end.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="blanka"/><itemref idref="blankb"/><itemref idref="blankc"/><itemref idref="one"/><itemref idref="two"/><itemref idref="blankend"/></spine>
</package>
`;

const navPoint = (id: string, playOrder: number, label: string, src: string) =>
  `    <navPoint id="${id}" playOrder="${playOrder}">
      <navLabel><text>${label}</text></navLabel>
      <content src="${src}"/>
    </navPoint>`;

const NCX = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:openreader:empty-gap-check-of-play"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>
  <docTitle><text>${TITLE}</text></docTitle>
  <navMap>
${navPoint('np-a', 1, 'Blank A', 'blank-a.xhtml')}
${navPoint('np-b', 2, 'Blank B', 'blank-b.xhtml')}
${navPoint('np-c', 3, 'Blank C', 'blank-c.xhtml')}
${navPoint('np-one', 4, 'The First Chapter', 'one.xhtml')}
${navPoint('np-two', 5, 'The Second Chapter', 'two.xhtml')}
${navPoint('np-end', 6, 'The End', 'blank-end.xhtml')}
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
    { name: 'OEBPS/blank-a.xhtml', data: utf8(blankPage('Blank A', 'Blank A')) },
    { name: 'OEBPS/blank-b.xhtml', data: utf8(blankPage('Blank B', 'Blank B')) },
    { name: 'OEBPS/blank-c.xhtml', data: utf8(blankPage('Blank C', 'Blank C')) },
    { name: 'OEBPS/one.xhtml', data: utf8(chapter('The First Chapter', 'First')) },
    { name: 'OEBPS/two.xhtml', data: utf8(chapter('The Second Chapter', 'Second')) },
    { name: 'OEBPS/blank-end.xhtml', data: utf8(blankPage('The End', 'The End')) },
  ]);
  writeFileSync(join(outDir, `${TITLE}.epub`), book);
  console.log(join(outDir, `${TITLE}.epub`));
}
