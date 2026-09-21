import { describe, expect, it } from 'vitest';
import {
  createLocator,
  findAnchor,
  readLocator,
  readingPlaceAt,
  resolveReadingPosition,
  sameLocator,
  type Locator,
  type Place,
  type PlaceReader,
} from '../../../src/core/document/position';
import { createTextAnchor } from '../../../src/core/document/anchor';
import type { DocumentFormat } from '../../../src/core/document/identity';

/**
 * ADR 0008's resolution order, and above all the case the whole design exists
 * for: a locator that resolves to text the anchor does not match.
 *
 * "Issues #3 and #4 showed the failure mode is not an error but a silent
 * resolution to the wrong node. A bookmark that quietly lands three paragraphs
 * away is worse than no bookmark."
 */

/** A Block as the renderer reports one: its element CFI and its own verbatim text. */
interface Block {
  cfi: string;
  text: string;
}

const CHAPTER: Block[] = [
  { cfi: '/6/2!/4/2', text: 'Chapter one begins here.' },
  { cfi: '/6/2!/4/4', text: 'The quick brown fox jumps over the lazy dog. And then it stopped.' },
  { cfi: '/6/4!/4/2', text: 'Chapter two begins somewhere else, quite differently.' },
];

const FOX = 'The quick brown fox jumps over the lazy dog.';

/**
 * A document the resolver can read. `resolved` is what each CFI resolves to,
 * which is deliberately separate from `blocks` — the two disagreeing is exactly
 * what a wrong CFI looks like, and a fake where they cannot disagree could not
 * exercise the path that matters.
 */
function documentOf(blocks: readonly Block[], resolved: Record<string, string>, onSearch: () => void = () => {}): PlaceReader {
  return {
    textAt: (locator) => {
      const cfi = readLocator(locator, 'epub');
      return cfi !== null && cfi in resolved ? resolved[cfi] : null;
    },
    places: () => {
      onSearch();
      return blocks.map((block) => ({ locator: createLocator('epub', block.cfi), text: block.text }));
    },
  };
}

const asResolved = (blocks: readonly Block[]): Record<string, string> => Object.fromEntries(blocks.map((block) => [block.cfi, block.text]));

/** The position the owner would have left behind after the fox sentence was spoken. */
const foxPosition = () => readingPlaceAt(createLocator('epub', '/6/2!/4/4'), CHAPTER[1].text, 0, FOX.length);

describe('the locator is opaque (ADR 0007)', () => {
  it('gives its string only to a renderer that names the format it speaks', () => {
    const locator = createLocator('epub', '/6/4!/4/2');
    expect(readLocator(locator, 'epub')).toBe('/6/4!/4/2');
    expect(readLocator(locator, 'pdf' as DocumentFormat)).toBeNull();
  });

  /**
   * The properties are keyed by symbols the module does not export, so nothing
   * outside it can name them. One visible consequence is worth pinning, because
   * it is a trap: `JSON.stringify` skips symbol keys, so a locator written
   * straight to a file is `{}` and says nothing about having lost anything.
   * `serializeLibrary` is the only thing that should write one.
   */
  it('carries nothing a caller can read by hand', () => {
    const locator = createLocator('epub', '/6/4!/4/2');
    expect(Object.keys(locator)).toEqual([]);
    expect(JSON.stringify(locator)).toBe('{}');
  });

  /**
   * The claim ADR 0007 actually makes is a compile-time one, so it is asserted at
   * compile time: `tsc --noEmit` covers `test/`, and a `@ts-expect-error` that
   * stops being an error fails the typecheck. If either of these ever compiles,
   * the locator has stopped being opaque.
   */
  it('cannot be built or read by hand', () => {
    // @ts-expect-error a plain object is not a Locator, however right it looks
    const forged: Locator = { format: 'epub', value: '/6/4!/4/2' };
    expect(forged).toBeDefined();
    const locator = createLocator('epub', '/6/4!/4/2');
    // @ts-expect-error and a real one has no property anything outside the module can name
    expect(locator.value).toBeUndefined();
  });

  it('compares by format and place', () => {
    expect(sameLocator(createLocator('epub', '/6/2'), createLocator('epub', '/6/2'))).toBe(true);
    expect(sameLocator(createLocator('epub', '/6/2'), createLocator('epub', '/6/4'))).toBe(false);
    expect(sameLocator(createLocator('epub', '/6/2'), createLocator('pdf' as DocumentFormat, '/6/2'))).toBe(false);
  });
});

describe('readingPlaceAt', () => {
  it('builds both halves from one call, so they describe the same place', () => {
    const position = foxPosition();
    expect(readLocator(position.locator, 'epub')).toBe('/6/2!/4/4');
    expect(position.anchor.exact).toBe(FOX);
    expect(position.anchor.suffix).toBe(' And then it stopped.');
  });
});

describe('resolveReadingPosition, the ordinary resume', () => {
  it('uses the locator and verifies the text found there', () => {
    const resolution = resolveReadingPosition(foxPosition(), documentOf(CHAPTER, asResolved(CHAPTER)));
    expect(resolution).toMatchObject({ outcome: 'verified', start: 0, end: FOX.length, agreement: 'exact', ambiguous: false });
    expect(resolution.outcome === 'verified' && readLocator(resolution.locator, 'epub')).toBe('/6/2!/4/4');
  });

  /**
   * The search walks the whole document, so it must not happen on every resume.
   * This is the assertion that keeps it off the ordinary path.
   */
  it('does not look at the rest of the document at all', () => {
    let searched = 0;
    resolveReadingPosition(foxPosition(), documentOf(CHAPTER, asResolved(CHAPTER), () => searched++));
    expect(searched).toBe(0);
  });

  it('verifies a document whose whitespace has moved, and reports that it was the words that matched', () => {
    const reflowed = CHAPTER.map((block, i) => (i === 1 ? { ...block, text: 'The quick brown fox jumps\n   over the lazy dog. And then it stopped.' } : block));
    const resolution = resolveReadingPosition(foxPosition(), documentOf(reflowed, asResolved(reflowed)));
    expect(resolution).toMatchObject({ outcome: 'verified', agreement: 'aligned' });
  });
});

/**
 * The case the design exists for. The locator resolves — no error, no throw —
 * and the text it resolves to is not the text the owner stopped at.
 */
describe('resolveReadingPosition, when the locator resolves to the wrong text', () => {
  it('refuses the locator and recovers the place from the anchor', () => {
    // The Document was re-saved and everything moved down one Block: the stored
    // CFI now resolves, to the paragraph after the one it named.
    const moved: Block[] = [
      { cfi: '/6/2!/4/2', text: 'A note from the publisher.' },
      { cfi: '/6/2!/4/4', text: 'Chapter one begins here.' },
      { cfi: '/6/2!/4/6', text: CHAPTER[1].text },
    ];
    const resolution = resolveReadingPosition(foxPosition(), documentOf(moved, asResolved(moved)));
    expect(resolution).toMatchObject({ outcome: 'recovered', because: 'text-disagreed', start: 0, end: FOX.length, agreement: 'exact' });
    expect(resolution.outcome === 'recovered' && readLocator(resolution.locator, 'epub')).toBe('/6/2!/4/6');
  });

  it('reports a recovered locator that differs from the stored one, so a caller can heal the stored position', () => {
    const moved: Block[] = [{ cfi: '/6/2!/4/9', text: CHAPTER[1].text }];
    const position = foxPosition();
    const resolution = resolveReadingPosition(position, documentOf(moved, { '/6/2!/4/4': 'Something else entirely.' }));
    expect(resolution.outcome).toBe('recovered');
    expect(resolution.outcome === 'recovered' && sameLocator(resolution.locator, position.locator)).toBe(false);
  });

  it('does not report a wrong place as a verified one', () => {
    const resolution = resolveReadingPosition(foxPosition(), documentOf(CHAPTER, { '/6/2!/4/4': CHAPTER[2].text }));
    expect(resolution.outcome).not.toBe('verified');
  });
});

describe('resolveReadingPosition, when the locator does not resolve at all', () => {
  it('searches for the anchor and says which problem it was', () => {
    const resolution = resolveReadingPosition(foxPosition(), documentOf(CHAPTER, {}));
    expect(resolution).toMatchObject({ outcome: 'recovered', because: 'locator-did-not-resolve' });
    expect(resolution.outcome === 'recovered' && readLocator(resolution.locator, 'epub')).toBe('/6/2!/4/4');
  });

  /**
   * ADR 0006's consequence, which ADR 0008 exists to answer: a position may never
   * identify its place by counting Utterances, because this app and the desktop
   * plugin do not split text the same way. Inserting Blocks in front of the
   * anchor must therefore change nothing, and reordering the search must change
   * nothing either.
   */
  it('finds the same place however many Blocks come before it, and in whatever order they arrive', () => {
    const padded: Block[] = [
      { cfi: '/6/1!/4/2', text: 'Front matter. A dedication. An epigraph.' },
      { cfi: '/6/1!/4/4', text: 'A table of contents nobody reads.' },
      ...CHAPTER,
    ];
    const forwards = resolveReadingPosition(foxPosition(), documentOf(padded, {}));
    const backwards = resolveReadingPosition(foxPosition(), documentOf([...padded].reverse(), {}));
    expect(forwards.outcome === 'recovered' && readLocator(forwards.locator, 'epub')).toBe('/6/2!/4/4');
    expect(backwards.outcome === 'recovered' && readLocator(backwards.locator, 'epub')).toBe('/6/2!/4/4');
  });
});

/**
 * The refusals. There is no fourth outcome and no best guess: resuming at the
 * start of a Document is a disappointment the owner can see and explain, and
 * resuming three paragraphs out is the thing this project was built to prevent.
 */
describe('resolveReadingPosition, when it cannot name a place', () => {
  it('is unresolved when the passage is nowhere in the Document', () => {
    const position = readingPlaceAt(createLocator('epub', '/6/9!/4/2'), 'A passage that this Document no longer contains anywhere.', 0, 57);
    expect(resolveReadingPosition(position, documentOf(CHAPTER, {}))).toEqual({
      outcome: 'unresolved',
      because: 'locator-did-not-resolve',
      search: 'not-found',
    });
  });

  it('is unresolved, not first-of-two, when two places match equally well', () => {
    const twins: Block[] = [
      { cfi: '/6/2!/4/2', text: 'He said nothing.' },
      { cfi: '/6/8!/4/2', text: 'He said nothing.' },
    ];
    const position = { locator: createLocator('epub', '/6/2!/4/2'), anchor: { exact: 'He said nothing.', prefix: '', suffix: '' } };
    expect(resolveReadingPosition(position, documentOf(twins, {}))).toEqual({
      outcome: 'unresolved',
      because: 'locator-did-not-resolve',
      search: 'ambiguous',
    });
  });

  it('uses the stored context to resolve two places that would otherwise tie', () => {
    const twins: Block[] = [
      { cfi: '/6/2!/4/2', text: 'Before the storm. He said nothing. The rain began.' },
      { cfi: '/6/8!/4/2', text: 'After the storm. He said nothing. The sun came out.' },
    ];
    const position = readingPlaceAt(createLocator('epub', '/6/8!/4/2'), twins[1].text, 17, 33);
    const resolution = resolveReadingPosition(position, documentOf(twins, {}));
    expect(resolution.outcome).toBe('recovered');
    expect(resolution.outcome === 'recovered' && readLocator(resolution.locator, 'epub')).toBe('/6/8!/4/2');
  });

  /** A scene break is an Utterance and is not Speakable, so a search for it can only ever be a character search. The reason it failed is worth reporting as its own. */
  it('says when the quotation had no words to search for', () => {
    const text = 'One. * * * Two.';
    const position = { locator: createLocator('epub', '/6/2!/4/2'), anchor: createTextAnchor(text, 5, 10) };
    expect(resolveReadingPosition(position, documentOf([{ cfi: '/6/2!/4/4', text: 'One. *** Two.' }], {}))).toEqual({
      outcome: 'unresolved',
      because: 'locator-did-not-resolve',
      search: 'anchor-not-matchable',
    });
  });

  it('distinguishes the two ways the locator let it down', () => {
    const gone = readingPlaceAt(createLocator('epub', '/6/9!/4/2'), 'A passage that this Document no longer contains anywhere.', 0, 57);
    expect(resolveReadingPosition(gone, documentOf(CHAPTER, {}))).toMatchObject({ because: 'locator-did-not-resolve' });
    expect(resolveReadingPosition(gone, documentOf(CHAPTER, { '/6/9!/4/2': 'Something else.' }))).toMatchObject({ because: 'text-disagreed' });
  });
});

describe('findAnchor', () => {
  const places = (blocks: readonly Block[]): Place[] => blocks.map((block) => ({ locator: createLocator('epub', block.cfi), text: block.text }));

  it('returns the best place and the evidence for it', () => {
    const found = findAnchor(foxPosition().anchor, places(CHAPTER));
    expect(readLocator(found!.place.locator, 'epub')).toBe('/6/2!/4/4');
    expect(found!.match).toMatchObject({ agreement: 'exact', matched: 1 });
    expect(found!.ambiguous).toBe(false);
  });

  it('prefers the exact place over a place that only nearly matches', () => {
    const near: Block[] = [
      { cfi: '/6/1!/4/2', text: 'The quick brown fox leapt over the sleepy dog.' },
      { cfi: '/6/2!/4/4', text: CHAPTER[1].text },
    ];
    expect(readLocator(findAnchor(foxPosition().anchor, places(near))!.place.locator, 'epub')).toBe('/6/2!/4/4');
  });

  it('finds nothing rather than something when no place matches', () => {
    expect(findAnchor(foxPosition().anchor, places([CHAPTER[0], CHAPTER[2]]))).toBeNull();
  });

  it('finds nothing in an empty document', () => {
    expect(findAnchor(foxPosition().anchor, [])).toBeNull();
  });
});
