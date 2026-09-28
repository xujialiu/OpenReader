/**
 * `A Short Test of Reading Aloud`, the small two-chapter English fixture many
 * manual probes reference (`DownloadRingProbe`, `OfflineFixProbe`,
 * `ReaderProbe`, `AlignmentProbe`, `FontSizeProbe`, `GeneralFontsProbe`,
 * `AzureProviderProbe`, `LibraryActionsProbe`, `SecondVoiceProbe`,
 * `test/manual-test/README.md`). Two chapters, "The First Chapter" and "The
 * Second Chapter", 17 speakable utterances in total (README, "The download
 * ring…", "17 speakable utterances in two chapters"), split 9 and 8 so
 * neither chapter is empty.
 *
 *     npx tsx test/manual-test/fixtures/short-test-fixture.ts OUTPUT_DIRECTORY
 *
 * Writes `A Short Test of Reading Aloud.epub`. Every sentence is different,
 * so no Utterance of one chapter can be answered by a Clip of another. Add it
 * to a device's Library the way any fixture is loaded (README, "Real
 * books"): copy into `Documents/Inbox` and send
 * `{"seq":N,"do":"add","file":"A Short Test of Reading Aloud.epub"}` through
 * the walkthrough harness. The README describes seeding this fixture instead
 * through `identifyDocument`/`serializeLibrary` directly, as a one-time step
 * on the original device; this generator exists because a later, freshly
 * created worktree simulator did not have it, and the harness's own `add`
 * command is an equally direct, non-picker path (2026-09-24). The ZIP is
 * `test/core/document/zip-fixture.ts`'s, stored.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { utf8, zip } from '../../core/document/zip-fixture';

const TITLE = 'A Short Test of Reading Aloud';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

const PACKAGE = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:openreader:short-test-of-reading-aloud</dc:identifier>
    <dc:title>${TITLE}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-09-24T00:00:00Z</meta>
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
  <li><a href="one.xhtml">The First Chapter</a></li>
  <li><a href="two.xhtml">The Second Chapter</a></li>
</ol></nav></body>
</html>
`;

// 9 sentences.
export const FIRST = [
  'This is a short test of reading aloud, written for a machine to speak.',
  'The first sentence only says that a second one is coming after it.',
  'A narrator reading this aloud would find nothing difficult about it.',
  'Every sentence here is different, so no clip can answer for another.',
  'The chapter has nine sentences, and this is the middle of them.',
  'Nothing in this paragraph is meant to be remembered, only measured.',
  'A short chapter finishes quickly, which is exactly the point of it.',
  'The next sentence is the last one before the chapter changes.',
  'That was the ninth and final sentence of the first chapter.',
] as const;

// 8 sentences.
export const SECOND = [
  'The second chapter begins here, with a sentence unlike any before it.',
  'Eight sentences make up this chapter, one fewer than the first.',
  'A reader moving from one chapter to the next hears a new voice cue.',
  'Nothing about this sentence depends on anything read earlier.',
  'The middle of the second chapter looks much like its beginning.',
  'Two sentences remain after this one before the chapter ends.',
  'This is the second to last sentence of the whole short test.',
  'That was the last sentence, and the short test is now finished.',
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
  console.error('Usage: npx tsx test/manual-test/fixtures/short-test-fixture.ts OUTPUT_DIRECTORY');
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
      { name: 'OEBPS/one.xhtml', data: utf8(chapter('The First Chapter', FIRST)) },
      { name: 'OEBPS/two.xhtml', data: utf8(chapter('The Second Chapter', SECOND)) },
    ],
    { level: 'store' },
  ),
);
console.log(path);
