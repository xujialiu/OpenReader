/**
 * One EPUB shaped like a serialised web novel, for scrolling through many
 * sections quickly: a contents page that is one long list of links, then
 * chapters several screens tall.
 *
 *     npx tsx test/manual-test/scroll-fixture.ts OUTPUT_DIRECTORY
 *
 * Writes `Scroll Fixture.epub`: spine item 0 is a title page, 1 is the contents
 * page (a `<ul>` of every chapter, as such books ship one), and 2 onwards are
 * `CHAPTERS` chapters, each an `<h1>` and `PARAGRAPHS` paragraphs of plain
 * English. The text is generated from a fixed seed, so every run writes the
 * same bytes and the same Document Id. The ZIP is
 * `test/core/document/zip-fixture.ts`'s, stored.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { utf8, zip } from '../core/document/zip-fixture';

const TITLE = 'Scroll Fixture';
const CHAPTERS = 60;
const PARAGRAPHS = 24;

const WORDS = (
  'the quiet corridor light school book night door window crystal system blood ' +
  'vampire hunter wolf shadow garden river stone voice hand eye morning evening ' +
  'walked turned looked opened closed carried waited laughed shouted answered ' +
  'slowly quickly almost never always again still only just even'
).split(' ');

/** A small linear congruential generator, so the text is the same on every run. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const next = generator(20260922);

function sentence(): string {
  const length = 8 + Math.floor(next() * 12);
  const words: string[] = [];
  for (let i = 0; i < length; i++) words.push(WORDS[Math.floor(next() * WORDS.length)]);
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}

function paragraph(): string {
  const count = 3 + Math.floor(next() * 4);
  const sentences: string[] = [];
  for (let i = 0; i < count; i++) sentences.push(sentence());
  return sentences.join(' ');
}

const pad = (n: number): string => String(n).padStart(3, '0');
const chapterFile = (n: number): string => `ch${pad(n)}.xhtml`;
const chapterTitle = (n: number): string => `Chapter ${n}: ${sentence().slice(0, -1).split(' ').slice(0, 3).join(' ')}`;

const titles = Array.from({ length: CHAPTERS }, (_, i) => chapterTitle(i + 1));

const xhtml = (title: string, body: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${title}</title></head>
<body>
${body}
</body>
</html>
`;

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

const PACKAGE = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:openreader:scroll-fixture</dc:identifier>
    <dc:title>${TITLE}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-09-22T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>
    <item id="contents" href="contents.xhtml" media-type="application/xhtml+xml"/>
${titles.map((_, i) => `    <item id="ch${pad(i + 1)}" href="${chapterFile(i + 1)}" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine>
    <itemref idref="title"/>
    <itemref idref="contents"/>
${titles.map((_, i) => `    <itemref idref="ch${pad(i + 1)}"/>`).join('\n')}
  </spine>
</package>
`;

const links = titles.map((title, i) => `<li><a href="${chapterFile(i + 1)}">${title}</a></li>`).join('\n');

const NAV = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>
<li><a href="contents.xhtml">Contents</a></li>
${links}
</ol></nav></body>
</html>
`;

const files = [
  // The mimetype first and stored, as the EPUB container requires.
  { name: 'mimetype', data: utf8('application/epub+zip') },
  { name: 'META-INF/container.xml', data: utf8(CONTAINER) },
  { name: 'OEBPS/content.opf', data: utf8(PACKAGE) },
  { name: 'OEBPS/nav.xhtml', data: utf8(NAV) },
  { name: 'OEBPS/title.xhtml', data: utf8(xhtml(TITLE, `<h1>${TITLE}</h1>\n<p>${paragraph()}</p>`)) },
  { name: 'OEBPS/contents.xhtml', data: utf8(xhtml('Contents', `<h2>Contents</h2>\n<ul>\n${links}\n</ul>`)) },
  ...titles.map((title, i) => ({
    name: `OEBPS/${chapterFile(i + 1)}`,
    data: utf8(
      xhtml(title, `<h1>${title}</h1>\n${Array.from({ length: PARAGRAPHS }, () => `<p>${paragraph()}</p>`).join('\n')}`),
    ),
  })),
];

const directory = process.argv[2];
if (!directory) {
  console.error('Usage: npx tsx test/manual-test/scroll-fixture.ts OUTPUT_DIRECTORY');
  process.exit(2);
}
mkdirSync(directory, { recursive: true });
const path = join(directory, `${TITLE}.epub`);
writeFileSync(path, zip(files, { level: 'store' }));
console.log(path);
