/**
 * An EPUB that aligns its own lines every way a book does, for checking Text
 * Alignment (#32, ADR 0034).
 *
 *     npx tsx test/manual-test/alignment-fixture.ts OUTPUT_DIRECTORY
 *
 * Writes `Alignment Fixture.epub`: one chapter whose elements carry ids, so a
 * probe can read each one's computed `text-align` and whether the program marked
 * it as the Document's own. What each id is for, and what it should compute
 * under the owner's Left (`start`) and Justify (`justify`):
 *
 * | id | the Document set | follows the owner? |
 * | --- | --- | --- |
 * | `h-plain` | an `h1`, nothing declared | no — a heading keeps its own (`start`) |
 * | `h-centred` | `h2.centred { text-align: center }` | no — `center`, marked |
 * | `h-block` | a `display: block` span inside a centred `h3` | no — `center`, marked |
 * | `h-left` | `h4.left { text-align: left }`, two lines long | no — a heading keeps its own (`left`) |
 * | `p-plain` | nothing | yes |
 * | `p-left` | `p.left { text-align: left }` | yes |
 * | `p-justify` | `p.justified { text-align: justify }` | yes |
 * | `break` | `p.break { text-align: center }`, `* * *` | no — `center`, marked |
 * | `verse`, `verse-1`, `verse-2` | `div.verse { text-align: center }` and two `p` in it | no — all `center`, marked |
 * | `signature` | `p.signature { text-align: right }` | no — `right`, marked |
 * | `end` | `p.end { text-align: end }` | no — `end`, marked |
 * | `inline` | `style="text-align: center"` | no — `center`, marked |
 * | `legacy` | a `<center>` element | no — `-webkit-center`, marked |
 * | `li` | a list item | yes |
 * | `td-num`, `td-word` | a cell set right, a cell set nothing | `td-num` no (`right`, marked); `td-word` yes |
 *
 * The paragraphs are long enough to wrap over several lines on a phone, so a
 * screenshot shows a ragged right edge under Left and a flush one under Justify.
 * The ZIP is `test/core/document/zip-fixture.ts`'s, stored rather than deflated.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { utf8, zip } from '../core/document/zip-fixture';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

const PACKAGE = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:openreader:alignment-fixture</dc:identifier>
    <dc:title>Alignment Fixture</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-09-22T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="one" href="one.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="one"/></spine>
</package>
`;

const NAV = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol><li><a href="one.xhtml">Every Way a Book Aligns a Line</a></li></ol></nav></body>
</html>
`;

const STYLE = `h2.centred, h3.centred { text-align: center; }
h4.left { text-align: left; }
.block { display: block; }
p.left { text-align: left; }
p.justified { text-align: justify; }
p.break { text-align: center; }
div.verse { text-align: center; }
p.signature { text-align: right; }
p.end { text-align: end; }
td.num { text-align: right; }
`;

const PROSE =
  'A reader who sets the lines of a book flush with both margins spreads the space of each line across its gaps, ' +
  'and a reader who sets them flush with the left margin alone leaves that space at the end of the line instead, ' +
  'so the right-hand edge of the paragraph is ragged rather than straight.';

const CHAPTER = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Every Way a Book Aligns a Line</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
<h1 id="h-plain">Every Way a Book Aligns a Line</h1>
<h2 id="h-centred" class="centred">A Centred Heading</h2>
<p id="p-plain">${PROSE}</p>
<p id="p-left" class="left">This paragraph was set flush left by its own stylesheet. ${PROSE}</p>
<p id="p-justify" class="justified">This paragraph was justified by its own stylesheet. ${PROSE}</p>
<p id="break" class="break">* * *</p>
<h3 class="centred"><span id="h-block" class="block">A centred heading whose words sit in a block of their own</span></h3>
<div id="verse" class="verse"><p id="verse-1">A line of verse the book centres,</p><p id="verse-2">and a second line under it.</p></div>
<h4 id="h-left" class="left">A heading the book sets flush left, long enough that it runs onto a second line on a phone</h4>
<p id="inline" style="text-align: center">A line centred by an attribute on the element itself.</p>
<center id="legacy">A line centred by the old center element.</center>
<ul><li id="li">A list item, which is body text like any paragraph. ${PROSE}</li></ul>
<table><tr><td id="td-word">A cell of words the book sets nothing on, which wraps over more than one line on a phone.</td><td id="td-num" class="num">1,234</td></tr></table>
<p id="signature" class="signature">— the Author</p>
<p id="end" class="end">Set at the end of the line.</p>
</body>
</html>
`;

const directory = process.argv[2];
if (!directory) {
  console.error('Usage: npx tsx test/manual-test/alignment-fixture.ts OUTPUT_DIRECTORY');
  process.exit(2);
}
mkdirSync(directory, { recursive: true });
const path = join(directory, 'Alignment Fixture.epub');
writeFileSync(path, zip([
  // The mimetype first and stored, as the EPUB container requires.
  { name: 'mimetype', data: utf8('application/epub+zip') },
  { name: 'META-INF/container.xml', data: utf8(CONTAINER) },
  { name: 'OEBPS/content.opf', data: utf8(PACKAGE) },
  { name: 'OEBPS/nav.xhtml', data: utf8(NAV) },
  { name: 'OEBPS/style.css', data: utf8(STYLE) },
  { name: 'OEBPS/one.xhtml', data: utf8(CHAPTER) },
], { level: 'store' }));
console.log(path);
