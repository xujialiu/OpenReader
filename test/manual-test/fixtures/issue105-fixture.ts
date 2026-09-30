/**
 * `Issue 105 Fixture`, a two-chapter EPUB whose first chapter holds the four
 * sentences the #105 simulator run needs, in one rendered section.
 *
 * Chapter one, in order:
 *
 * - `h1` — the heading (Utterance 0).
 * - p1 — one **long** sentence ("Phone old sentence, …", Utterance 1): about
 *   56 words, roughly 20 s of narration, so a real Pause can land inside it
 *   several seconds after Play's two-second sync bound and the held download.
 * - p2 — three short sentences (Utterances 2-4): `Phone old continuation.`
 *   (the phone's own next), `Desktop new sentence.` (the other device's
 *   place B) and `Desktop new continuation.` (B's continuation, what the
 *   pause after Play-from-B must upload).
 *
 * Chapter two exists so the Contents sheet has a second row and there is a
 * section the scenario does not render; the desktop item is crafted against
 * chapter one precisely because it is already on the page.
 *
 *     npx tsx test/manual-test/fixtures/issue105-fixture.ts OUTPUT_DIRECTORY
 *
 * Writes `Issue 105 Fixture.epub`. Add it the way any fixture is loaded
 * (README, "Real books"): copy into `Documents/Inbox` and send
 * `{"seq":N,"do":"add","file":"Issue 105 Fixture.epub"}` through the
 * walkthrough harness. The ZIP is `test/core/document/zip-fixture.ts`'s,
 * stored. The sentences name the devices in their own text so a Positions
 * File read back as evidence says which place it holds without any lookup.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { utf8, zip } from '../../core/document/zip-fixture';

const TITLE = 'Issue 105 Fixture';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

const PACKAGE = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:openreader:issue105-fixture</dc:identifier>
    <dc:title>${TITLE}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-09-30T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="one" href="one.xhtml" media-type="application/xhtml+xml"/>
    <item id="two" href="two.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="one"/>
    <itemref idref="two"/>
  </spine>
</package>
`;

const NAV = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>
  <li><a href="one.xhtml">Issue 105 Fixture</a></li>
  <li><a href="two.xhtml">Second Chapter</a></li>
</ol></nav></body>
</html>
`;

// Utterance 0 is the heading; 1 is the long sentence (about 20 s spoken);
// 2-4 are the three short ones. No abbreviations or digits anywhere: the
// segmenter must keep sentence 1 whole and split 2-4 exactly as written.
const CHAPTER_ONE = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${TITLE}</title></head>
<body>
<h1>${TITLE}</h1>
<p>Phone old sentence, and it goes on for a while so that a pause can land inside it, past the point where the newer place arrives, through a stretch of quiet hills and slow rivers and wide fields under a patient sky, with the voice still reading calmly while the download finishes somewhere behind the page.</p>
<p>Phone old continuation. Desktop new sentence. Desktop new continuation.</p>
</body>
</html>
`;

const CHAPTER_TWO = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Second Chapter</title></head>
<body>
<h1>Second Chapter</h1>
<p>A short second chapter the scenario never renders.</p>
</body>
</html>
`;

const directory = process.argv[2];
if (!directory) {
  console.error('Usage: npx tsx test/manual-test/fixtures/issue105-fixture.ts OUTPUT_DIRECTORY');
  process.exit(2);
}
mkdirSync(directory, { recursive: true });
const path = join(directory, `${TITLE}.epub`);
writeFileSync(
  path,
  zip([
    { name: 'META-INF/container.xml', data: utf8(CONTAINER) },
    { name: 'OEBPS/content.opf', data: utf8(PACKAGE) },
    { name: 'OEBPS/nav.xhtml', data: utf8(NAV) },
    { name: 'OEBPS/one.xhtml', data: utf8(CHAPTER_ONE) },
    { name: 'OEBPS/two.xhtml', data: utf8(CHAPTER_TWO) },
  ]),
);
console.log(path);
