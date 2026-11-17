/**
 * Three malformed EPUBs for the reader-startup failure checks (#217, fixed by
 * 0705e26): each is an intact ZIP archive whose EPUB *structure* is broken in
 * one specific way, so the Reader must report one terminal, readable failure
 * instead of loading for ever, and must not dump the document's bytes (the
 * base64 `src`) into the reason.
 *
 *     npx tsx test/manual-test/fixtures/malformed-epub-fixtures.ts OUTPUT_DIRECTORY
 *
 * Writes, into OUTPUT_DIRECTORY:
 *
 * - `Malformed No Container.epub` — a complete, otherwise valid book
 *   (mimetype, OPF, nav, two chapters) with **no `META-INF/container.xml`**.
 *   This is the archive whose pre-fix behaviour laid out for ever (README,
 *   #249/#250 pitfall): epub.js's `book.ready` stays pending after the archive
 *   open fails.
 * - `Malformed Missing Package.epub` — a container.xml that points at
 *   `OEBPS/content.opf`, which is **absent from the ZIP** (missing package).
 * - `Malformed Missing Chapter.epub` — a valid container, package, nav and
 *   second chapter, but the **first spine item's file `one.xhtml` is absent**
 *   (missing chapter). The initial display never settles: epub.js reports the
 *   section-load failure through its `displayerror` event, and the template's
 *   terminal guard observes that event — a promise rejection alone does not
 *   carry it (`#217` observes `openFailed`, `displayerror` and the initial
 *   display rejections once, sharing one terminal guard).
 *   Note the corrected path in the same terms as ADR 0011: the missing
 *   chapter's pending display is reported by `displayerror`, not by a promise
 *   rejection alone.
 *   Earlier wording of this header credited the display-promise catch for
 *   this case; that was wrong and is corrected here.
 *
 * The ZIP is `test/core/document/zip-fixture.ts`'s, stored. Add each to a
 * device's Library the way any fixture is loaded (README, "Real books"): copy
 * into `Documents/Inbox` and send
 * `{"seq":N,"do":"add","file":"Malformed No Container.epub"}` through the
 * walkthrough harness.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { utf8, zip, type ZipEntry } from '../../core/document/zip-fixture';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

function package_(
  uid: string,
  title: string,
  chapters: readonly { id: string; href: string }[],
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${uid}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-11-17T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${chapters.map((c) => `    <item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine>${chapters.map((c) => `<itemref idref="${c.id}"/>`).join('')}</spine>
</package>
`;
}

function nav(chapters: readonly { href: string; title: string }[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>
${chapters.map((c) => `  <li><a href="${c.href}">${c.title}</a></li>`).join('\n')}
</ol></nav></body>
</html>
`;
}

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

const ONE = [
  'This malformed fixture exists to fail the reader startup in one specific way.',
  'Its first chapter is ordinary English prose so nothing else can be blamed.',
  'The failure under test comes from the archive structure, not the text.',
] as const;

const TWO = [
  'The second chapter is here so a partial archive still has a reachable spine item.',
  'A reader that opens despite the missing neighbour should find this text plain.',
  'Nothing in this chapter is meant to be remembered, only measured.',
] as const;

const chapters = [
  { id: 'one', href: 'one.xhtml', title: 'The First Chapter' },
  { id: 'two', href: 'two.xhtml', title: 'The Second Chapter' },
];

/** mimetype, OPF, nav and both chapters — everything except META-INF/container.xml. */
function noContainerEntries(): ZipEntry[] {
  return [
    { name: 'mimetype', data: utf8('application/epub+zip') },
    { name: 'OEBPS/content.opf', data: utf8(package_('urn:openreader:malformed-no-container', 'Malformed No Container', chapters)) },
    { name: 'OEBPS/nav.xhtml', data: utf8(nav(chapters)) },
    { name: 'OEBPS/one.xhtml', data: utf8(chapter('The First Chapter', ONE)) },
    { name: 'OEBPS/two.xhtml', data: utf8(chapter('The Second Chapter', TWO)) },
  ];
}

/** container.xml intact, but the OPF it names is not in the archive. */
function missingPackageEntries(): ZipEntry[] {
  return [
    { name: 'mimetype', data: utf8('application/epub+zip') },
    { name: 'META-INF/container.xml', data: utf8(CONTAINER) },
    { name: 'OEBPS/nav.xhtml', data: utf8(nav(chapters)) },
    { name: 'OEBPS/one.xhtml', data: utf8(chapter('The First Chapter', ONE)) },
    { name: 'OEBPS/two.xhtml', data: utf8(chapter('The Second Chapter', TWO)) },
  ];
}

/** Everything valid except the first spine item's file, which is absent. */
function missingChapterEntries(): ZipEntry[] {
  return [
    { name: 'mimetype', data: utf8('application/epub+zip') },
    { name: 'META-INF/container.xml', data: utf8(CONTAINER) },
    { name: 'OEBPS/content.opf', data: utf8(package_('urn:openreader:malformed-missing-chapter', 'Malformed Missing Chapter', chapters)) },
    { name: 'OEBPS/nav.xhtml', data: utf8(nav(chapters)) },
    { name: 'OEBPS/two.xhtml', data: utf8(chapter('The Second Chapter', TWO)) },
  ];
}

const BOOKS: readonly { file: string; entries: ZipEntry[] }[] = [
  { file: 'Malformed No Container.epub', entries: noContainerEntries() },
  { file: 'Malformed Missing Package.epub', entries: missingPackageEntries() },
  { file: 'Malformed Missing Chapter.epub', entries: missingChapterEntries() },
];

const directory = process.argv[2];
if (!directory) {
  console.error('Usage: npx tsx test/manual-test/fixtures/malformed-epub-fixtures.ts OUTPUT_DIRECTORY');
  process.exit(2);
}
mkdirSync(directory, { recursive: true });
for (const book of BOOKS) {
  const path = join(directory, book.file);
  writeFileSync(path, zip(book.entries, { level: 'store' }));
  console.log(path);
}
