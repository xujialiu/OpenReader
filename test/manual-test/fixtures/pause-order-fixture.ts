/**
 * Five short chapters in five spine files, for the #56 live checks a
 * two-chapter fixture cannot show. Each pair of chapters is dedicated to one
 * check, so the checks do not have to share timing with each other:
 *
 * - One and Two prove order is top-down regardless of tap order, by letting
 *   both run to completion and recording which finishes first. Nothing is
 *   paused here, so this needs no precise timing.
 * - Three and Four prove pausing the chapter being written starts the next
 *   one, the mixed-state label, and the ring in Manage downloads. Three
 *   carries an extra two sentences so there is a comfortable window to pause
 *   it before it finishes on its own.
 * - Five is added later, while Three is still paused, to prove adding a
 *   chapter never resumes one the owner paused, and it is what survives the
 *   app restart alongside Three.
 *
 *     npx tsx test/manual-test/fixtures/pause-order-fixture.ts OUTPUT_DIRECTORY
 *
 * Writes `Pause Order Fixture.epub`. Every sentence is different, so no
 * Utterance of one chapter can be answered by a Clip of another. The ZIP is
 * `test/core/document/zip-fixture.ts`'s, stored.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { utf8, zip } from '../../core/document/zip-fixture';

const TITLE = 'Pause Order Fixture';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

const FILES = ['one', 'two', 'three', 'four', 'five'] as const;
const TITLES: Record<(typeof FILES)[number], string> = {
  one: 'Order Chapter One', two: 'Order Chapter Two', three: 'Order Chapter Three', four: 'Order Chapter Four', five: 'Order Chapter Five',
};

const PACKAGE = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:openreader:pause-order-fixture</dc:identifier>
    <dc:title>${TITLE}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-09-24T00:00:00Z</meta>
    <!-- Regenerated at ${new Date().toISOString()}: every run gets a new
         content hash and so a fresh Library id with no prior download
         state, without changing the readable text below. -->
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${FILES.map((f) => `<item id="${f}" href="${f}.xhtml" media-type="application/xhtml+xml"/>`).join('\n    ')}
  </manifest>
  <spine>${FILES.map((f) => `<itemref idref="${f}"/>`).join('')}</spine>
</package>
`;

const NAV = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>
${FILES.map((f) => `  <li><a href="${f}.xhtml">${TITLES[f]}</a></li>`).join('\n')}
</ol></nav></body>
</html>
`;

const SENTENCES: Record<(typeof FILES)[number], readonly string[]> = {
  one: [
    'A clockmaker kept a small shop at the end of the lane.',
    'Every gear he cut by hand and every spring he wound himself.',
    'On quiet afternoons he could hear which clock was about to stop.',
  ],
  two: [
    'A courier crossed the bridge twice a day, rain or clear sky.',
    'He knew the bridge by the sound its planks made underfoot.',
    'One plank rang lower than the rest, and he always stepped past it.',
  ],
  // Three carries two extra sentences, so there is a comfortable window to
  // pause it mid-write before it finishes on its own.
  three: [
    'A gardener planted the same row of beans every single spring.',
    'She said a bean that came up crooked still fed the table.',
    'By autumn the crooked ones were taller than the straight ones.',
    'She kept the best seeds in a tin marked with the year.',
    'Visitors always asked her which row she trusted most, and she never said.',
  ],
  // Four also carries extra sentences: it is the one paused through Manage
  // downloads, which needs enough time left to navigate there and back
  // before the chapter finishes on its own (notes, 2026-09-24 — a 3-sentence
  // version raced to completion during that navigation).
  four: [
    'A lighthouse keeper wound the great lamp every evening before dusk.',
    'She logged the weather in a book that never once left the tower.',
    'On the clearest nights she could see three other lights across the strait.',
    'A supply boat came once a month, weather allowing, with oil and letters.',
    'She answered every letter the same evening it arrived, never later.',
  ],
  five: [
    'A binder rebuilt old spines with linen thread and thin wheat paste.',
    'He said a book repaired well should outlast the one who mended it.',
    'The oldest volume on his own shelf was one he had rebound twice.',
  ],
};

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
  console.error('Usage: npx tsx test/manual-test/fixtures/pause-order-fixture.ts OUTPUT_DIRECTORY');
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
      ...FILES.map((f) => ({ name: `OEBPS/${f}.xhtml`, data: utf8(chapter(TITLES[f], SENTENCES[f])) })),
    ],
    { level: 'store' },
  ),
);
console.log(path);
