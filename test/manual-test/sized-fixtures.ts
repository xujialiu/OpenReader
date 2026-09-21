/**
 * Two EPUBs that set their own text sizes, for checking Font Size (#17, ADR 0030).
 *
 *     npx tsx test/manual-test/sized-fixtures.ts OUTPUT_DIRECTORY
 *
 * Writes `Sized Fixture Rem.epub` and `Sized Fixture Small.epub`. Both have two
 * chapters, and the first holds more than 2,000 non-space characters, so the
 * reader decides their body text size on the first page it renders
 * (`CHARACTERS_TO_DECIDE` in `src/renderer/body-text.ts`).
 *
 * - Rem: `html { font-size: 62.5% }` with the paragraphs put back at `1.6rem`,
 *   so the body text is 16px in a Document that shrinks its root. The build
 *   before ADR 0030 set the root to a percentage of 16px and took this book's
 *   paragraphs to 28px on the first tap. It also declares
 *   `body { -webkit-text-size-adjust: 100% }`, which beats a root-only
 *   text-size-adjust.
 * - Small: `body { font-size: 12px }`, so the body text is 12px and the owner's
 *   16 is 133.33% of it.
 *
 * Both carry an `x-small` badge in each chapter heading and a `12px` note, which a
 * root font size cannot reach. The ZIP is `test/core/document/zip-fixture.ts`'s,
 * stored rather than deflated, which an EPUB reader accepts for every member.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { utf8, zip } from '../core/document/zip-fixture';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

const packageDocument = (identifier: string, title: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${identifier}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-09-21T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
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
  <li><a href="one.xhtml">The First Chapter</a></li>
  <li><a href="two.xhtml">The Second Chapter</a></li>
</ol></nav></body>
</html>
`;

const SENTENCES = [
  "This paragraph is set in the size the stylesheet gives body text, and the reader should show it at the owner's size.",
  'A heading above it is larger and a badge beside the heading is smaller, and both should keep their proportion to this text.',
  'The first chapter holds well over two thousand characters so that its size is decided on the page that renders first.',
  'Nothing in this file is meant to be read for its own sake; it exists so a measurement has something honest to measure.',
  'When the owner taps the plus button once, this text should grow by one step and not by three quarters of its size.',
];

const STYLES = {
  Rem: `html { font-size: 62.5%; }
body { -webkit-text-size-adjust: 100%; }
p { font-size: 1.6rem; line-height: 1.5; }
h1 { font-size: 2.4rem; }
.badge { font-size: x-small; }
.note { font-size: 12px; }
`,
  Small: `body { font-size: 12px; }
p { line-height: 1.5; }
h1 { font-size: 2em; }
.badge { font-size: x-small; }
.note { font-size: 12px; }
`,
} as const;

function chapter(title: string, badge: string, paragraphs: number): string {
  const body = Array.from(
    { length: paragraphs },
    (_, i) => `<p>${SENTENCES[i % SENTENCES.length]} ${SENTENCES[(i + 1) % SENTENCES.length]}</p>`,
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${title}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
<h1><span class="badge">${badge}</span> ${title}</h1>
${body}
<p class="note">A note set at twelve pixels, which no root size reaches.</p>
</body>
</html>
`;
}

function write(directory: string, kind: keyof typeof STYLES): string {
  const title = `Sized Fixture ${kind}`;
  const path = join(directory, `${title}.epub`);
  const entries = [
    // The mimetype first and stored, as the EPUB container requires.
    { name: 'mimetype', data: utf8('application/epub+zip') },
    { name: 'META-INF/container.xml', data: utf8(CONTAINER) },
    { name: 'OEBPS/content.opf', data: utf8(packageDocument(`urn:openreader:sized-fixture:${kind.toLowerCase()}`, title)) },
    { name: 'OEBPS/nav.xhtml', data: utf8(NAV) },
    { name: 'OEBPS/style.css', data: utf8(STYLES[kind]) },
    { name: 'OEBPS/one.xhtml', data: utf8(chapter('The First Chapter', 'I', 14)) },
    { name: 'OEBPS/two.xhtml', data: utf8(chapter('The Second Chapter', 'II', 3)) },
  ];
  writeFileSync(path, zip(entries, { level: 'store' }));
  return path;
}

const directory = process.argv[2];
if (!directory) {
  console.error('Usage: npx tsx test/manual-test/sized-fixtures.ts OUTPUT_DIRECTORY');
  process.exit(2);
}
mkdirSync(directory, { recursive: true });
for (const kind of Object.keys(STYLES) as (keyof typeof STYLES)[]) console.log(write(directory, kind));
