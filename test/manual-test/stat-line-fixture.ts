/**
 * One EPUB of short lines, for the Fish language hint (#23) and bracket
 * removal (#25): what a Fish request actually carries, and where the word
 * highlight lands.
 *
 *     npx tsx test/manual-test/stat-line-fixture.ts OUTPUT_DIRECTORY
 *
 * Writes `Stat Line Fixture.epub`: one chapter, no heading, and six paragraphs,
 * each its own Utterance, in this order:
 *
 *     100 exp
 *     2/50 HP
 *     You gained 100 exp.
 *     He cast [Fireball] at the wolf.
 *     [Level Up]
 *     If x < 5 and y > 3, stop.
 *
 * With the default bracket list and a US English Fish voice, the request texts
 * are expected to be, in order: `[Speak in American English] 100 exp`,
 * `[Speak in American English] 2/50 HP`, `You gained 100 exp.`,
 * `He cast Fireball at the wolf.`, `[Speak in American English] Level Up` and
 * `If x < 5 and y > 3, stop.` (the comparison's two signs stay). Read-ahead is
 * three Utterances, so the sixth request is sent once the third line is being
 * read. The ZIP is `test/core/document/zip-fixture.ts`'s, stored.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { utf8, zip } from '../core/document/zip-fixture';

export const STAT_LINES = [
  '100 exp',
  '2/50 HP',
  'You gained 100 exp.',
  'He cast [Fireball] at the wolf.',
  '[Level Up]',
  'If x < 5 and y > 3, stop.',
] as const;

const TITLE = 'Stat Line Fixture';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

const PACKAGE = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:openreader:stat-line-fixture</dc:identifier>
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
<body><nav epub:type="toc"><ol><li><a href="one.xhtml">Stat Lines</a></li></ol></nav></body>
</html>
`;

const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CHAPTER = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Stat Lines</title></head>
<body>
${STAT_LINES.map((line) => `<p>${escape(line)}</p>`).join('\n')}
</body>
</html>
`;

const directory = process.argv[2];
if (!directory) {
  console.error('Usage: npx tsx test/manual-test/stat-line-fixture.ts OUTPUT_DIRECTORY');
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
