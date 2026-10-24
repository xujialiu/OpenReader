/**
 * `Word Boundaries for Lookup`, a one-chapter English/Chinese fixture holding
 * the boundary examples of design 0051 / #323/#274, one paragraph per example,
 * so a long press can target a known line:
 *
 * 1. surrounding punctuation — `hope,` inside quotes counts as one word;
 * 2. apostrophes — `Don't` (straight) and `reader’s` (curly) are one word;
 * 3. hyphenated compounds — `well-known` (ASCII hyphen) and `well‑known`
 *    (U+2011 nonbreaking hyphen) are one word each;
 * 4. `give up` is multiple words (expands to `give up hope`);
 * 5. Chinese — `学习` is one word; `学习语言` is more than one;
 * 6. a filler paragraph below, so the page has scroll room and the last
 *    example is never at the screen edge.
 *
 *     npx tsx test/manual-test/fixtures/lookup-words-fixture.ts OUTPUT_DIRECTORY
 *
 * Writes `Word Boundaries for Lookup.epub`. Load it the way any fixture is
 * loaded: copy into the container's `Documents/Inbox` and add it through the
 * walkthrough harness. It exists for the lookup-mode verification (2026-10-24);
 * every example is on the first page of chapter one, in the order above.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { utf8, zip } from '../../core/document/zip-fixture';

const TITLE = 'Word Boundaries for Lookup';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

const PACKAGE = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:openreader:word-boundaries-for-lookup</dc:identifier>
    <dc:title>${TITLE}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-10-24T00:00:00Z</meta>
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
  <li><a href="one.xhtml">Boundary Examples</a></li>
</ol></nav></body>
</html>
`;

// One paragraph per boundary example, in the order the recipe cites them.
export const PARAGRAPHS = [
  'Even with punctuation, the word "hope," stays a single word here.',
  "Don't panic, and the reader’s book is exactly where it was left.",
  'A well-known compound and a well‑known one with a nonbreaking hyphen.',
  'People give up hope when the waiting grows longer than the journey.',
  '学习 means study, and 学习语言 means to learn a language.',
  'The last paragraph only gives the page some room below the examples.',
] as const;

function chapter(title: string, paragraphs: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${title}</title></head>
<body>
<h1>${title}</h1>
${paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('\n')}
</body>
</html>
`;
}

const directory = process.argv[2];
if (!directory) {
  console.error('Usage: npx tsx test/manual-test/fixtures/lookup-words-fixture.ts OUTPUT_DIRECTORY');
  process.exit(2);
}
mkdirSync(directory, { recursive: true });
const path = join(directory, `${TITLE}.epub`);
writeFileSync(
  path,
  zip([
    { name: 'mimetype', data: utf8('application/epub+zip') },
    { name: 'META-INF/container.xml', data: utf8(CONTAINER) },
    { name: 'OEBPS/content.opf', data: utf8(PACKAGE) },
    { name: 'OEBPS/nav.xhtml', data: utf8(NAV) },
    { name: 'OEBPS/one.xhtml', data: utf8(chapter('Boundary Examples', PARAGRAPHS)) },
  ]),
);
console.log(path);
