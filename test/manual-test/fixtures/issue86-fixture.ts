/**
 * `An Issue 86 Check of Skips and Contents`, for verifying issue #86 on the
 * simulator: no debounce on a tap or a Skip while playing, a Contents row to an
 * unrendered chapter while playing, and a Contents row to a text-less page read
 * past while playing.
 *
 *     npx tsx test/manual-test/fixtures/issue86-fixture.ts OUTPUT_DIRECTORY
 *
 * Writes `An Issue 86 Check of Skips and Contents.epub`. Five spine items:
 *
 * - `first.xhtml`  — The First Chapter,  three paragraphs of three sentences.
 * - `second.xhtml` — The Second Chapter, three paragraphs of three sentences.
 * - `volume.xhtml` — "Volume Two": a hidden `h1` and a non-breaking space only,
 *   the shape of the owner's 仙逆 第二卷 修真血影 (`Text/chapter56.xhtml`). A
 *   Contents row pressed while playing has to read past it to The Third Chapter.
 * - `third.xhtml`  — The Third Chapter,  three paragraphs of three sentences.
 * - `fourth.xhtml` — The Fourth Chapter, three paragraphs of three sentences.
 *
 * While the first chapter plays, `renderAhead` (`highlighter.ts`) has rendered
 * and reported only the second: a Contents row to The Third or The Fourth
 * Chapter is a wait for a section that has not reported. Every sentence's text
 * names its chapter, paragraph and number, so one line of a fake provider's
 * request log maps to one Utterance. Every sentence is different, so no Clip of
 * one can answer for another.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { utf8, zip } from '../../core/document/zip-fixture';

const TITLE = 'An Issue 86 Check of Skips and Contents';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

const chapter = (name: string, ordinal: string) => {
  const paragraphs: string[] = [];
  for (let p = 1; p <= 3; p++) {
    const sentences: string[] = [];
    for (let s = 1; s <= 3; s++) {
      sentences.push(
        `<span id="s${p}${s}">${ordinal} chapter, paragraph ${p}, sentence ${s}, spoken plainly for the measurement.</span>`,
      );
    }
    paragraphs.push(`    <p>${sentences.join(' ')}</p>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${name}</title></head>
<body>
  <h2>${name}</h2>
${paragraphs.join('\n')}
</body>
</html>
`;
};

// The text-less volume page: a hidden heading and a non-breaking space, and
// nothing a sentence could come from.
const VOLUME_PAGE = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Volume Two</title></head>
<body>
  <h1 style="display:none">Volume Two</h1>
  <p>&#160;</p>
</body>
</html>
`;

const PACKAGE = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:openreader:issue-86-check-of-skips-and-contents</dc:identifier>
    <dc:title>${TITLE}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-09-29T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="first" href="first.xhtml" media-type="application/xhtml+xml"/>
    <item id="second" href="second.xhtml" media-type="application/xhtml+xml"/>
    <item id="volume" href="volume.xhtml" media-type="application/xhtml+xml"/>
    <item id="third" href="third.xhtml" media-type="application/xhtml+xml"/>
    <item id="fourth" href="fourth.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="first"/><itemref idref="second"/><itemref idref="volume"/><itemref idref="third"/><itemref idref="fourth"/></spine>
</package>
`;

const NAV = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>
  <li><a href="first.xhtml">The First Chapter</a></li>
  <li><a href="second.xhtml">The Second Chapter</a></li>
  <li><a href="volume.xhtml">Volume Two</a></li>
  <li><a href="third.xhtml">The Third Chapter</a></li>
  <li><a href="fourth.xhtml">The Fourth Chapter</a></li>
</ol></nav></body>
</html>
`;

export function main(output: string): void {
  mkdirSync(output, { recursive: true });
  const book = zip([
    { name: 'mimetype', data: utf8('application/epub+zip') },
    { name: 'META-INF/container.xml', data: utf8(CONTAINER) },
    { name: 'OEBPS/content.opf', data: utf8(PACKAGE) },
    { name: 'OEBPS/nav.xhtml', data: utf8(NAV) },
    { name: 'OEBPS/first.xhtml', data: utf8(chapter('The First Chapter', 'First')) },
    { name: 'OEBPS/second.xhtml', data: utf8(chapter('The Second Chapter', 'Second')) },
    { name: 'OEBPS/volume.xhtml', data: utf8(VOLUME_PAGE) },
    { name: 'OEBPS/third.xhtml', data: utf8(chapter('The Third Chapter', 'Third')) },
    { name: 'OEBPS/fourth.xhtml', data: utf8(chapter('The Fourth Chapter', 'Fourth')) },
  ]);
  const out = join(output, `${TITLE}.epub`);
  writeFileSync(out, book);
  console.log(out);
}

if (require.main === module) {
  const output = process.argv[2];
  if (!output) {
    console.error('Usage: npx tsx test/manual-test/fixtures/issue86-fixture.ts OUTPUT_DIRECTORY');
    process.exit(2);
  }
  main(output);
}
