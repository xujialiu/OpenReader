import { describe, expect, it } from 'vitest';
import { LIBRARY_VERSION, parseLibrary, serializeLibrary, type LibraryEntry } from '../../../src/core/document/library';
import { createLocator, readLocator, readingPositionAt } from '../../../src/core/document/position';
import { documentIdOf, type DocumentFormat } from '../../../src/core/document/identity';

/**
 * What a store persists per Document, and what it does with a file it does not
 * fully understand.
 *
 * ADR 0003 is the spec even though no WebDAV is built: a parser rejects a file
 * whose `version` is higher than it knows and leaves it alone, and new
 * information goes in a new file rather than a new field. The tests that matter
 * most here are the ones about a file this build did not write.
 */

const ID = documentIdOf(new TextEncoder().encode('a small book'));
const BLOCK = 'The quick brown fox jumps over the lazy dog. And then it stopped.';

const entry = (over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id: ID,
  format: 'epub',
  publicationId: 'urn:uuid:9f1b2c3d-1111-4000-8000-abcdefabcdef',
  publicationIdSource: 'unique-identifier',
  title: 'A Small Book',
  position: readingPositionAt(createLocator('epub', '/6/2!/4/4'), BLOCK, 0, 43),
  voice: { provider: 'openai-official', voice: 'alloy' },
  stamp: { at: 1_758_240_000_000, device: 'phone' },
  ...over,
});

const reparse = (entries: readonly LibraryEntry[]) => parseLibrary(serializeLibrary(entries));

describe('serializeLibrary', () => {
  it('writes the version on the file and nowhere else', () => {
    const file = JSON.parse(serializeLibrary([entry()]));
    expect(file.version).toBe(LIBRARY_VERSION);
    expect(Object.keys(file)).toEqual(['version', 'entries']);
    expect(Object.keys(file.entries[0])).not.toContain('version');
  });

  it('writes exactly the fields this version knows, in a fixed order, nulls included', () => {
    const file = JSON.parse(serializeLibrary([entry({ position: null, voice: null })]));
    expect(Object.keys(file.entries[0])).toEqual([
      'id',
      'format',
      'publicationId',
      'publicationIdSource',
      'title',
      'position',
      'voice',
      'stamp',
    ]);
    expect(file.entries[0].position).toBeNull();
    expect(file.entries[0].voice).toBeNull();
  });

  it('flattens the opaque locator to its own string', () => {
    const file = JSON.parse(serializeLibrary([entry()]));
    expect(file.entries[0].position).toEqual({
      locator: '/6/2!/4/4',
      anchor: { exact: 'The quick brown fox jumps over the lazy dog', prefix: '', suffix: '. And then it stopped.' },
    });
  });

  it('is canonical: the same entries give the same bytes', () => {
    expect(serializeLibrary([entry()])).toBe(serializeLibrary([entry()]));
  });

  /**
   * A locator built for one format cannot be written into a record that claims
   * another, and this is bad code rather than bad data — the entry came from this
   * app. A loud failure at the moment of writing is the only place it could be
   * noticed at all.
   */
  it('refuses an entry whose position is a locator for a different format', () => {
    const wrong = entry({ position: readingPositionAt(createLocator('pdf' as DocumentFormat, '#page=4'), BLOCK, 0, 43) });
    expect(() => serializeLibrary([wrong])).toThrow(/another format/);
  });
});

describe('parseLibrary, round trip', () => {
  it('reads back what it wrote, identity, position, Voice and Stamp', () => {
    const parsed = reparse([entry()]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.problems).toEqual([]);
    expect(parsed.ignored).toEqual([]);
    expect(parsed.entries).toHaveLength(1);
    const read = parsed.entries[0];
    expect(read).toMatchObject({
      id: ID,
      format: 'epub',
      publicationId: 'urn:uuid:9f1b2c3d-1111-4000-8000-abcdefabcdef',
      publicationIdSource: 'unique-identifier',
      title: 'A Small Book',
      voice: { provider: 'openai-official', voice: 'alloy' },
      stamp: { at: 1_758_240_000_000, device: 'phone' },
    });
    expect(readLocator(read.position!.locator, 'epub')).toBe('/6/2!/4/4');
    expect(read.position!.anchor.exact).toBe('The quick brown fox jumps over the lazy dog');
  });

  it('writes what it read back to the same bytes', () => {
    const text = serializeLibrary([entry(), entry({ id: documentIdOf(new TextEncoder().encode('another')), position: null, voice: null })]);
    const parsed = parseLibrary(text);
    expect(parsed.ok && serializeLibrary(parsed.entries)).toBe(text);
  });

  it('reads an empty Library', () => {
    const parsed = reparse([]);
    expect(parsed.ok && parsed.entries).toEqual([]);
  });
});

/**
 * ADR 0003's first rule. A file written by a newer build stops this one from
 * syncing it until its owner updates, and that is the designed behaviour: a
 * newer writer may have changed what the fields this build *does* recognise
 * mean.
 */
describe('parseLibrary, a file this build must not touch', () => {
  it('rejects a higher version and returns no entries at all', () => {
    const newer = JSON.parse(serializeLibrary([entry()]));
    newer.version = LIBRARY_VERSION + 1;
    const parsed = parseLibrary(JSON.stringify(newer));
    expect(parsed).toEqual({ ok: false, reason: 'newer', version: LIBRARY_VERSION + 1 });
    expect('entries' in parsed).toBe(false);
  });

  it('reads a lower version, because an older file is still a file this build understands', () => {
    // There is no version 0, so this is the shape of the assertion rather than a
    // case that exists yet: what matters is that "lower" is not refused.
    const file = JSON.parse(serializeLibrary([entry()]));
    expect(parseLibrary(JSON.stringify(file)).ok).toBe(true);
  });
});

describe('parseLibrary, a file that is not one', () => {
  it('refuses text that is not JSON', () => {
    expect(parseLibrary('')).toEqual({ ok: false, reason: 'not-json' });
    expect(parseLibrary('{oops}')).toEqual({ ok: false, reason: 'not-json' });
  });

  it('refuses JSON that is not a Library', () => {
    expect(parseLibrary('[]')).toEqual({ ok: false, reason: 'not-a-library' });
    expect(parseLibrary('null')).toEqual({ ok: false, reason: 'not-a-library' });
    expect(parseLibrary('{"entries":[]}')).toEqual({ ok: false, reason: 'not-a-library' });
    expect(parseLibrary('{"version":1}')).toEqual({ ok: false, reason: 'not-a-library' });
    expect(parseLibrary('{"version":"1","entries":[]}')).toEqual({ ok: false, reason: 'not-a-library' });
    expect(parseLibrary('{"version":1.5,"entries":[]}')).toEqual({ ok: false, reason: 'not-a-library' });
    expect(parseLibrary('{"version":0,"entries":[]}')).toEqual({ ok: false, reason: 'not-a-library' });
    expect(parseLibrary('{"version":1,"entries":{}}')).toEqual({ ok: false, reason: 'not-a-library' });
  });
});

/**
 * ADR 0003's third finding: the plugin's positions file is serialised canonically
 * to exactly four fields per entry, so an older build silently strips anything
 * added to an entry — for every machine, with nothing reported. Silent stripping
 * is the defect, so every key this build does not know is named.
 */
describe('parseLibrary, keys this build does not know', () => {
  it('names them by path rather than dropping them in silence', () => {
    const file = JSON.parse(serializeLibrary([entry()]));
    file.catalogue = [];
    file.entries[0].readingSpeed = 2;
    file.entries[0].position.chapter = 4;
    file.entries[0].position.anchor.language = 'en';
    file.entries[0].voice.pitch = 1;
    file.entries[0].stamp.timezone = 'UTC';
    const parsed = parseLibrary(JSON.stringify(file));
    expect(parsed.ok && parsed.ignored).toEqual([
      'catalogue',
      'entries[0].readingSpeed',
      'entries[0].position.chapter',
      'entries[0].position.anchor.language',
      'entries[0].voice.pitch',
      'entries[0].stamp.timezone',
    ]);
  });

  it('still reads everything it does know from such a file', () => {
    const file = JSON.parse(serializeLibrary([entry()]));
    file.entries[0].readingSpeed = 2;
    const parsed = parseLibrary(JSON.stringify(file));
    expect(parsed.ok && parsed.entries[0].title).toBe('A Small Book');
  });
});

/**
 * Defensive, and asymmetrically so: a bad file costs everything, a bad entry
 * costs that entry, a bad field costs that field. One corrupt entry must not
 * take the owner's other Reading Positions with it.
 */
describe('parseLibrary, entries it cannot fully read', () => {
  const withEntries = (...raw: unknown[]) => parseLibrary(JSON.stringify({ version: 1, entries: raw }));
  const sound = () => JSON.parse(serializeLibrary([entry()])).entries[0];

  it('drops an entry that is not an object, and keeps the ones around it', () => {
    const parsed = withEntries(sound(), null, 'nonsense', sound());
    expect(parsed.ok && parsed.entries).toHaveLength(2);
    expect(parsed.ok && parsed.problems).toEqual([
      { at: 1, id: null, dropped: 'entry', why: 'not-an-object' },
      { at: 2, id: null, dropped: 'entry', why: 'not-an-object' },
    ]);
  });

  it('drops an entry with no usable Document Id, because nothing else about it can be looked up', () => {
    const parsed = withEntries({ ...sound(), id: 'book-4' });
    expect(parsed.ok && parsed.entries).toEqual([]);
    expect(parsed.ok && parsed.problems).toEqual([{ at: 0, id: null, dropped: 'entry', why: 'id' }]);
  });

  /**
   * A format this build cannot read is a Document a later build added — a PDF
   * (ADR 0007). The entry goes because nothing here could act on it, and it is
   * reported because writing the file back without it is how it is destroyed.
   */
  it('drops an entry in a format it cannot read, and reports it by Document Id', () => {
    const parsed = withEntries({ ...sound(), format: 'pdf' });
    expect(parsed.ok && parsed.entries).toEqual([]);
    expect(parsed.ok && parsed.problems).toEqual([{ at: 0, id: ID, dropped: 'entry', why: 'format' }]);
  });

  it('keeps an entry whose title is unreadable, because a title is not worth a Reading Position', () => {
    const parsed = withEntries({ ...sound(), title: 42 });
    expect(parsed.ok && parsed.entries[0]).toMatchObject({ id: ID, title: '' });
    expect(parsed.ok && parsed.entries[0].position).not.toBeNull();
    expect(parsed.ok && parsed.problems).toEqual([{ at: 0, id: ID, dropped: 'title', why: 'malformed' }]);
  });

  it('keeps an entry whose Voice is unreadable, and lets it fall back to the global default', () => {
    for (const voice of [{}, { provider: 'openai-official' }, { provider: '', voice: 'alloy' }, 'alloy']) {
      const parsed = withEntries({ ...sound(), voice });
      expect(parsed.ok && parsed.entries[0].voice).toBeNull();
      expect(parsed.ok && parsed.problems).toEqual([{ at: 0, id: ID, dropped: 'voice', why: 'malformed' }]);
    }
  });

  it('accepts a Voice naming a provider this build has never heard of, rather than losing the entry', () => {
    const parsed = withEntries({ ...sound(), voice: { provider: 'something-later', voice: 'unknown' } });
    expect(parsed.ok && parsed.entries[0].voice).toEqual({ provider: 'something-later', voice: 'unknown' });
    expect(parsed.ok && parsed.problems).toEqual([]);
  });

  /**
   * A Stamp decides which of two copies of an entry wins, so an entry whose own
   * Stamp could not be read has to lose that comparison rather than win it by
   * accident of when it was parsed.
   */
  it('gives an entry with no readable Stamp the oldest possible one', () => {
    const parsed = withEntries({ ...sound(), stamp: { at: 'yesterday', device: 'phone' } });
    expect(parsed.ok && parsed.entries[0].stamp).toEqual({ at: 0, device: '' });
    expect(parsed.ok && parsed.problems).toEqual([{ at: 0, id: ID, dropped: 'stamp', why: 'malformed' }]);
  });

  it('accepts an entry with no position, which is a Document the owner has not started', () => {
    const parsed = withEntries({ ...sound(), position: null });
    expect(parsed.ok && parsed.entries[0].position).toBeNull();
    expect(parsed.ok && parsed.problems).toEqual([]);
  });

  /**
   * ADR 0008 exists because a bare locator resolves silently to the wrong node.
   * A stored position with no quotation to check it against is therefore refused
   * rather than resolved unverified.
   */
  it('refuses a position with no text anchor', () => {
    for (const position of [{ locator: '/6/2!/4/4' }, { locator: '/6/2!/4/4', anchor: {} }, { locator: '/6/2!/4/4', anchor: { exact: '' } }]) {
      const parsed = withEntries({ ...sound(), position });
      expect(parsed.ok && parsed.entries[0].position).toBeNull();
      expect(parsed.ok && parsed.problems).toEqual([{ at: 0, id: ID, dropped: 'position', why: 'malformed' }]);
    }
  });

  it('refuses a position with no locator, and keeps the rest of the entry', () => {
    const parsed = withEntries({ ...sound(), position: { locator: '', anchor: { exact: 'something' } } });
    expect(parsed.ok && parsed.entries[0]).toMatchObject({ id: ID, title: 'A Small Book', position: null });
    expect(parsed.ok && parsed.problems).toEqual([{ at: 0, id: ID, dropped: 'position', why: 'malformed' }]);
  });

  it('reads a position whose anchor has no context, which is what an anchor at the end of a Block looks like', () => {
    const parsed = withEntries({ ...sound(), position: { locator: '/6/2!/4/4', anchor: { exact: 'something' } } });
    expect(parsed.ok && parsed.entries[0].position!.anchor).toEqual({ exact: 'something', prefix: '', suffix: '' });
  });

  it('rebuilds the locator in the entry’s own format, which is the only format it could be in', () => {
    const parsed = withEntries(sound());
    const position = parsed.ok ? parsed.entries[0].position! : null;
    expect(position && readLocator(position.locator, 'epub')).toBe('/6/2!/4/4');
    expect(position && readLocator(position.locator, 'pdf' as DocumentFormat)).toBeNull();
  });

  it('falls back to no publication identifier when the file’s is unusable', () => {
    const parsed = withEntries({ ...sound(), publicationId: 42, publicationIdSource: 'guessed' });
    expect(parsed.ok && parsed.entries[0]).toMatchObject({ publicationId: null, publicationIdSource: 'none' });
  });
});
