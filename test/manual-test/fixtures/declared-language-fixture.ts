/**
 * Two one-chapter EPUBs that differ from an ordinary book only in how their
 * `dc:language` is written, for #182 and #185.
 *
 * - `Declared Language de-DE.epub` declares `de-DE`. Its paragraphs hold a
 *   German ordinal date and `ca.`, which the German rules keep inside the
 *   sentence and the English rules cut after. Split as German, its Utterances
 *   are the heading, then "Er wurde am 3. Oktober 1990 in Berlin geboren.",
 *   "Danach zog er um.", "Das kostet ca. 5 Euro." and "Mehr nicht." Split as
 *   English (the fault), "Er wurde am 3." and "Oktober 1990 in Berlin
 *   geboren." are two, and so are "Das kostet ca." and "5 Euro."
 * - `Declared Language nan.epub` declares `nan` (Min Nan), one of the two
 *   tags whose fallbacks in the pinned splitter name each other; before #185
 *   every split of its text ran the stack out. Its Utterances are the heading,
 *   "Lí hó.", "Góa sī Tâi-oân lâng." and "Chit pún chheh chin hó-khòaⁿ."
 *
 *     npx tsx test/manual-test/fixtures/declared-language-fixture.ts OUTPUT_DIRECTORY
 *
 * Add them the way any fixture is loaded (README, "Real books"). Contents is an
 * NCX, as fixtures/README.md asks of a book whose rows must open. The ZIP is
 * `test/core/document/zip-fixture.ts`'s, stored.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { utf8, zip } from '../../core/document/zip-fixture';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

interface Book {
  language: string;
  slug: string;
  heading: string;
  paragraphs: string[];
}

const BOOKS: Book[] = [
  {
    language: 'de-DE',
    slug: 'de-de',
    heading: 'Ein Lebenslauf',
    paragraphs: ['Er wurde am 3. Oktober 1990 in Berlin geboren. Danach zog er um.', 'Das kostet ca. 5 Euro. Mehr nicht.'],
  },
  {
    language: 'nan',
    slug: 'nan',
    heading: 'Tâi-gí',
    paragraphs: ['Lí hó. Góa sī Tâi-oân lâng.', 'Chit pún chheh chin hó-khòaⁿ.'],
  },
];

function files(book: Book) {
  const title = `Declared Language ${book.language}`;
  const pkg = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:openreader:declared-language-${book.slug}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>${book.language}</dc:language>
    <meta property="dcterms:modified">2026-10-17T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="one" href="one.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="one"/></spine>
</package>
`;
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:openreader:declared-language-${book.slug}"/></head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
    <navPoint id="one" playOrder="1"><navLabel><text>${book.heading}</text></navLabel><content src="one.xhtml"/></navPoint>
  </navMap>
</ncx>
`;
  const chapter = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${book.language}" lang="${book.language}">
<head><title>${book.heading}</title></head>
<body>
<h1>${book.heading}</h1>
${book.paragraphs.map((text) => `<p>${text}</p>`).join('\n')}
</body>
</html>
`;
  return {
    title,
    entries: [
      // The mimetype first and stored, as the EPUB container requires.
      { name: 'mimetype', data: utf8('application/epub+zip') },
      { name: 'META-INF/container.xml', data: utf8(CONTAINER) },
      { name: 'OEBPS/content.opf', data: utf8(pkg) },
      { name: 'OEBPS/toc.ncx', data: utf8(ncx) },
      { name: 'OEBPS/one.xhtml', data: utf8(chapter) },
    ],
  };
}

const directory = process.argv[2];
if (!directory) {
  console.error('Usage: npx tsx test/manual-test/fixtures/declared-language-fixture.ts OUTPUT_DIRECTORY');
  process.exit(2);
}
mkdirSync(directory, { recursive: true });
for (const book of BOOKS) {
  const { title, entries } = files(book);
  const path = join(directory, `${title}.epub`);
  writeFileSync(path, zip(entries, { level: 'store' }));
  console.log(path);
}
