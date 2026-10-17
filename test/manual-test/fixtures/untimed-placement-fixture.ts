/**
 * `Untimed Placement Fixture`, a one-chapter EPUB for #197's device check: a
 * sentence without Word Timings, at a Line Position below the middle, must end
 * above the open Player.
 *
 * Four speakable Utterances in one chapter, so the harness's `seek` can land
 * beside the long one by index:
 *
 *     0  the heading
 *     1  a lead sentence to Play from, just before the long one
 *     2  the long sentence: ~64 words, which draws well over 8 lines at the
 *        default appearance (24 px over a 16 px body, 1.6 line-height, 28 px
 *        margins: 334 px of measure, about 38 px a line on a 390-point phone),
 *        and far less than the visible page, so the tall-Utterance rule
 *        (top at the top of what can be seen) must not be the thing that
 *        passes the check
 *     3  a one-line control sentence, which keeps its middle at the Line
 *        Position
 *     4+ filler paragraphs, so the chapter is tall enough to scroll: the
 *        placement needs real room below the long sentence — on a 390-point
 *        phone the fix wants to raise the sentence's end to the Player's top,
 *        which is only reachable while the chapter has that much more content
 *        below (a one-screen chapter clamps the scroll and puts the check out
 *        of reach; measured 2026-10-18, #197's device run)
 *
 *     npx tsx test/manual-test/fixtures/untimed-placement-fixture.ts OUTPUT_DIRECTORY
 *
 * Writes `Untimed Placement Fixture.epub`. Add it the way any fixture is
 * loaded (README, "Real books"): copy into `Documents/Inbox` and send
 * `{"seq":N,"do":"add","file":"Untimed Placement Fixture.epub"}` through the
 * walkthrough harness. The ZIP is `test/core/document/zip-fixture.ts`'s,
 * stored.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { utf8, zip } from '../../core/document/zip-fixture';

const TITLE = 'Untimed Placement Fixture';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

const PACKAGE = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:openreader:untimed-placement-fixture</dc:identifier>
    <dc:title>${TITLE}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-10-17T00:00:00Z</meta>
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
  <li><a href="one.xhtml">Untimed Placement Fixture</a></li>
</ol></nav></body>
</html>
`;

// One sentence per paragraph, so each is one Utterance and the indices above
// hold. The long sentence has no internal full stop, so the splitter keeps it
// whole; its commas are ordinary prose.
const CHAPTER = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${TITLE}</title></head>
<body>
<h1>${TITLE}</h1>
<p>This lead sentence stands just before the long one.</p>
<p>The caretaker of the winter archive walked the whole length of the long gallery with a lamp in one hand and a bundle of unmarked keys in the other, pausing at every third door to try one of them in the lock, listening to the tumblers with the patience of somebody who has owned the corridor longer than the corridor has owned its name, and writing nothing down, because every refusal and every click was already filed in a memory that had never once been consulted and never once been wrong about a door it had heard.</p>
<p>The lamp burned low.</p>
<p>What the filler is for: the page can only raise the sentence as far as the chapter has somewhere to go, so these paragraphs stand below the control sentence to give the scroll its room. Each says something a little different from the last, so no clip can answer for another and every request the fake server logs is its own.</p>
<p>The corridor ended at a door the caretaker did not open, and the door had a handle of cold brass that had never once been turned in the caretaker's whole employment, which was itself longer than most employments, and longer than some buildings.</p>
<p>Beyond the door, they said, was the winter wing, and in the winter wing the collection slept under sheets, and under the sheets the books kept their own small weather, and nobody who worked there had ever seen the winter wing with the lights on.</p>
<p>The caretaker wrote none of this down either, and the archive kept none of it, and that was the arrangement, and the arrangement had held for as long as anybody could say, which was exactly as far as anybody could say.</p>
</body>
</html>
`;

const directory = process.argv[2];
if (!directory) {
  console.error('Usage: npx tsx test/manual-test/fixtures/untimed-placement-fixture.ts OUTPUT_DIRECTORY');
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
