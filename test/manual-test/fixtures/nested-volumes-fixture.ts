/**
 * `Nested Volumes Fold Check`, for the Download drawer's fold arrows (#334, #335): the shipped fixtures and the owner's
 * books have flat contents, so no drawer row had a `Collapse`/`Expand` arrow to tap.
 *
 *     npx tsx test/manual-test/fixtures/nested-volumes-fixture.ts OUTPUT_DIRECTORY
 *
 * Writes `Nested Volumes Fold Check.epub`: an EPUB 2 `toc.ncx` of three volumes, each a `navPoint` holding three chapter
 * `navPoint`s (twelve rows in all, volumes at depth 0 and chapters at depth 1). A volume with children shows the arrow
 * `Collapse Volume N` / `Expand Volume N` in the drawer. Every sentence is a short plain one, so the plan builds at once.
 * The contents are an NCX on purpose, as in `issue86-fixture.ts` (epub.js spells an xhtml nav's hrefs with its own folder).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { utf8, zip } from '../../core/document/zip-fixture';

const TITLE = 'Nested Volumes Fold Check';
const VOLUMES = ['Volume One', 'Volume Two', 'Volume Three'] as const;
const CHAPTERS_PER_VOLUME = 3;

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

const page = (name: string, sentences: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${name}</title></head>
<body>
  <h2>${name}</h2>
  <p>${sentences.map((sentence, index) => `<span id="s${index}">${sentence}</span>`).join(' ')}</p>
</body>
</html>
`;

interface Item { id: string; file: string; title: string; volume: number; chapter: number | null }
const items: Item[] = [];
VOLUMES.forEach((volume, v) => {
  items.push({ id: `v${v + 1}`, file: `v${v + 1}.xhtml`, title: volume, volume: v + 1, chapter: null });
  for (let c = 1; c <= CHAPTERS_PER_VOLUME; c++) {
    items.push({ id: `v${v + 1}c${c}`, file: `v${v + 1}c${c}.xhtml`, title: `Chapter ${v + 1}.${c}`, volume: v + 1, chapter: c });
  }
});

const PACKAGE = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:openreader:nested-volumes-fold-check</dc:identifier>
    <dc:title>${TITLE}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-10-30T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${items.map((item) => `    <item id="${item.id}" href="${item.file}" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine toc="ncx">${items.map((item) => `<itemref idref="${item.id}"/>`).join('')}</spine>
</package>
`;

let order = 0;
const point = (item: Item, inner = '') => {
  order += 1;
  return `    <navPoint id="${item.id}" playOrder="${order}"><navLabel><text>${item.title}</text></navLabel><content src="${item.file}"/>${inner}</navPoint>`;
};
const NCX = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:openreader:nested-volumes-fold-check"/></head>
  <docTitle><text>${TITLE}</text></docTitle>
  <navMap>
${VOLUMES.map((_, v) => {
    const volume = items.find((item) => item.volume === v + 1 && item.chapter === null)!;
    const header = point(volume).replace('</navPoint>', '');
    const chapters = items.filter((item) => item.volume === v + 1 && item.chapter !== null).map((item) => point(item)).join('\n');
    return `${header}\n${chapters}\n    </navPoint>`;
  }).join('\n')}
  </navMap>
</ncx>
`;

export function main(output: string): void {
  mkdirSync(output, { recursive: true });
  const book = zip([
    { name: 'mimetype', data: utf8('application/epub+zip') },
    { name: 'META-INF/container.xml', data: utf8(CONTAINER) },
    { name: 'OEBPS/content.opf', data: utf8(PACKAGE) },
    { name: 'OEBPS/toc.ncx', data: utf8(NCX) },
    ...items.map((item) => ({
      name: `OEBPS/${item.file}`,
      data: utf8(page(item.title, item.chapter === null
        ? [`${item.title} opens here, and its chapters follow.`, 'Nothing else is said on this page.']
        : [`${item.title} is the number ${item.chapter} chapter of volume ${item.volume}.`, 'It is plain and short.', 'Nothing here needs a voice.'])),
    })),
  ]);
  const out = join(output, `${TITLE}.epub`);
  writeFileSync(out, book);
  console.log(out);
}

if (require.main === module) {
  const output = process.argv[2];
  if (!output) {
    console.error('Usage: npx tsx test/manual-test/fixtures/nested-volumes-fixture.ts OUTPUT_DIRECTORY');
    process.exit(2);
  }
  main(output);
}
