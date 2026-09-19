import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_ID_PREFIX,
  asDocumentFormat,
  asDocumentId,
  documentIdOf,
  documentManifest,
  identifyDocument,
  matchIdentities,
  readPackageIdentifiers,
  type DocumentFormat,
} from '../../../src/core/document/identity';
import { sha256Hex } from '../../../src/core/document/sha256';
import { bytesAsArchive } from '../../../src/core/document/zip';

import { UUID, crc32, epub, namedEpub, opf, utf8, zip } from './zip-fixture';

/**
 * ADR 0004, against real archives.
 *
 * The archives are built by `zip-fixture.ts` rather than read from disk, because
 * `src/core/` has no file system by design and this layer's tests have none
 * either. They are genuine ZIPs — correct CRCs, real deflate — so "the same book
 * re-compressed" is a genuinely different byte stream and not a string with a
 * character changed. That case is the headline of ADR 0004's amendment, and it
 * cannot be faked.
 */

const archive = (bytes: Uint8Array) => bytesAsArchive(bytes);
const named = `    <dc:identifier id="pub-id">${UUID}</dc:identifier>`;

/**
 * The same book as another tool would leave it: the same publication identifier,
 * a package document whose bytes are not the same. **Not** a copy with a
 * different archive comment, which is what this used to be — under the amended
 * rule that is the *same* Document, and there is a test below that says so.
 */
const converted = (metadata: string): Uint8Array => epub(`${opf(metadata)}\n<!-- repacked by another tool -->`);

describe('documentIdOf', () => {
  it('names a Document from its manifest, self-describing', () => {
    const id = documentIdOf(archive(namedEpub()));
    expect(id.startsWith(DOCUMENT_ID_PREFIX)).toBe(true);
    expect(id).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('is not a digest of the file', () => {
    const bytes = namedEpub();
    expect(documentIdOf(archive(bytes))).not.toBe(`${DOCUMENT_ID_PREFIX}${sha256Hex(bytes)}`);
  });

  it('gives the same name to the same members and a different one when a member changes', () => {
    expect(documentIdOf(archive(namedEpub()))).toBe(documentIdOf(archive(namedEpub())));
    expect(documentIdOf(archive(namedEpub()))).not.toBe(documentIdOf(archive(converted(named))));
  });

  /**
   * **The measured property ADR 0004 turns on**, at fixture scale: a ZIP's CRC-32
   * is over each member's uncompressed bytes, so three files of three different
   * lengths carrying the same members are one Document. Re-run on the owner's own
   * 34,453,009-byte book in notes/NOTES_2026-09-19.md, where the same three rows
   * hold and the ids are equal.
   */
  it('is the same id for the same book repacked at another compression level', () => {
    const stored = namedEpub();
    const light = namedEpub({ level: 1 });
    const heavy = namedEpub({ level: 9 });
    expect(new Set([stored.length, light.length, heavy.length]).size).toBe(3);
    expect(new Set([sha256Hex(stored), sha256Hex(light), sha256Hex(heavy)]).size).toBe(3);
    expect(new Set([documentIdOf(archive(stored)), documentIdOf(archive(light)), documentIdOf(archive(heavy))]).size).toBe(1);
  });

  /** ADR 0004: "A repacker may emit members in a different order; document order is not part of what makes a book this book." */
  it('is the same id when the members are in a different order', () => {
    expect(documentIdOf(archive(namedEpub({ reverse: true })))).toBe(documentIdOf(archive(namedEpub())));
  });

  /**
   * The case sorting by name alone does not settle. A ZIP may legally hold two
   * members of the same name, and their order would then be whatever the packer
   * did — so the order of two lines of the digest would be, which is the one
   * thing the sort is there to remove. The sort breaks the tie on the contents.
   */
  it('is the same id when two members share a name and are written in either order', () => {
    const entries = [
      { name: 'OEBPS/one.xhtml', data: utf8('the first of two') },
      { name: 'OEBPS/one.xhtml', data: utf8('the second of two') },
    ];
    expect(documentIdOf(archive(zip(entries, { reverse: true })))).toBe(documentIdOf(archive(zip(entries))));
  });

  /**
   * An archive comment is a place tools write their own name. It says nothing
   * about what is in the book, and under the rule this replaced it renamed it.
   */
  it('is not changed by an archive comment', () => {
    expect(documentIdOf(archive(namedEpub({ comment: 'stamped by another tool' })))).toBe(documentIdOf(archive(namedEpub())));
  });

  it('changes when a member is renamed, and when one is added', () => {
    const one = utf8('a chapter');
    const original = documentIdOf(archive(zip([{ name: 'OEBPS/one.xhtml', data: one }])));
    expect(documentIdOf(archive(zip([{ name: 'OEBPS/two.xhtml', data: one }])))).not.toBe(original);
    expect(documentIdOf(archive(zip([{ name: 'OEBPS/one.xhtml', data: one }, { name: 'OEBPS/two.xhtml', data: one }])))).not.toBe(original);
  });

  /**
   * ADR 0004: "Both throw rather than falling back to a whole-file hash, because
   * a silent fallback would mean the same book has two possible ids depending on
   * a code path — which is the one thing an identity may not have." So the
   * assertion is not only that it throws: it is that no id comes back.
   */
  it('refuses a file that is not an archive rather than naming it anyway', () => {
    const notAnArchive = utf8('This is a text file with an epub extension, and it is comfortably longer than a record.');
    expect(() => documentIdOf(archive(notAnArchive))).toThrow(/no end-of-central-directory record/);
  });
});

describe('documentManifest', () => {
  /**
   * The rule itself, in one assertion, which is why `documentManifest` is
   * exported: the version line, the sort, the NUL framing and the decimal
   * numbers are four separate decisions, and watching one hex string change
   * would not say which of them moved.
   *
   * `epub-zip-v1` is written out here rather than imported, so that changing
   * `DOCUMENT_ID_RULE` — which renames every Document in the owner's Library —
   * fails a test instead of passing quietly.
   */
  it('is the version line, then one line per member, sorted by name', () => {
    const one = utf8('one');
    const two = utf8('two');
    const manifest = documentManifest(archive(zip([{ name: 'b.txt', data: two }, { name: 'a.txt', data: one }])));
    expect(new TextDecoder().decode(manifest)).toBe(`epub-zip-v1\na.txt\u0000${crc32(one)}\u00003\nb.txt\u0000${crc32(two)}\u00003\n`);
  });

  /** A NUL sorts below every byte a name can hold, which is what puts a directory's own entry before the entries under it. */
  it('sorts by the bytes of the name, so the order does not depend on a decoder', () => {
    const data = utf8('x');
    const manifest = new TextDecoder().decode(
      documentManifest(archive(zip([{ name: 'OEBPS/b', data }, { name: 'OEBPS/a/b', data }, { name: 'OEBPS/a', data }]))),
    );
    expect(manifest.split('\n').map((line) => line.split('\u0000')[0])).toEqual(['epub-zip-v1', 'OEBPS/a', 'OEBPS/a/b', 'OEBPS/b', '']);
  });
});

describe('asDocumentId', () => {
  it('accepts what documentIdOf produced and refuses everything else', () => {
    expect(asDocumentId(documentIdOf(archive(namedEpub())))).not.toBeNull();
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
  const bytes = namedEpub();

  it('records the Document Id, the format and the secondary identifier together', () => {
    const identity = identifyDocument(archive(bytes), 'epub', readPackageIdentifiers(opf(named)));
    expect(identity).toEqual({
      id: documentIdOf(archive(bytes)),
      format: 'epub',
      publicationId: UUID,
      publicationIdSource: 'unique-identifier',
    });
  });

  it('is still an identity when dc:identifier is absent — the manifest is enough', () => {
    const plain = epub(opf('    <dc:creator>Nobody</dc:creator>'));
    const identity = identifyDocument(archive(plain), 'epub', readPackageIdentifiers(opf('    <dc:creator>Nobody</dc:creator>')));
    expect(identity.publicationId).toBeNull();
    expect(identity.publicationIdSource).toBe('none');
    expect(identity.id).toBe(documentIdOf(archive(plain)));
  });

  it('is still an identity when the package document could not be read at all', () => {
    expect(identifyDocument(archive(bytes), 'epub').publicationIdSource).toBe('none');
    expect(identifyDocument(archive(bytes), 'epub', null).publicationIdSource).toBe('none');
  });

  it('says so when one identifier is declared and nothing names it', () => {
    const text = opf(`    <dc:identifier>${UUID}</dc:identifier>`, '');
    expect(identifyDocument(archive(bytes), 'epub', readPackageIdentifiers(text))).toMatchObject({
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
    expect(identifyDocument(archive(bytes), 'epub', readPackageIdentifiers(text))).toMatchObject({
      publicationId: 'urn:isbn:9780000000001',
      publicationIdSource: 'first-of-several',
    });
  });
});

describe('matchIdentities', () => {
  const identity = (bytes: Uint8Array, text: string) => identifyDocument(archive(bytes), 'epub', readPackageIdentifiers(text));

  it('calls the same members the same Document, definitively', () => {
    const a = identity(namedEpub(), opf(named));
    const b = identity(namedEpub(), opf(named));
    expect(matchIdentities(a, b)).toBe('same-contents');
  });

  /** A repack is the *same* Document now, not a candidate to be confirmed by `dc:identifier`. That is ADR 0004's amendment. */
  it('calls a copy repacked at another compression level the same Document', () => {
    const a = identity(namedEpub(), opf(named));
    const b = identity(namedEpub({ level: 9 }), opf(named));
    expect(matchIdentities(a, b)).toBe('same-contents');
  });

  /** The failure the second identifier is recorded to cover: a tool that rewrote the package document changed the id and kept `dc:identifier`. */
  it('recognises a converted copy through its unambiguous publication identifier', () => {
    const a = identity(namedEpub(), opf(named));
    const b = identity(converted(named), opf(named));
    expect(a.id).not.toBe(b.id);
    expect(matchIdentities(a, b)).toBe('same-publication');
  });

  it('refuses to match on an identifier the Document itself was ambiguous about', () => {
    const several = opf(
      `    <dc:identifier>urn:isbn:9780000000001</dc:identifier>
    <dc:identifier>${UUID}</dc:identifier>`,
      '',
    );
    const a = identity(namedEpub(), several);
    const b = identity(converted(named), several);
    expect(a.publicationId).toBe(b.publicationId);
    expect(matchIdentities(a, b)).toBe('different');
  });

  it('refuses two Documents with no identifier, which would otherwise both be null', () => {
    const none = opf('    <dc:creator>Nobody</dc:creator>');
    const a = identity(namedEpub(), none);
    const b = identity(converted(named), none);
    expect(matchIdentities(a, b)).toBe('different');
  });

  /**
   * ADR 0007 keeps formats pluggable, so the guard is written now and asserted
   * now. The cast is the only way to name a second format before one exists, and
   * it is the point of the test: an EPUB and a PDF that share an ISBN — a book
   * and its own galley proof — are not one Document.
   */
  it('refuses two Documents of different formats that share an identifier', () => {
    const a = identity(namedEpub(), opf(named));
    const b = identity(converted(named), opf(named));
    expect(matchIdentities(a, b)).toBe('same-publication');
    expect(matchIdentities(a, { ...b, format: 'pdf' as DocumentFormat })).toBe('different');
  });
});
