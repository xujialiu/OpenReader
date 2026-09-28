/**
 * One EPUB laid out the way the owner's web-novel books are, for #35: a strip
 * of the word highlight's colour left above a word the highlight had moved past.
 *
 *     npx tsx test/manual-test/fixtures/leading-strip-fixture.ts OUTPUT_DIRECTORY
 *
 * Writes `Leading Strip Fixture.epub`: one chapter holding a heading and **one**
 * `<p>` whose sentences are set apart by `<br /><br />`, as the title page of
 * "My Vampire System — Chapters 1–250" is. The shape is the whole point: the
 * strip only appears on a line that starts a text node but not its paragraph,
 * which is the first line after every `<br />` here and never the first line of
 * a `<p>` of its own. `TARGET` is the Utterance the probe reads; it sits far
 * enough down the chapter that centring it scrolls new text onto the screen,
 * which is what paints the strip in the first place. No CSS, so the text is set
 * in WebKit's own serif, as that book's was.
 *
 * The ZIP is `test/core/document/zip-fixture.ts`'s, stored.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { utf8, zip } from '../../core/document/zip-fixture';

const BEFORE = [
  'The valley had been quiet for as long as anyone in the village could remember, and nobody expected that to change.',
  'Then the river rose in a single night and took the mill, the bridge and half of the orchard with it.',
  'Some families left for the towns on the coast, while others stayed and began to rebuild what the water had taken.',
  'Mara had lost her workshop to the flood, and the only thing she had saved was an old ledger she could not read.',
  'But when the ledger finally opened, Mara found a list of tasks inside it, and her whole life was turned around.',
] as const;

/** The Utterance `leading-strip.sh` reads. Its first line is the first line after a `<br />`. */
export const TARGET = 'She finished task after task and grew stronger, until one day the list gave her a task she was not sure she could finish.';

const AFTER = [
  '"It is time to begin!"',
  '"You must reach the far bank before the next flood"',
  '"The water will keep rising until the task has been done"',
  'Mara closed the ledger, put it in her coat and walked down to the river to look at the water.',
  'It was higher than it had been the day before, and it was still rising.',
] as const;

const TITLE = 'Leading Strip Fixture';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

const PACKAGE = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:openreader:leading-strip-fixture</dc:identifier>
    <dc:title>${TITLE}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-09-22T00:00:00Z</meta>
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
<body><nav epub:type="toc"><ol><li><a href="one.xhtml">The Ledger</a></li></ol></nav></body>
</html>
`;

const CHAPTER = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>The Ledger</title></head>
<body>
<h1>The Ledger</h1>
<p>${[...BEFORE, TARGET, ...AFTER].join(' <br /><br />')}<br /></p>
</body>
</html>
`;

const directory = process.argv[2];
if (!directory) {
  console.error('Usage: npx tsx test/manual-test/fixtures/leading-strip-fixture.ts OUTPUT_DIRECTORY');
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
