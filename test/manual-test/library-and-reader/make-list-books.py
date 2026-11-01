"""Tiny distinct EPUB 3 books for a long Library (Library Search's `Scroll Diag` fixtures, #332, #338).

  python3 -I make-list-books.py OUT_DIRECTORY [PREFIX] [COUNT]

Writes COUNT books (default 14) titled `PREFIX NN of COUNT` (default prefix
`Scroll Diag`) into OUT_DIRECTORY, each a one-chapter book whose identifier, title
and text differ, so the app keeps each as its own Document (it names a Document by
its content hash). Load them the way any fixture is loaded (the top README's
**Real books**): copy into the app's `Documents/Inbox` and send
`{"seq":N,"do":"add","file":"NAME.epub"}` through the walkthrough harness, 1.6 s
apart, then overwrite `harness.json` with `{"do":"noop"}` so a relaunch replays
nothing. What it cannot prove: that a real book opens, it has a single short
chapter.
"""
import os
import sys
import zipfile

out = sys.argv[1]
prefix = sys.argv[2] if len(sys.argv) > 2 else 'Scroll Diag'
count = int(sys.argv[3]) if len(sys.argv) > 3 else 14
os.makedirs(out, exist_ok=True)

CONTAINER = '''<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
'''

for i in range(1, count + 1):
    title = f'{prefix} {i:02d} of {count}'
    opf = f'''<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:openreader:list-book-{i:02d}-of-{count}</dc:identifier>
    <dc:title>{title}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-11-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="one" href="one.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="one"/></spine>
</package>
'''
    nav = f'''<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol><li><a href="one.xhtml">Only Chapter {i}</a></li></ol></nav></body>
</html>
'''
    one = f'''<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Only Chapter {i}</title></head>
<body><h1>Only Chapter {i}</h1><p>This is book number {i} of {count}, kept short for a list test.</p><p>Its second sentence differs for every book, here number {i * 7 + 3}.</p></body></html>
'''
    with zipfile.ZipFile(os.path.join(out, f'{title}.epub'), 'w') as book:
        book.writestr(zipfile.ZipInfo('mimetype'), 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        book.writestr('META-INF/container.xml', CONTAINER, compress_type=zipfile.ZIP_DEFLATED)
        book.writestr('OEBPS/content.opf', opf, compress_type=zipfile.ZIP_DEFLATED)
        book.writestr('OEBPS/nav.xhtml', nav, compress_type=zipfile.ZIP_DEFLATED)
        book.writestr('OEBPS/one.xhtml', one, compress_type=zipfile.ZIP_DEFLATED)
print(f'{count} books in {out}')
