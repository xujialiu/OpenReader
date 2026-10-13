/**
 * `A Continuity Check of Empty Sections and Ends`, for verifying #153/#161/#170
 * /#156 on the simulator: an empty first spine item, an empty last spine item,
 * and text chapters whose every sentence names itself.
 *
 *     npx tsx test/manual-test/fixtures/continuity-fixture.ts OUTPUT_DIRECTORY
 *
 * Writes `A Continuity Check of Empty Sections and Ends.epub`. Six spine items:
 *
 * - `cover.xhtml`     — "Cover": a hidden `h1` and a non-breaking space only,
 *   the shape of the owner's text-less volume pages. Play with nothing but this
 *   reported must still reach the first real chapter's text (#161).
 * - `one.xhtml`       — The First Chapter,  three paragraphs of three sentences.
 * - `two.xhtml`       — The Second Chapter, three paragraphs of three sentences.
 * - `three.xhtml`     — The Third Chapter,  eight paragraphs of three sentences,
 *   so a boundary inside it lasts longer than a preparation.
 * - `four.xhtml`      — The Fourth Chapter, three paragraphs of three sentences.
 * - `empty-last.xhtml`— "The End": the same empty shape, as the LAST spine item.
 *   A Reading that runs out before it is reported must stop with the end note
 *   once it reports (#170), and a Play after that must stay stopped (#156).
 *
 * Every sentence's text names its chapter, paragraph and number, so one line of
 * the fake provider's request log maps to one Utterance. The contents are an
 * EPUB 2 `toc.ncx` on purpose (see fixtures/README.md: an xhtml nav's hrefs come
 * out unreachable against these manifest hrefs).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { utf8, zip } from '../../core/document/zip-fixture';
const TITLE = 'A Continuity Check of Empty Sections and Ends';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

const chapter = (name: string, ordinal: string, paragraphs: number) => {
  const out: string[] = [];
  for (let p = 1; p <= paragraphs; p++) {
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

// The text-less page: a hidden heading and a non-breaking space, and nothing a
// sentence could come from.
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
    <dc:identifier id="uid">urn:openreader:continuity-check-of-empty-sections-and-ends</dc:identifier>
    <dc:title>${TITLE}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-10-13T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="one" href="one.xhtml" media-type="application/xhtml+xml"/>
    <item id="two" href="two.xhtml" media-type="application/xhtml+xml"/>
    <item id="three" href="three.xhtml" media-type="application/xhtml+xml"/>
    <item id="four" href="four.xhtml" media-type="application/xhtml+xml"/>
    <item id="emptylast" href="empty-last.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="cover"/><itemref idref="one"/><itemref idref="two"/><itemref idref="three"/><itemref idref="four"/><itemref idref="emptylast"/></spine>
</package>
`;

const navPoint = (id: string, playOrder: number, label: string, src: string) =>
  `    <navPoint id="${id}" playOrder="${playOrder}">
      <navLabel><text>${label}</text></navLabel>
      <content src="${src}"/>
    </navPoint>`;

const NCX = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:openreader:continuity-check-of-empty-sections-and-ends"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>
  <docTitle><text>${TITLE}</text></docTitle>
  <navMap>
${navPoint('np-cover', 1, 'Cover', 'cover.xhtml')}
${navPoint('np-one', 2, 'The First Chapter', 'one.xhtml')}
${navPoint('np-two', 3, 'The Second Chapter', 'two.xhtml')}
${navPoint('np-three', 4, 'The Third Chapter', 'three.xhtml')}
${navPoint('np-four', 5, 'The Fourth Chapter', 'four.xhtml')}
${navPoint('np-end', 6, 'The End', 'empty-last.xhtml')}
  </navMap>
</ncx>
`;

function continuityFixtureFiles(): Record<string, string> {
  return {
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': PACKAGE,
    'OEBPS/toc.ncx': NCX,
    'OEBPS/cover.xhtml': emptyPage('Cover', 'Continuity Fixture'),
    'OEBPS/one.xhtml': chapter('The First Chapter', 'First', 3),
    'OEBPS/two.xhtml': chapter('The Second Chapter', 'Second', 3),
    'OEBPS/three.xhtml': chapter('The Third Chapter', 'Third', 8),
    'OEBPS/four.xhtml': chapter('The Fourth Chapter', 'Fourth', 3),
    'OEBPS/empty-last.xhtml': emptyPage('The End', 'The End'),
  };
}

const outDir = process.argv[2];
if (outDir) {
  mkdirSync(outDir, { recursive: true });
  const files = continuityFixtureFiles();
  const book = zip([
    { name: 'mimetype', data: utf8('application/epub+zip') },
    ...Object.entries(files).map(([name, data]) => ({ name, data: utf8(data) })),
  ]);
  writeFileSync(join(outDir, `${TITLE}.epub`), book);
  console.log(join(outDir, `${TITLE}.epub`));
}
