/**
 * Two short chapters in two spine files, for reading across the boundary
 * between a chapter whose audio is downloaded and one whose audio is not.
 *
 *     npx tsx test/manual-test/boundary-fixture.ts OUTPUT_DIRECTORY
 *
 * Writes `Boundary Fixture.epub`: chapter one is a heading and four sentences,
 * chapter two a heading and four more, every sentence different, so no
 * Utterance of the second chapter can be answered by a Clip of the first. The
 * navigation names both files, so the Download sheet lists them as two chapters
 * and either can be downloaded alone. The ZIP is
 * `test/core/document/zip-fixture.ts`'s, stored.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { utf8, zip } from '../core/document/zip-fixture';

const TITLE = 'Boundary Fixture';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

const PACKAGE = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:openreader:boundary-fixture</dc:identifier>
    <dc:title>${TITLE}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-09-23T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="one" href="one.xhtml" media-type="application/xhtml+xml"/>
    <item id="two" href="two.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="one"/><itemref idref="two"/></spine>
</package>
`;

const NAV = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>
  <li><a href="one.xhtml">The Downloaded Chapter</a></li>
  <li><a href="two.xhtml">The Chapter Read Aloud Live</a></li>
</ol></nav></body>
</html>
`;

export const FIRST = [
  'The lighthouse keeper climbed the stairs every evening before the sun went down.',
  'She counted the steps out loud, although she had known their number for years.',
  'At the top she wound the clock that turned the great lamp across the water.',
  'Then she wrote the weather in her book and waited for the first ship to pass.',
] as const;

export const SECOND = [
  'In the morning a fisherman knocked on the door with a basket of silver herring.',
  'He said the fog had come in so thick that he had steered home by her light alone.',
  'She gave him a cup of tea and asked him which way the wind had been blowing.',
  'By noon the fog had lifted, and the whole bay was bright and blue and still.',
] as const;

function chapter(title: string, sentences: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${title}</title></head>
<body>
<h1>${title}</h1>
${sentences.map((sentence) => `<p>${sentence}</p>`).join('\n')}
</body>
</html>
`;
}

const directory = process.argv[2];
if (!directory) {
  console.error('Usage: npx tsx test/manual-test/boundary-fixture.ts OUTPUT_DIRECTORY');
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
      { name: 'OEBPS/one.xhtml', data: utf8(chapter('The Downloaded Chapter', FIRST)) },
      { name: 'OEBPS/two.xhtml', data: utf8(chapter('The Chapter Read Aloud Live', SECOND)) },
    ],
    { level: 'store' },
  ),
);
console.log(path);
