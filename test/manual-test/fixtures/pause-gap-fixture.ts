/**
 * `Pause Gap Fixture`, a one-chapter EPUB whose first paragraph holds three
 * sentences, for #60/ADR 0047's differential playback timing check.
 *
 * `A Short Test of Reading Aloud` and `Pause Order Fixture` (this directory's
 * other generated fixtures) both put exactly one sentence in every `<p>`, so
 * every adjacent pair of Utterances in either one starts a new Block — there
 * is no pair to measure the **sentence** pause against, only the paragraph
 * one. This fixture's first paragraph gives Utterances 1-2 and 2-3 the same
 * Block (`gap.ts`'s `startsNewBlock` reads false), while 0-1, 3-4 and 4-5 each
 * start a new one — both cases in six short Utterances.
 *
 *     npx tsx test/manual-test/fixtures/pause-gap-fixture.ts OUTPUT_DIRECTORY
 *
 * Writes `Pause Gap Fixture.epub`. Add it the way any fixture is loaded
 * (README, "Real books"): copy into `Documents/Inbox` and send
 * `{"seq":N,"do":"add","file":"Pause Gap Fixture.epub"}` through the
 * walkthrough harness. The ZIP is `test/core/document/zip-fixture.ts`'s, stored.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { utf8, zip } from '../../core/document/zip-fixture';

const TITLE = 'Pause Gap Fixture';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

const PACKAGE = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:openreader:pause-gap-fixture</dc:identifier>
    <dc:title>${TITLE}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-09-24T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="one" href="one.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="one"/></spine>
</package>
`;

const NAV = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>
  <li><a href="one.xhtml">Pause Gap Fixture</a></li>
</ol></nav></body>
</html>
`;

// Utterance 0 is the heading. 1-3 share one Block (a new Block starts at 0-1);
// 3-4 and 4-5 each start a new Block. Every sentence is different, so no clip
// can answer for another and a cached one is unambiguous evidence of a repeat.
const CHAPTER = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${TITLE}</title></head>
<body>
<h1>${TITLE}</h1>
<p>Alpha sentence stands first in this shared paragraph. Beta sentence stands second in this shared paragraph. Gamma sentence stands third in this shared paragraph.</p>
<p>Delta sentence opens its own paragraph by itself.</p>
<p>Epsilon sentence opens another paragraph by itself.</p>
</body>
</html>
`;

const directory = process.argv[2];
if (!directory) {
  console.error('Usage: npx tsx test/manual-test/fixtures/pause-gap-fixture.ts OUTPUT_DIRECTORY');
  process.exit(2);
}
mkdirSync(directory, { recursive: true });
const path = join(directory, `${TITLE}.epub`);
writeFileSync(
  path,
  zip(
    [
      // The mimetype first and stored, as the EPUB container requires.
      { name: 'mimetype', data: utf8('application/epub+zip') },
      { name: 'META-INF/container.xml', data: utf8(CONTAINER) },
      { name: 'OEBPS/content.opf', data: utf8(PACKAGE) },
      { name: 'OEBPS/nav.xhtml', data: utf8(NAV) },
      { name: 'OEBPS/one.xhtml', data: utf8(CHAPTER) },
    ],
    { level: 'store' },
  ),
);
console.log(path);
