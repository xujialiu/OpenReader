import { describe, expect, it } from 'vitest';

import type { Block } from '../../src/core/segmenter';
import {
  carryUtterance,
  documentLanguage,
  firstUtteranceOfSection,
  outOfTextSentence,
  samePrefix,
  segmentDocument,
} from '../../src/app/segment';

/**
 * The splitter is bound here and nowhere else (ADR 0006), and the app segments
 * the document again every time epub.js renders a section it has not seen. Both
 * halves of that are reachable from Node, and the second is the one that can go
 * silently wrong: an Utterance is identified to the engine by its index.
 */

const blocks = (...texts: string[]): Block[] => texts.map((text) => ({ text }));

describe('segmentDocument', () => {
  it('splits Blocks into one Utterance per sentence, with upstream sentencex bound', () => {
    const found = segmentDocument(blocks('One. Two. Three.'), 'en');
    expect(found.map((utterance) => utterance.text)).toEqual(['One.', 'Two.', 'Three.']);
  });

  it('keeps each Utterance pointing back at the Block it came from', () => {
    const found = segmentDocument(blocks('First paragraph.', 'Second paragraph.'), 'en');
    expect(found.map((utterance) => utterance.spans.map((span) => span.block))).toEqual([[0], [1]]);
  });

  it('marks text with no letter or digit in it as not Speakable, so it is never sent to a Provider', () => {
    const found = segmentDocument(blocks('* * *'), 'en');
    expect(found).toHaveLength(1);
    expect(found[0].speakable).toBe(false);
  });
});

describe('documentLanguage', () => {
  it('uses the language the document declares', () => {
    expect(documentLanguage('fr')).toEqual({ language: 'fr', declared: true });
  });

  it('falls back to English and says the document declared none, rather than guessing from the text', () => {
    expect(documentLanguage(undefined)).toEqual({ language: 'en', declared: false });
    expect(documentLanguage('   ')).toEqual({ language: 'en', declared: false });
    expect(documentLanguage(null)).toEqual({ language: 'en', declared: false });
  });
});

describe('samePrefix', () => {
  const first = segmentDocument(blocks('One. Two.'), 'en');
  const appended = segmentDocument(blocks('One. Two.', 'Three.'), 'en');
  const prepended = segmentDocument(blocks('Nought.', 'One. Two.'), 'en');

  it('accepts a longer list that starts with the same Utterances — a section rendered after the one being read', () => {
    expect(samePrefix(first, appended)).toBe(true);
  });

  it('refuses a list that renumbers what the engine is holding — a section rendered out of order', () => {
    expect(samePrefix(first, prepended)).toBe(false);
  });

  it('refuses a shorter list, which cannot contain what is being read', () => {
    expect(samePrefix(appended, first)).toBe(false);
  });

  it('accepts an unchanged list, which is what a re-rendered section produces', () => {
    expect(samePrefix(first, segmentDocument(blocks('One. Two.'), 'en'))).toBe(true);
  });

  it('compares the text rather than the objects, because the list is built again each time', () => {
    expect(samePrefix(first, first.map((utterance) => ({ ...utterance })))).toBe(true);
  });
});

/**
 * The sentence the reading is on, found again after a renumbering (#46).
 *
 * Sections report out of reading order — measured on 2026-09-23, a Contents jump
 * reported sections 1 and 2, then 5 and 6, then 3 and 4 above them — and every
 * section reported above the reading shifts the index of every later Utterance.
 * What does not shift is the sentence itself: the Block it starts in, whose id is
 * its section and its place there, where in that Block it starts, and its text.
 */
describe('carryUtterance', () => {
  /** A section's Blocks as the renderer reports them, with the ids `highlighter.ts` gives them. */
  const section = (index: number, ...texts: string[]) =>
    texts.map((text, i) => ({ id: `${index}.${i}`, text, section: `s${index}.xhtml`, sectionIndex: index, role: 'paragraph' as const }));
  const segmented = (...sections: ReturnType<typeof section>[]) => {
    const blocks = sections.flat();
    return { utterances: segmentDocument(blocks, 'en'), blocks };
  };

  const one = section(1, 'Section one opens. It goes on.');
  const two = section(2, 'Section two is short.');
  const five = section(5, 'Chapter five.', 'The reading is on this sentence. And then this one.');
  const six = section(6, 'Chapter six follows it.');

  const before = segmented(one, two, five, six);
  const at = before.utterances.findIndex((utterance) => utterance.text === 'The reading is on this sentence.');

  it('finds the sentence after a section reports above it, at its new index', () => {
    const three = section(3, 'Section three arrives late. With two sentences.');
    const after = segmented(one, two, three, five, six);
    const found = carryUtterance(at, before, after);
    expect(found).toBe(at + 2);
    expect(after.utterances[found!].text).toBe('The reading is on this sentence.');
  });

  it('finds it at the same index when the section reports below it', () => {
    const seven = section(7, 'Section seven, after everything.');
    expect(carryUtterance(at, before, segmented(one, two, five, six, seven))).toBe(at);
  });

  it('does not find it when its own section reported different text', () => {
    // The one case where the sentence the reading was on is not in the document
    // any more, and saying so is all that is left (philosophy rule 1).
    const rewritten = section(5, 'Chapter five.', 'The reading was on a sentence that is gone now.');
    expect(carryUtterance(at, before, segmented(one, two, rewritten, six))).toBeNull();
  });

  it('tells a repeated sentence from its twin by the Block it starts in', () => {
    // The same heading in two chapters is two sentences, and the text alone would
    // carry the reading to the wrong one.
    const repeated = segmented(section(1, 'Interlude.'), section(4, 'Interlude.'));
    const later = repeated.utterances.length - 1;
    const after = segmented(section(1, 'Interlude.'), section(2, 'Something in between.'), section(4, 'Interlude.'));
    expect(carryUtterance(later, repeated, after)).toBe(2);
    expect(carryUtterance(0, repeated, after)).toBe(0);
  });

  it('tells a sentence said twice in one Block from its twin by where it starts', () => {
    const twice = segmented(section(5, 'Yes. He left. Yes.'));
    expect(twice.utterances.map((utterance) => utterance.text)).toEqual(['Yes.', 'He left.', 'Yes.']);
    const after = segmented(section(3, 'A section above.'), section(5, 'Yes. He left. Yes.'));
    expect(carryUtterance(2, twice, after)).toBe(3);
    expect(carryUtterance(0, twice, after)).toBe(1);
  });

  it('finds a sentence the repair layer welded across two Blocks by where it starts', () => {
    // `rejoin.ts` puts back a sentence the markup cut in two within a section; its
    // identity is the Block it starts in, as a Reading Position's is (ADR 0008).
    const cut = section(5, 'The door closed', 'behind him at last.');
    const was = segmented(one, cut);
    expect(was.utterances.map((utterance) => utterance.spans.length)).toContain(2);
    const welded = was.utterances.findIndex((utterance) => utterance.spans.length === 2);
    const now = segmented(one, two, cut);
    expect(now.utterances[carryUtterance(welded, was, now)!].text).toBe(was.utterances[welded].text);
  });

  it('has nothing to carry for an index the first list does not have', () => {
    expect(carryUtterance(before.utterances.length, before, before)).toBeNull();
    expect(carryUtterance(-1, before, before)).toBeNull();
  });
});

/**
 * The second half of a contents tap (ADR 0020).
 *
 * `goToSection` moves the page; the reading can only follow once that section has
 * reported its Blocks, and this is the index it follows to. Getting it wrong means
 * tapping a chapter and being read a different one, which is the confidently wrong
 * answer ADR 0020 calls the expensive defect.
 */
describe('firstUtteranceOfSection', () => {
  /** Two Blocks per section, as `blocks.ts` concatenates them: by spine index, in reading order. */
  const sectioned = [
    { text: 'Cover art.', sectionIndex: 0 },
    { text: 'Chapter one begins. It runs on.', sectionIndex: 3 },
    { text: 'Chapter two begins.', sectionIndex: 4 },
  ];
  const utterances = segmentDocument(sectioned, 'en');

  it('finds the first Utterance of the section asked for, not the first of the document', () => {
    expect(utterances.map((one) => one.text)).toEqual([
      'Cover art.',
      'Chapter one begins.',
      'It runs on.',
      'Chapter two begins.',
    ]);
    expect(firstUtteranceOfSection(utterances, sectioned, 0)).toBe(0);
    expect(firstUtteranceOfSection(utterances, sectioned, 3)).toBe(1);
    expect(firstUtteranceOfSection(utterances, sectioned, 4)).toBe(3);
  });

  it('answers null for a section that has no text, which is an ordinary destination', () => {
    // A volume's title page is a real row in the contents and carries nothing to
    // read; the owner's book has thirteen of them. The page still moves there.
    expect(firstUtteranceOfSection(utterances, sectioned, 1)).toBeNull();
    expect(firstUtteranceOfSection([], sectioned, 3)).toBeNull();
  });

  /**
   * **The invariant this function's `spans[0]` rests on, asserted where it is
   * relied on.** The 2026-09-20 01:22 mutation sweep found that reading `spans[0]`
   * rather than the last span is unobservable, and recorded the reason as an
   * argument: `rejoin.ts` refuses to weld two Blocks from different sections, so
   * every span of an Utterance carries the same section. That argument was left
   * standing on a test in another directory, about a **different** field — the
   * href — and on nothing at all at this call site, which reads the spine index.
   *
   * The case below is the only one where the two spellings could disagree: a Block
   * that ends mid-sentence at the end of one section and a Block that continues it
   * at the start of the next. Welded, that Utterance would begin in section 3 and
   * end in section 4, and `firstUtteranceOfSection(4)` would answer with an
   * Utterance whose text starts a section earlier — a chapter tap landing on the
   * end of the previous chapter, which is the silent landing ADR 0008 is about.
   */
  it('produces no Utterance that begins in one section and ends in another', () => {
    const straddling = [
      { text: 'and the door closed behind', section: 'ch1.xhtml', sectionIndex: 3, role: 'paragraph' as const },
      { text: 'him, or so he thought.', section: 'ch2.xhtml', sectionIndex: 4, role: 'paragraph' as const },
    ];
    // The weld is real and it is the section that stops it: the same two Blocks in
    // one section become one Utterance, so this is not a case sentencex refuses
    // anyway.
    const welded = segmentDocument(
      straddling.map((block) => ({ ...block, section: 'ch1.xhtml', sectionIndex: 3 })),
      'en',
    );
    expect(welded.map((one) => one.spans.map((span) => span.block))).toEqual([[0, 1]]);

    const found = segmentDocument(straddling, 'en');
    for (const utterance of found) {
      const sections = utterance.spans.map((span) => straddling[span.block].sectionIndex);
      expect(new Set(sections).size, utterance.text).toBe(1);
    }
    // Which is what makes the two readings the same answer, at this call site, on
    // the field this call site uses.
    expect(firstUtteranceOfSection(found, straddling, 4)).toBe(1);
    expect(found[1].text).toBe('him, or so he thought.');
  });
});

/**
 * The two ends of a reading, which are not the same thing to say.
 *
 * On 2026-09-20 at 04:43 the reading stopped at the end of the sections epub.js
 * had rendered, with 2,073 of the owner's 2,077 spine items still ahead of it,
 * and said nothing at all. Now it says something — and the sentence has to be the
 * right one of two, because "that was the last of this document" on a book with
 * two thousand chapters left in it would be a worse lie than the silence.
 */
describe('outOfTextSentence', () => {
  it('is the end of the book at the last spine item', () => {
    const answer = outOfTextSentence(11, 12);
    expect(answer.ended).toBe(true);
    expect(answer.sentence).toContain('the end of the book');
  });

  it('is not the end of the book with sections still to render', () => {
    // The 04:43 state: spine item 4 of 2,077.
    const answer = outOfTextSentence(4, 2077);
    expect(answer.ended).toBe(false);
    expect(answer.sentence).toContain('waiting for more of it');
    expect(answer.sentence).not.toContain('the end of the book');
  });

  it('is never the end of a document that has not said how long it is', () => {
    // The spine arrives in its own message and is zero until it does. A document
    // of unknown length is not a document that has finished.
    expect(outOfTextSentence(-1, 0).ended).toBe(false);
    expect(outOfTextSentence(40, 0).ended).toBe(false);
  });

  it('reads the furthest section reported, not a count of sections with text in them', () => {
    // A colophon that rendered and held nothing still moves the furthest mark, and
    // the end of a book is exactly where those live.
    expect(outOfTextSentence(2076, 2077).ended).toBe(true);
    expect(outOfTextSentence(2075, 2077).ended).toBe(false);
  });
});

/**
 * And the third sentence, which is the one a Provider failure needs.
 *
 * On 2026-09-20 at 07:48 Fish Audio lost the network for the last clips of a
 * document. The reading stopped at Utterance 17 of 18 and the player said "That was
 * the last of this document. The reading has stopped at the end of the book." Every
 * one of `hasRunOut`'s four conditions held, because a Clip that was refused left
 * `inFlight` and the queue drained past it — so the answer is a sentence and not a
 * fifth condition, which would have restored the silence of 04:43 instead. Since
 * ADR 0027 the queue stops at a refusal instead, so the sentence is kept as a guard.
 */
describe('outOfTextSentence, with Utterances that were never spoken', () => {
  const lost = 'Fish Audio could not reach api.fish.audio: The network connection was lost.';

  it('says the reading stopped because synthesis failed, and names the refusal', () => {
    const answer = outOfTextSentence(1, 2, { count: 1, reason: lost });
    expect(answer.sentence).toContain('One Utterance was never spoken, because synthesis failed');
    expect(answer.sentence).toContain(lost);
  });

  it('does not say the book ended, at the very place where it would have', () => {
    // The 07:48 state: the last spine item, so `ended` is true and the reading does
    // stop — but it stopped because a Clip never arrived, and that is what is said.
    const answer = outOfTextSentence(1, 2, { count: 1, reason: lost });
    expect(answer.sentence).toContain('not at the end of the book');
    expect(answer.sentence).not.toContain('That was the last of this document');
  });

  it('still stops the reading at the last spine item, because nothing is coming either way', () => {
    // `ended` decides whether the engine is paused, and a failure does not change
    // what is left to play. Keeping it false here would leave a reading `playing`
    // with nothing to play — the six-minute silence, wearing a better sentence.
    expect(outOfTextSentence(1, 2, { count: 3, reason: null }).ended).toBe(true);
    expect(outOfTextSentence(4, 2077, { count: 3, reason: null }).ended).toBe(false);
  });

  it('says it is waiting for more when there are sections still to render', () => {
    const answer = outOfTextSentence(4, 2077, { count: 2, reason: lost });
    expect(answer.sentence).toContain('2 Utterances were never spoken');
    expect(answer.sentence).toContain('waiting for more of it');
    expect(answer.sentence).not.toContain('the end of the book');
  });

  it('counts, and asks for them back in the plural it counted', () => {
    expect(outOfTextSentence(1, 2, { count: 1, reason: null }).sentence).toContain('Going back to it is how it is asked for again');
    expect(outOfTextSentence(1, 2, { count: 4, reason: null }).sentence).toContain(
      'Going back to them is how they are asked for again',
    );
  });

  it('ends the refusal in a full stop, because a sentence follows it', () => {
    // `SynthesisError`'s messages end in a question mark, a period or nothing at all,
    // and without this the refusal runs into the sentence after it.
    expect(outOfTextSentence(1, 2, { count: 1, reason: 'the server answered 500' }).sentence).toContain(
      'the server answered 500. The reading',
    );
    expect(outOfTextSentence(1, 2, { count: 1, reason: 'is the address right?' }).sentence).toContain(
      'is the address right? The reading',
    );
  });

  it('is the ordinary pair of sentences when nothing was lost', () => {
    // The default, so that a caller with nothing to report says what it always said.
    expect(outOfTextSentence(1, 2, { count: 0, reason: null }).sentence).toBe(outOfTextSentence(1, 2).sentence);
    expect(outOfTextSentence(4, 2077, { count: 0, reason: lost }).sentence).toBe(outOfTextSentence(4, 2077).sentence);
  });
});
