/**
 * `A Book That Carries Script`, for ADR 0077: a Document's own script must not
 * run in the reader's page, and a Block whose id holds an apostrophe must come
 * back at its sentence when the page is opened again.
 *
 *     npx tsx test/manual-test/fixtures/script-and-quote-fixture.ts OUTPUT_DIRECTORY
 *
 * Writes `A Book That Carries Script.epub`, three chapters with NCX contents
 * (fixtures README):
 *
 * - **The Plain Chapter**: twelve ordinary paragraphs and no script.
 * - **The Scripted Chapter**: seven forms of a Document's own script, each of
 *   which, if it runs, posts the app's own problem message with the detail
 *   `SCRIPT RAN: <form>`. Before ADR 0077 that detail became the Player's note
 *   (`The highlight could not be drawn: SCRIPT RAN: …`), and a Debug Mode build
 *   writes it to the Debug Log. After it, nothing of the kind appears anywhere,
 *   and Safari's Web Inspector shows the policy refusing each one. The forms: a
 *   script before `<head>`, a script element, `<script src>` from the archive,
 *   an SVG `<script>`, `img onerror`, `body onload`, and a nested
 *   `iframe srcdoc`. Each posts once through
 *   `window.webkit.messageHandlers.ReactNativeWebView` and once through
 *   `parent.ReactNativeWebView`, the main frame's own shim.
 * - **Newton's Chapter**: its heading carries `id="Newton's_laws"`, so every
 *   Block of it has a CFI with an apostrophe in an id assertion. Before ADR 0077
 *   a page opened again after iOS ended its process (#120,
 *   `../library-and-reader/webcontent-killed.sh`) came back at the start of the
 *   Document instead of at a sentence here. The chapters before it are long
 *   enough that a new page does not lay it out at the start.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { utf8, zip } from '../../core/document/zip-fixture';

const TITLE = 'A Book That Carries Script';
const UID = 'urn:openreader:a-book-that-carries-script';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

const PACKAGE = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${UID}</dc:identifier>
    <dc:title>${TITLE}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-10-12T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="plain" href="plain.xhtml" media-type="application/xhtml+xml"/>
    <item id="scripted" href="scripted.xhtml" media-type="application/xhtml+xml" properties="scripted svg"/>
    <item id="newton" href="newton.xhtml" media-type="application/xhtml+xml"/>
    <item id="posts" href="posts.js" media-type="text/javascript"/>
  </manifest>
  <spine toc="ncx"><itemref idref="plain"/><itemref idref="scripted"/><itemref idref="newton"/></spine>
</package>
`;

const NCX = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${UID}"/></head>
  <docTitle><text>${TITLE}</text></docTitle>
  <navMap>
    <navPoint id="c1" playOrder="1"><navLabel><text>The Plain Chapter</text></navLabel><content src="plain.xhtml"/></navPoint>
    <navPoint id="c2" playOrder="2"><navLabel><text>The Scripted Chapter</text></navLabel><content src="scripted.xhtml"/></navPoint>
    <navPoint id="c3" playOrder="3"><navLabel><text>Newton's Chapter</text></navLabel><content src="newton.xhtml"/></navPoint>
  </navMap>
</ncx>
`;

/** What a running script posts: the app's problem message, by both ways a section can reach the handler. */
function posts(form: string): string {
  const message = `JSON.stringify({type:'openreader:problem',utterance:-1,detail:'SCRIPT RAN: ${form}'})`;
  return (
    `try{window.webkit.messageHandlers.ReactNativeWebView.postMessage(${message})}catch(e){}` +
    `try{parent.ReactNativeWebView.postMessage(${message})}catch(e){}`
  );
}

const attribute = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const PLAIN = Array.from(
  { length: 12 },
  (_, at) =>
    `<p>This is paragraph ${at + 1} of the plain chapter, which carries no script at all. ` +
    `It is long enough to fill a good part of the screen, so that the chapters after it are laid out only when the reader reaches them. ` +
    `Nothing in it changes when the Document is opened again.</p>`,
).join('\n');

function plainChapter(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>The Plain Chapter</title></head>
<body>
<h1>The Plain Chapter</h1>
${PLAIN}
</body>
</html>
`;
}

function scriptedChapter(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><script type="text/javascript">${posts('script before head')}</script>
<head><title>The Scripted Chapter</title>
<script type="text/javascript">${posts('script element')}</script>
<script type="text/javascript" src="posts.js"></script>
</head>
<body onload="${attribute(posts('body onload'))}">
<h1>The Scripted Chapter</h1>
<p>This chapter carries seven forms of script. None of them should run, and the reader should read this sentence like any other.</p>
<p><img alt="" src="missing.png" onerror="${attribute(posts('img onerror'))}"/></p>
<iframe srcdoc="${attribute(`<script>${posts('nested srcdoc iframe')}</script>`)}"></iframe>
<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script type="text/javascript">${posts('svg script')}</script></svg>
${PLAIN.replace(/plain chapter, which carries no script at all/g, 'scripted chapter, after its scripts')}
</body>
</html>
`;
}

function newtonChapter(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Newton's Chapter</title></head>
<body>
<h1 id="Newton's_laws">Newton's Chapter</h1>
<p>The first law says that a body keeps its state of rest or of uniform motion unless a force acts on it. The second law ties the force to the change in its motion. The third law says that every action has an equal and opposite reaction.</p>
<p>Every Block of this chapter has an apostrophe in an id of its address, which is what this chapter is for. Pause in this paragraph, end the page's process, and the page should come back here with the sentence highlighted.</p>
<p>A last paragraph follows, so that there is somewhere to read on to.</p>
</body>
</html>
`;
}

const directory = process.argv[2];
if (!directory) {
  console.error('Usage: npx tsx test/manual-test/fixtures/script-and-quote-fixture.ts OUTPUT_DIRECTORY');
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
      { name: 'OEBPS/toc.ncx', data: utf8(NCX) },
      { name: 'OEBPS/plain.xhtml', data: utf8(plainChapter()) },
      { name: 'OEBPS/scripted.xhtml', data: utf8(scriptedChapter()) },
      { name: 'OEBPS/newton.xhtml', data: utf8(newtonChapter()) },
      { name: 'OEBPS/posts.js', data: utf8(posts('script src from the archive')) },
    ],
    { level: 'store' },
  ),
);
console.log(path);
