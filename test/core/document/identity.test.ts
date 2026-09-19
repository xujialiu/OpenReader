import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_ID_PREFIX,
  asDocumentFormat,
  asDocumentId,
  documentIdOf,
  identifyDocument,
  matchIdentities,
  readPackageIdentifiers,
  type DocumentFormat,
} from '../../../src/core/document/identity';

/**
 * ADR 0004, against real bytes.
 *
 * The bytes are built here rather than read from a fixture on disk, because
 * `src/core/` has no file system by design and this layer's tests have none
 * either. `epub()` below writes an actual ZIP — store-only, correct CRCs — so
 * "the same Document re-compressed" is a genuinely different byte stream rather
 * than a string with a character changed, which is the whole situation ADR 0004
 * records the second identifier to cover.
 */

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A store-only ZIP. `comment` lands in the end-of-central-directory record,
 * which is how a "re-saved" copy is produced: the same entries, the same
 * `dc:identifier`, different bytes.
 */
function zip(entries: readonly { name: string; data: Uint8Array }[], comment = ''): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = utf8(entry.name);
    const crc = crc32(entry.data);
    const header = new Uint8Array(30 + name.length);
    const h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(8, 0, true); // stored
    h.setUint32(14, crc, true);
    h.setUint32(18, entry.data.length, true);
    h.setUint32(22, entry.data.length, true);
    h.setUint16(26, name.length, true);
    header.set(name, 30);
    local.push(header, entry.data);

    const record = new Uint8Array(46 + name.length);
    const c = new DataView(record.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(10, 0, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, entry.data.length, true);
    c.setUint32(24, entry.data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    record.set(name, 46);
    central.push(record);
    offset += header.length + entry.data.length;
  }
  const directory = concat(central);
  const commentBytes = utf8(comment);
  const end = new Uint8Array(22 + commentBytes.length);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, directory.length, true);
  e.setUint32(16, offset, true);
  e.setUint16(20, commentBytes.length, true);
  end.set(commentBytes, 22);
  return concat([...local, directory, end]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const CONTAINER = `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

/** An EPUB: the uncompressed `mimetype` entry first, the container, and the package document. */
const epub = (opf: string, comment = ''): Uint8Array =>
  zip(
    [
      { name: 'mimetype', data: utf8('application/epub+zip') },
      { name: 'META-INF/container.xml', data: utf8(CONTAINER) },
      { name: 'OEBPS/content.opf', data: utf8(opf) },
    ],
    comment,
  );

const opf = (metadata: string, packageAttributes = ' unique-identifier="pub-id"'): string => `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0"${packageAttributes}>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${metadata}
    <dc:title>A Small Book</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>
  <spine><itemref idref="nav"/></spine>
</package>`;

const UUID = 'urn:uuid:9f1b2c3d-1111-4000-8000-abcdefabcdef';

describe('documentIdOf', () => {
  it('names a Document by its own bytes, self-describing', () => {
    const id = documentIdOf(epub(opf(`    <dc:identifier id="pub-id">${UUID}</dc:identifier>`)));
    expect(id.startsWith(DOCUMENT_ID_PREFIX)).toBe(true);
    expect(id).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('gives the same name to the same bytes and a different one to different bytes', () => {
    const one = epub(opf(`    <dc:identifier id="pub-id">${UUID}</dc:identifier>`));
    expect(documentIdOf(one)).toBe(documentIdOf(epub(opf(`    <dc:identifier id="pub-id">${UUID}</dc:identifier>`))));
    expect(documentIdOf(one)).not.toBe(documentIdOf(epub(opf(`    <dc:identifier id="pub-id">${UUID}</dc:identifier>`), 'resaved')));
  });
});

describe('asDocumentId', () => {
  it('accepts what documentIdOf produced and refuses everything else', () => {
    expect(asDocumentId(documentIdOf(utf8('x')))).not.toBeNull();
    expect(asDocumentId(`${DOCUMENT_ID_PREFIX}${'a'.repeat(64)}`)).not.toBeNull();
    // A bare digest, the wrong length, upper case, another algorithm, or not a string at all.
    expect(asDocumentId('a'.repeat(64))).toBeNull();
    expect(asDocumentId(`${DOCUMENT_ID_PREFIX}${'a'.repeat(63)}`)).toBeNull();
    expect(asDocumentId(`${DOCUMENT_ID_PREFIX}${'A'.repeat(64)}`)).toBeNull();
    expect(asDocumentId(`sha512:${'a'.repeat(64)}`)).toBeNull();
    expect(asDocumentId(undefined)).toBeNull();
    expect(asDocumentId(12)).toBeNull();
  });
});

describe('asDocumentFormat', () => {
  it('knows EPUB and refuses a format this build cannot read (ADR 0007)', () => {
    expect(asDocumentFormat('epub')).toBe('epub');
    expect(asDocumentFormat('pdf')).toBeNull();
    expect(asDocumentFormat('EPUB')).toBeNull();
    expect(asDocumentFormat(null)).toBeNull();
  });
});

describe('readPackageIdentifiers', () => {
  it('follows unique-identifier to the publication identifier, past the others', () => {
    const text = opf(`    <dc:identifier id="isbn">urn:isbn:9780000000001</dc:identifier>
    <dc:identifier id="pub-id">${UUID}</dc:identifier>`);
    expect(readPackageIdentifiers(text)).toEqual({ all: ['urn:isbn:9780000000001', UUID], unique: UUID });
  });

  it('reports no unique identifier when the attribute points at nothing that exists', () => {
    const text = opf(
      `    <dc:identifier id="a">A</dc:identifier>
    <dc:identifier id="b">B</dc:identifier>`,
      ' unique-identifier="missing"',
    );
    expect(readPackageIdentifiers(text)).toEqual({ all: ['A', 'B'], unique: null });
  });

  it('reads an identifier with no prefix and one with an unusual prefix', () => {
    expect(readPackageIdentifiers('<package><metadata><identifier>bare</identifier></metadata></package>').all).toEqual(['bare']);
    expect(readPackageIdentifiers('<package><metadata><dcterms:identifier>odd</dcterms:identifier></metadata></package>').all).toEqual(['odd']);
  });

  it('trims the whitespace a pretty-printed package document leaves inside the element', () => {
    expect(readPackageIdentifiers(`<package><metadata><dc:identifier>\n      ${UUID}\n    </dc:identifier></metadata></package>`).all).toEqual([
      UUID,
    ]);
  });

  it('decodes entities, because an identifier can be a URL', () => {
    expect(readPackageIdentifiers('<package><metadata><dc:identifier>http://x/?a=1&amp;b=2</dc:identifier></metadata></package>').all).toEqual([
      'http://x/?a=1&b=2',
    ]);
    expect(readPackageIdentifiers('<package><metadata><dc:identifier>&#x41;&#66;</dc:identifier></metadata></package>').all).toEqual(['AB']);
  });

  it('does not read a commented-out identifier, which would otherwise win on document order', () => {
    const text = `<package unique-identifier="pub-id"><metadata>
      <!-- <dc:identifier id="pub-id">urn:uuid:draft</dc:identifier> -->
      <dc:identifier id="real">urn:uuid:real</dc:identifier>
    </metadata></package>`;
    expect(readPackageIdentifiers(text)).toEqual({ all: ['urn:uuid:real'], unique: null });
  });

  it('treats an empty identifier as an absent one', () => {
    expect(readPackageIdentifiers('<package><metadata><dc:identifier id="a"></dc:identifier></metadata></package>').all).toEqual([]);
    expect(readPackageIdentifiers('<package><metadata><dc:identifier id="a"/></metadata></package>').all).toEqual([]);
  });

  it('does not let a self-closing identifier swallow the one after it', () => {
    const text = '<package><metadata><dc:identifier id="a"/><dc:identifier id="b">B</dc:identifier></metadata></package>';
    expect(readPackageIdentifiers(text).all).toEqual(['B']);
  });

  it('finds nothing in a package document with no identifier at all', () => {
    expect(readPackageIdentifiers(opf('    <dc:creator>Nobody</dc:creator>'))).toEqual({ all: [], unique: null });
  });
});

describe('identifyDocument', () => {
  const bytes = epub(opf(`    <dc:identifier id="pub-id">${UUID}</dc:identifier>`));

  it('records the Document Id, the format and the secondary identifier together', () => {
    const identity = identifyDocument(bytes, 'epub', readPackageIdentifiers(opf(`    <dc:identifier id="pub-id">${UUID}</dc:identifier>`)));
    expect(identity).toEqual({
      id: documentIdOf(bytes),
      format: 'epub',
      publicationId: UUID,
      publicationIdSource: 'unique-identifier',
    });
  });

  it('is still an identity when dc:identifier is absent — the bytes are enough', () => {
    const plain = epub(opf('    <dc:creator>Nobody</dc:creator>'));
    const identity = identifyDocument(plain, 'epub', readPackageIdentifiers(opf('    <dc:creator>Nobody</dc:creator>')));
    expect(identity.publicationId).toBeNull();
    expect(identity.publicationIdSource).toBe('none');
    expect(identity.id).toBe(documentIdOf(plain));
  });

  it('is still an identity when the package document could not be read at all', () => {
    expect(identifyDocument(bytes, 'epub').publicationIdSource).toBe('none');
    expect(identifyDocument(bytes, 'epub', null).publicationIdSource).toBe('none');
  });

  it('says so when one identifier is declared and nothing names it', () => {
    const text = opf(`    <dc:identifier>${UUID}</dc:identifier>`, '');
    expect(identifyDocument(bytes, 'epub', readPackageIdentifiers(text))).toMatchObject({
      publicationId: UUID,
      publicationIdSource: 'only',
    });
  });

  it('says so when several are declared and none is named — duplicated, which real EPUBs are', () => {
    const text = opf(
      `    <dc:identifier>urn:isbn:9780000000001</dc:identifier>
    <dc:identifier>${UUID}</dc:identifier>`,
      '',
    );
    expect(identifyDocument(bytes, 'epub', readPackageIdentifiers(text))).toMatchObject({
      publicationId: 'urn:isbn:9780000000001',
      publicationIdSource: 'first-of-several',
    });
  });
});

describe('matchIdentities', () => {
  const identity = (bytes: Uint8Array, text: string) => identifyDocument(bytes, 'epub', readPackageIdentifiers(text));
  const named = `    <dc:identifier id="pub-id">${UUID}</dc:identifier>`;

  it('calls the same bytes the same Document, definitively', () => {
    const a = identity(epub(opf(named)), opf(named));
    const b = identity(epub(opf(named)), opf(named));
    expect(matchIdentities(a, b)).toBe('same-bytes');
  });

  /** The failure ADR 0004 records the second identifier to cover: a re-saved copy changes the Document Id and keeps `dc:identifier`. */
  it('recognises a re-saved copy through its unambiguous publication identifier', () => {
    const a = identity(epub(opf(named)), opf(named));
    const b = identity(epub(opf(named), 'resaved by another tool'), opf(named));
    expect(a.id).not.toBe(b.id);
    expect(matchIdentities(a, b)).toBe('same-publication');
  });

  it('refuses to match on an identifier the Document itself was ambiguous about', () => {
    const several = opf(
      `    <dc:identifier>urn:isbn:9780000000001</dc:identifier>
    <dc:identifier>${UUID}</dc:identifier>`,
      '',
    );
    const a = identity(epub(opf(named)), several);
    const b = identity(epub(opf(named), 'resaved'), several);
    expect(a.publicationId).toBe(b.publicationId);
    expect(matchIdentities(a, b)).toBe('different');
  });

  it('refuses two Documents with no identifier, which would otherwise both be null', () => {
    const none = opf('    <dc:creator>Nobody</dc:creator>');
    const a = identity(epub(opf(named)), none);
    const b = identity(epub(opf(named), 'resaved'), none);
    expect(matchIdentities(a, b)).toBe('different');
  });

  /**
   * ADR 0007 keeps formats pluggable, so the guard is written now and asserted
   * now. The cast is the only way to name a second format before one exists, and
   * it is the point of the test: an EPUB and a PDF that share an ISBN — a book
   * and its own galley proof — are not one Document.
   */
  it('refuses two Documents of different formats that share an identifier', () => {
    const a = identity(epub(opf(named)), opf(named));
    const b = identity(epub(opf(named), 'resaved'), opf(named));
    expect(matchIdentities(a, b)).toBe('same-publication');
    expect(matchIdentities(a, { ...b, format: 'pdf' as DocumentFormat })).toBe('different');
  });
});
