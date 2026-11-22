import { expect, it } from 'vitest';

import { segmentDocument } from '../../src/app/segment';
import { createLocator, readingPlaceAt } from '../../src/core/document';
import { resolveResume } from '../../src/renderer/cursor';
import { standInPage } from './stand-in-page';

function pageOf(markup: string) {
  const page = standInPage();
  const section = page.addSection(0, markup);
  const elements = Array.from(section.document.getElementsByTagName('*'));
  // One element gets one address, even if the walker splits its text into runs.
  page.rendition.getContents()[0].cfiFromNode = (node: unknown) =>
    'epubcfi(/6/2!/4/' + 2 * (1 + elements.indexOf(node)) + ')';
  page.sweep();
  const blocks = page.blocks(section);
  const sentences = segmentDocument(blocks, 'en');
  function resume(text: string, quote: string, cfi = blocks[0].cfi) {
    const start = text.indexOf(quote);
    const place = readingPlaceAt(createLocator('epub', cfi), text, start, start + quote.length);
    return resolveResume(place, sentences, blocks, { spine: 1, reported: new Set([0]) });
  }
  return { blocks, sentences, resume };
}

it.each([
  '<p>First sentence. <img style="display:block"/> Second sentence.</p>',
  '<div>First sentence. <hr style="display:block"/> Second sentence.</div>',
  '<ul><li>First sentence. <ul><li>Inner.</li></ul> Second sentence.</li></ul>',
  '<p>First sentence. <img style="float:left"/> Second sentence.</p>',
])('returns to the sentence after the child in %s (#194)', markup => {
  const { blocks, sentences, resume } = pageOf(markup);
  const last = blocks[blocks.length - 1];
  const quote = 'Second sentence.';
  const utterance = sentences.findIndex(sentence => sentence.text === quote);
  expect(utterance).toBeGreaterThan(0);
  expect(resume(last.text, quote, last.cfi)).toMatchObject({ outcome: 'resumed', utterance, moved: null });
  expect(resume(last.text, quote, 'epubcfi(/6/2!/4/998)')).toMatchObject({ outcome: 'resumed', utterance, moved: 'locator-did-not-resolve' });
});

it('declines equally plausible Blocks of one element', () => {
  const { resume } = pageOf('<div>Same sentence.<hr style="display:block"/>Same sentence.</div>');
  expect(resume('Same sentence.', 'Same sentence.')).toMatchObject({ outcome: 'lost', why: 'ambiguous' });
});

it('resolves desktop and phone quotations at their spoken offsets (#337)', () => {
  const { resume, sentences } = pageOf('<p>First <img alt="a very long formula name"/> ends. Let <img alt="fallback" aria-label="x sub i"/> be given. Next.</p>');
  expect(sentences.map(sentence => sentence.text)).toEqual(['First  ends.', 'Let  be given.', 'Next.']);
  const desktop = 'First a very long formula name ends. Let x sub i be given. Next.';
  for (const [i, quote] of ['First a very long formula name ends.', 'Let x sub i be given.', 'Next.'].entries()) {
    expect(resume(desktop, quote)).toMatchObject({ outcome: 'resumed', utterance: i, agreement: 'exact' });
  }
  expect(resume('First  ends. Let  be given. Next.', 'Let  be given.')).toMatchObject({ outcome: 'resumed', utterance: 1, agreement: 'exact' });
});

it('keeps repeated formula sentences distinguishable by the image and refuses indistinguishable copies', () => {
  const { resume } = pageOf('<p>Let <img alt="x sub i"/> be given. Let <img alt="y sub j"/> be given.</p>');
  const quote = 'Let y sub j be given.';
  expect(resume(quote, quote)).toMatchObject({ outcome: 'resumed', utterance: 1 });
  expect(resume('Let  be given.', 'Let  be given.')).toMatchObject({ outcome: 'lost', why: 'ambiguous' });
});

it('maps a quotation starting with an image onto the following spoken words', () => {
  const { resume, sentences } = pageOf('<p>Done. <img alt="alpha squared"/> belongs here.</p>');
  expect(sentences[1].text).toBe('belongs here.');
  const quote = 'alpha squared belongs here.';
  expect(resume('Done. ' + quote, quote)).toMatchObject({ outcome: 'resumed', utterance: 1 });
});

it('records accessible labels and prose, omitting filename-only descriptions', () => {
  const { blocks } = pageOf('<p>A<img alt="dir/figure.svg"/>B<img alt="x.png"/>C<img aria-label="Y" alt="Z"/>D<img alt="x / y"/>E</p>');
  expect(blocks[0].images).toEqual([{ at: 3, text: 'Y' }, { at: 4, text: 'x / y' }]);
  expect(blocks[0].text).toBe('ABCDE');
});
