/**
 * `Positions and Copies` and `Named Places`, two one-purpose EPUBs for the
 * #249/#250/#282/#283 position verification on the simulator (2026-10-20).
 *
 * `Positions and Copies` — chapter one holds the three repeat shapes in one
 * rendered section:
 *
 * - h1 (Utterance 0), then `Go. Go. Stop now.` (Utterances 1-3): the #250
 *   shape — two copies of `Go.` whose stored context tells them apart.
 * - 100 × `Is this number N? Yes.` (Utterances 4-203): the #283 shape — the
 *   65th-and-later `Yes.` must resume by its context, past the old 64-hit cap.
 * - 100 × `Yes.` (Utterances 204-303): indistinguishable copies — a place on
 *   any of them must be refused, not guessed.
 *
 * `Named Places` — three chapters, each holding one confusion pair of the
 * #282 shapes as whole-Block paragraphs, in a section of their own so the
 * fallback search cannot tie against a look-alike in another chapter:
 *
 * - `Chapter 1` / `Chapter 10` (the number inside a longer number),
 * - `7` / `1907` (a digit inside a longer number),
 * - `第1章` / `第10章` (the CJK control; no spaces, so ASCII word boundaries
 *   say nothing).
 *
 *     npx tsx test/manual-test/fixtures/positions-copies-fixture.ts OUTPUT_DIRECTORY
 *
 * Writes `Positions and Copies.epub` and `Named Places.epub`. Add them the way
 * any fixture is loaded (README, "Real books"): copy into `Documents/Inbox`
 * and send `{"seq":N,"do":"add","file":"NAME.epub"}` through the harness.
 * The ZIP is `test/core/document/zip-fixture.ts`'s, stored.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { utf8, zip } from '../../core/document/zip-fixture';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

const book = (title: string, identifier: string, ids: readonly string[], navRows: readonly [string, string][]) => {
  const manifest = ids.map((id) => `    <item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`).join('\n');
  const spine = ids.map((id) => `    <itemref idref="${id}"/>`).join('\n');
  const rows = navRows.map(([href, label]) => `  <li><a href="${href}">${label}</a></li>`).join('\n');
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:openreader:${identifier}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-10-20T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${manifest}
  </manifest>
  <spine>
${spine}
  </spine>
</package>
`;
  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>
${rows}
</ol></nav></body>
</html>
`;
  const chapter = (id: string, heading: string, paragraphs: readonly string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${heading}</title></head>
<body>
<h1>${heading}</h1>
${paragraphs.map((text) => `<p>${text}</p>`).join('\n')}
</body>
</html>
`;
  return { opf, nav, chapter, title };
};

// `Go. Go. Stop now.` splits into three Utterances exactly as written (the
// #250 host test pins the middle one's anchor as {exact:'Go.', prefix:'Go. ',
// suffix:' Stop now.'}). The numbered questions keep every `Yes.` a sentence
// of its own with its question as context; the bare block gives 100 copies
// whose context cannot tell any of them apart.
const copiesChapter = () => {
  const numbered = Array.from({ length: 100 }, (_, i) => `Is this number ${i}? Yes.`).join(' ');
  const bare = Array(100).fill('Yes.').join(' ');
  return [
    'Go. Go. Stop now.',
    numbered,
    bare,
  ];
};

const copies = book(
  'Positions and Copies',
  'positions-copies-fixture',
  ['one', 'two'],
  [['one.xhtml', 'Positions and Copies'], ['two.xhtml', 'Second Chapter']],
);

const copiesOne = copies.chapter('one', 'Positions and Copies', copiesChapter());
const copiesTwo = copies.chapter('two', 'Second Chapter', ['A short second chapter the scenarios never render.']);

// Each confusion pair sits in a chapter of its own, under a digit-free
// heading, so a stored anchor can only ever be tied against its own pair.
const named = book(
  'Named Places',
  'named-places-fixture',
  ['one', 'two', 'three'],
  [['one.xhtml', 'Longer Numbers'], ['two.xhtml', 'Digit Inside'], ['three.xhtml', 'Han Chapters']],
);

const namedOne = named.chapter('one', 'Longer Numbers', ['Chapter 1', 'Chapter 10']);
const namedTwo = named.chapter('two', 'Digit Inside', ['7', '1907']);
const namedThree = named.chapter('three', 'Han Chapters', ['第1章', '第10章']);

const output = process.argv[2];
if (!output) {
  console.error('Usage: npx tsx test/manual-test/fixtures/positions-copies-fixture.ts OUTPUT_DIRECTORY');
  process.exit(2);
}
mkdirSync(output, { recursive: true });

for (const [name, files] of [
  ['Positions and Copies', { opf: copies.opf, nav: copies.nav, one: copiesOne, two: copiesTwo }],
  ['Named Places', { opf: named.opf, nav: named.nav, one: namedOne, two: namedTwo, three: namedThree }],
] as const) {
  const entries = [
    { name: 'META-INF/container.xml', data: utf8(CONTAINER) },
    ...Object.entries(files).map(([id, text]) =>
      ({ name: id === 'opf' ? 'OEBPS/content.opf' : id === 'nav' ? 'OEBPS/nav.xhtml' : `OEBPS/${id}.xhtml`, data: utf8(text) })),
  ];
  writeFileSync(join(output, `${name}.epub`), zip(entries), { mode: utf8.mode });
  console.log(`${join(output, `${name}.epub`)}`);
}
