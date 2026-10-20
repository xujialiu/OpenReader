/**
 * Seven one-chapter EPUBs holding the exact sentences of the accepted
 * sentence-boundary batch #240/#245/#241/#242, for their device verification
 * (1.0.0 (9)-beta18). The paragraph texts are the batch's own examples, so the
 * app's Utterance list and the Provider's request log can be compared with them
 * word for word:
 *
 * - `Seg zh` (`zh`) and `Seg ja` (`ja`): CJK stops before an ASCII digit and
 *   before a lowercase Latin letter must split (#240): 这是第一句。/ 2024年…,
 *   中文の句子。/ abc…, これは最初の文です。/ 2024年…, 次の文です。/ abc….
 * - `Seg en negs` (`en`): `She said no.` / `He left.` and `He looked at me.` /
 *   `I smiled.` split, while `Dr. Smith` and `No. 5` stay abbreviations
 *   (#245).
 * - `Seg ellipsis` (`en`): `I was thinking... maybe we should go.` and the
 *   spaced `Wait . . . what happened here.` stay whole; the controls
 *   `I was thinking...` + `Maybe we should go.` split and `She paused… then
 *   continued speaking.` stays whole (#241).
 * - `Seg deu`, `Seg ger`, `Seg de`: the same German paragraph declared
 *   `deu`, `ger` and `de`; the German rules must keep `3. Oktober` inside
 *   the sentence in all three (#242, the alias commit).
 *
 * Books 2 (`Seg en negs`) and 4 (`Seg ellipsis`) are the ones the migration
 * part downloads: under the pre-batch rules (unpatched 0.4.2) `no`, `me`,
 * `...` and `. . .` cut or weld differently, so a Download prepared before the
 * batch holds joined texts the new rules replace.
 *
 *   npx tsx test/manual-test/fixtures/segmentation-fixture.ts OUTPUT_DIRECTORY
 *
 * Add them the way any fixture is loaded (README, "Real books"). Contents is an
 * NCX, as fixtures/README.md asks of a book whose rows must open. The ZIP is
 * `test/core/document/zip-fixture.ts`'s, stored. What a fixture cannot decide:
 * the expected cuts above are the patched package's answers on the Mac; the
 * device evidence is the app's own list and request log.
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
    language: 'zh',
    slug: 'zh',
    heading: '分句',
    paragraphs: ['这是第一句。2024年发生了很多事。', '中文的句子。abc接着写下去。'],
  },
  {
    language: 'ja',
    slug: 'ja',
    heading: '分割',
    paragraphs: ['これは最初の文です。2024年の出来事でした。', '次の文です。abcから始まる文。'],
  },
  {
    language: 'en',
    slug: 'en-negs',
    heading: 'Boundaries',
    paragraphs: [
      'She said no. He left.',
      'He looked at me. I smiled.',
      'Dr. Smith arrived early. He was polite.',
      'Item No. 5 is missing. We searched everywhere.',
    ],
  },
  {
    language: 'en',
    slug: 'ellipsis',
    heading: 'Ellipsis',
    paragraphs: [
      'I was thinking... maybe we should go.',
      'Wait . . . what happened here.',
      'I was thinking... Maybe we should go.',
      'She paused… then continued speaking.',
    ],
  },
  {
    language: 'deu',
    slug: 'deu',
    heading: 'Lebenslauf',
    paragraphs: ['Er wurde am 3. Oktober 1990 in Berlin geboren. Dann zog er um.'],
  },
  {
    language: 'ger',
    slug: 'ger',
    heading: 'Lebenslauf',
    paragraphs: ['Er wurde am 3. Oktober 1990 in Berlin geboren. Dann zog er um.'],
  },
  {
    language: 'de',
    slug: 'de',
    heading: 'Lebenslauf',
    paragraphs: ['Er wurde am 3. Oktober 1990 in Berlin geboren. Dann zog er um.'],
  },
];

function files(book: Book) {
  const title = `Seg ${book.slug}`;
  const pkg = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:openreader:seg-${book.slug}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>${book.language}</dc:language>
    <meta property="dcterms:modified">2026-10-20T00:00:00Z</meta>
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
  <head><meta name="dtb:uid" content="urn:openreader:seg-${book.slug}"/></head>
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

const output = process.argv[2];
if (!output) {
  console.error('Usage: npx tsx test/manual-test/fixtures/segmentation-fixture.ts OUTPUT_DIRECTORY');
  process.exit(2);
}
mkdirSync(output, { recursive: true });
for (const book of BOOKS) {
  const { entries } = files(book);
  const path = join(output, `seg-${book.slug}.epub`);
  writeFileSync(path, zip(entries, { level: 'store' }));
  console.log(path);
}
