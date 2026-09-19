import { describe, expect, it } from 'vitest';
import { segmentBlock, segmentBlocks } from '../../../src/core/segmenter';
import { splitWithSentencex } from '../../../src/core/segmenter/sentencex';

const options = { splitSentences: splitWithSentencex };
const texts = (text: string, language: string) => segmentBlock(text, language, options).map((u) => u.text);

/**
 * The Zotero-TTS plugin's `test/fixtures/` directory, as the test suite for this
 * one. ADR 0006: those cases "are the accumulated record of where sentence
 * splitting actually goes wrong, and are worth more than the code".
 *
 * What comes across is the text, not the container. The fixtures there are an
 * EPUB and a PDF apiece, built by a `build.py` beside each one, because what they
 * had to exercise was Zotero's own document pipeline. This directory takes a
 * Block's text and gives back utterances, so the text is the fixture and the
 * EPUB around it would test epub.js.
 *
 * Every expectation here is what the pinned `sentencex` **actually does**,
 * measured 2026-09-19, and the last block of this file is the part it gets wrong.
 * None of it is tuned to pass: where a reader would want something else the
 * comment says so and the assertion still records the behaviour, because a
 * baseline that flatters the splitter is worse than none.
 *
 * The pin is 0.4.2, the last release before the Rust cutover (see
 * `src/core/segmenter/sentencex.ts`). It knows 29 languages and falls back to
 * English for everything else, `ro` and `zh` included, so a Chinese or Romanian
 * book here is split by the English rules over a terminator list that does
 * include `。` and its relatives. Where that costs something the case below says
 * which. notes/NOTES.md item 7 — splitting quality on real books — stays open;
 * this establishes where the floor is, it does not raise it.
 */

describe('the CJK fixture (test/fixtures/zh, issue #89)', () => {
  // Three sentences under a heading, built so that a provider timing Chinese by
  // the character can be read against known counts. The plugin's build.py prints
  // their lengths, punctuation included: 16, 24, 11.
  const SENTENCES = [
    '这是一个用于朗读测试的中文文档。',
    '第二句话稍微长一些，用来观察每个汉字的时间标记。',
    '第三句结束这一段文字。',
  ];

  it('cuts the one paragraph into the three sentences, at the lengths the fixture records', () => {
    expect(SENTENCES.map((s) => s.length)).toEqual([16, 24, 11]);
    const utterances = segmentBlock(SENTENCES.join(''), 'zh', options);
    expect(utterances.map((u) => u.text)).toEqual(SENTENCES);
    expect(utterances.map((u) => [u.spans[0].start, u.spans[0].end])).toEqual([
      [0, 16],
      [16, 40],
      [40, 51],
    ]);
  });

  it('does not cut at the ideographic comma, which is not a terminator', () => {
    expect(texts('第二句话稍微长一些，用来观察', 'zh')).toHaveLength(1);
  });

  it('cuts two unquoted Chinese sentences at the ideographic full stop', () => {
    // 他说我不知道。然后离开了。
    expect(texts('他说我不知道。然后离开了。', 'zh')).toEqual(['他说我不知道。', '然后离开了。']);
  });

  it('cuts Japanese at the ideographic full stop', () => {
    expect(texts('これは日本語の文です。次の文です。', 'ja')).toEqual([
      'これは日本語の文です。',
      '次の文です。',
    ]);
  });
});

describe('the Romanian diacritics fixture (test/fixtures/ro-diacritics, issue #74)', () => {
  /**
   * The same body text three times: comma-below precomposed (NFC, as Romanian
   * is properly written), the legacy cedilla forms, and fully decomposed. The
   * point of the fixture is that a diacritic must not change where a sentence
   * ends or how long it is, whichever of the three a publisher shipped — and
   * ADR 0008 records that EPUB text really does arrive either way.
   */
  const BODY =
    'Această poveste începe într-o dimineață răcoroasă, când țăranii coborau spre târgul din vale. ' +
    'Bătrânul învățător își strângea șalul și număra bănuții rămași. ' +
    'Șoseaua șerpuia printre dealurile împădurite și ajungea la mănăstirea așezată lângă izvor.';
  const CEDILLA: Record<string, string> = { 'ș': 'ş', 'Ș': 'Ş', 'ț': 'ţ', 'Ț': 'Ţ' };

  const comma = 'Unu, acest paragraf folosește semnele cu virgulă dedesubt. ' + BODY;
  const cedilla = [...('Doi, acest paragraf folosește semnele cu sedilă. ' + BODY)].map((c) => CEDILLA[c] ?? c).join('');
  const decomposed = ('Trei, acest paragraf este descompus în forma NFD. ' + BODY).normalize('NFD');

  it.each([
    ['comma below, precomposed', comma],
    ['cedilla, the legacy forms', cedilla],
    ['every diacritic decomposed', decomposed],
  ])('cuts four sentences with %s', (_name, paragraph) => {
    const utterances = segmentBlock(paragraph, 'ro', options);
    expect(utterances).toHaveLength(4);
    // The spans come back exactly as written, in the same normalisation: nothing
    // here normalises the document's text. ADR 0008 puts that on the text-anchor
    // side, where both sides can be normalised together.
    expect(utterances.map((u) => u.text).join(' ')).toBe(paragraph);
    for (const utterance of utterances) {
      const span = utterance.spans[0];
      expect(paragraph.slice(span.start, span.end)).toBe(utterance.text);
    }
  });

  it('gives the same sentences of a decomposed paragraph different offsets', () => {
    // The same paragraph is 40 code units longer decomposed, because the
    // combining marks are characters of their own. So an offset into one is not
    // an offset into the other, and nothing here may be measured in
    // "characters": the offsets are code units into the Block as the Block
    // actually arrived.
    expect(comma.normalize('NFD').length - comma.length).toBe(40);
    const precomposed = segmentBlock(comma, 'ro', options);
    const decomposedForm = segmentBlock(comma.normalize('NFD'), 'ro', options);
    expect(decomposedForm.map((u) => u.text.normalize('NFC'))).toEqual(precomposed.map((u) => u.text));
    expect(decomposedForm.map((u) => u.spans[0].start)).not.toEqual(precomposed.map((u) => u.spans[0].start));
    expect(decomposedForm[3].spans[0].end).toBeGreaterThan(precomposed[3].spans[0].end);
  });

  it('never leaves a combining mark at the head of an utterance', () => {
    for (const utterance of segmentBlock(decomposed, 'ro', options)) {
      expect(/^[\p{M}]/u.test(utterance.text)).toBe(false);
    }
  });
});

describe('the angle-bracket fixture (test/fixtures/angle-brackets, issue #94)', () => {
  /**
   * Seven paragraphs of bracket shapes. Stripping brackets is
   * `core/speech-text.ts`'s job and happens after segmentation, on the
   * utterance; what is asserted here is that segmentation leaves every one of
   * them as the document has it — a bracket is not a sentence boundary, an
   * unmatched one is not either, and the empty pair is not an utterance split.
   *
   * Six of the seven hold. The third does not, and is below with the other
   * disagreements.
   */
  const PARAGRAPHS = [
    '<Hello world>.',
    '“<The quick brown fox jumps over the lazy dog>!”',
    '<The next sentence keeps its words and punctuation.>',
    'Ordinary text with a < comparison stays intact.',
    '<Only the opening bracket stays intact.',
    '<>',
    '<The final sentence continues after the empty pair>.',
  ];

  it('leaves six of the seven paragraphs as one utterance each, whole', () => {
    const blocks = PARAGRAPHS.filter((_, i) => i !== 2).map((text) => ({ text }));
    const utterances = segmentBlocks(blocks, 'en', options);
    expect(utterances.map((u) => u.text)).toEqual(PARAGRAPHS.filter((_, i) => i !== 2));
    expect(utterances.map((u) => u.spans[0].block)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('calls the empty pair not Speakable and the other five Speakable', () => {
    const blocks = PARAGRAPHS.filter((_, i) => i !== 2).map((text) => ({ text }));
    expect(segmentBlocks(blocks, 'en', options).map((u) => u.speakable)).toEqual([true, true, true, true, false, true]);
  });

  it('does not cut at an unmatched opening bracket, or inside the wrapped comparison of #94', () => {
    expect(texts('<Only the opening bracket stays intact.', 'en')).toHaveLength(1);
    expect(texts('Ordinary text with a < comparison stays intact.', 'en')).toHaveLength(1);
    expect(texts('“<The quick brown fox jumps over the lazy dog>!”', 'en')).toHaveLength(1);
  });
});

describe('the numbers fixture (test/fixtures/numbers, issue #86)', () => {
  /**
   * One page of what a Kokoro-FastAPI server rewrites before it speaks:
   * decimals, a thousands separator, a percentage, a typographic apostrophe, a
   * multiplication sign glued to a digit — and `branchpoints`, which holds the
   * word `point`, so that a substring search would land there. That last part is
   * `core/align.ts`'s problem. What matters here is that none of the numbers is
   * mistaken for the end of a sentence.
   */
  const SECOND =
    'About 1,000 eyes were scanned at 0.99 confidence, and 76% of the panel agreed. ' +
    'The pre-trained model had seen 1.6 million images [1]. ' +
    'A magnification error of -20% to +10% is common, and a study last year found none after correction.';

  it('does not cut inside a decimal, a thousands separator or a percentage', () => {
    expect(texts(SECOND, 'en')).toEqual([
      'About 1,000 eyes were scanned at 0.99 confidence, and 76% of the panel agreed.',
      'The pre-trained model had seen 1.6 million images [1].',
      'A magnification error of -20% to +10% is common, and a study last year found none after correction.',
    ]);
  });

  it('keeps a trailing citation bracket with the sentence it ends', () => {
    expect(texts('The model had seen 1.6 million images [1]. A study found none.', 'en')).toEqual([
      'The model had seen 1.6 million images [1].',
      'A study found none.',
    ]);
  });

  it('does not cut at a price or a decimal before a capital', () => {
    expect(texts('It cost $3.50. She paid.', 'en')).toEqual(['It cost $3.50.', 'She paid.']);
    expect(texts('In the reviewers’ 29.83 mm example eye the scan was small. It was.', 'en')).toHaveLength(2);
  });

  it('cuts at an interrobang and at an ellipsis inside a sentence', () => {
    expect(texts('Really?! I had no idea. Amazing.', 'en')).toEqual(['Really?!', 'I had no idea.', 'Amazing.']);
    expect(texts('Wait… what happened? Nothing.', 'en')).toEqual(['Wait… what happened?', 'Nothing.']);
  });

  it('does not cut at initials, an honorific or a figure reference', () => {
    expect(texts('J. R. R. Tolkien wrote it. He did.', 'en')).toEqual(['J. R. R. Tolkien wrote it.', 'He did.']);
    expect(texts('Mr. and Mrs. Smith arrived. They sat down.', 'en')).toEqual(['Mr. and Mrs. Smith arrived.', 'They sat down.']);
    expect(texts('See Fig. 3 for details. It is clear.', 'en')).toEqual(['See Fig. 3 for details.', 'It is clear.']);
    expect(texts('Smith et al. reported this. Others did not.', 'en')).toEqual(['Smith et al. reported this.', 'Others did not.']);
  });

  it('keeps a line break inside a sentence inside the sentence', () => {
    expect(texts('The first line ends here\nand the second line continues. Then a new sentence.', 'en')).toEqual([
      'The first line ends here\nand the second line continues.',
      'Then a new sentence.',
    ]);
  });
});

/**
 * Where `sentencex` 1.0.31 disagrees with what a reader would want. A baseline,
 * not an endorsement: each assertion is what it does today, and each comment is
 * what it should do. When the splitter is replaced — ADR 0006 calls it "the
 * first segmenter here, not the final one" — these are the tests that say what
 * changed.
 *
 * The consequence of each of these is audible rather than catastrophic: a pause
 * in the wrong place, or a fragment read as if it were a sentence. None of them
 * moves an offset, because the offsets are derived from the pieces rather than
 * reported by the splitter.
 */
describe('where sentencex disagrees with a reader', () => {
  /**
   * The headline case, and the reason the plugin's numbers fixture carries
   * `mm.` before a capital at all: its build.py says "Zotero's segmenter did
   * not break the sentence there, and one bad pair then reached into the next
   * sentence". Neither does `sentencex` — so the two products fail this one the
   * same way, which is the one consolation.
   *
   * The mechanism, narrowed: `mm` and `m` are in the English abbreviation list
   * and `cm`, `kg` and an invented `xy` are not. On 0.4.2 an abbreviation blocks
   * the break unconditionally, so even `3 mm. Then it ends.` runs together;
   * 1.0.31 let a known sentence starter override the list and split that one.
   */
  it('runs two sentences together after a unit abbreviation (wrong: two sentences)', () => {
    const paragraph =
      'Zotero-TTS numbers fixture, page one. In the reviewers’ 29.83 mm example eye, a scan labelled 3 × 3 mm ' +
      'covers 3.7 × 3.7 mm. Vessels in that eye therefore look narrower, their branchpoints denser, and the ' +
      'avascular zone smaller than they are.';
    const spoken = texts(paragraph, 'en');
    expect(spoken).toHaveLength(2);
    // The second utterance is two sentences, joined at `mm. Vessels`.
    expect(spoken[1]).toContain('mm. Vessels in that eye');

    expect(texts('covers 3 mm. Vessels are narrower.', 'en')).toHaveLength(1);
    expect(texts('covers 3 mm. Then it ends.', 'en')).toHaveLength(1);
    expect(texts('covers 3 cm. Vessels are narrower.', 'en')).toHaveLength(2);
    expect(texts('covers 3 kg. Vessels are narrower.', 'en')).toHaveLength(2);
  });

  /**
   * The same unconditional-abbreviation rule, on two abbreviations that really
   * do end sentences. Both of these split correctly on 1.0.31, so the pin costs
   * them: `U.S.` and `p.m.` at the end of a sentence are common in prose, and a
   * reader hears one long utterance where there were two.
   */
  it('reads straight through U.S. and p.m. at the end of a sentence (wrong: two sentences)', () => {
    expect(texts('He lives in the U.S. The next sentence starts here.', 'en')).toEqual([
      'He lives in the U.S. The next sentence starts here.',
    ]);
    expect(texts('The meeting is at 5 p.m. Bring the report.', 'en')).toEqual(['The meeting is at 5 p.m. Bring the report.']);
  });

  /** `Eq.` and `Vol.` are not in the list, so a sentence is cut in two and a bare number becomes an utterance of its own. */
  it('cuts after Eq. and Vol. (wrong: one sentence each)', () => {
    expect(texts('See Sec. 4 and Eq. 12. The result follows.', 'en')).toEqual(['See Sec. 4 and Eq.', '12.', 'The result follows.']);
    expect(texts('Vol. 3, no. 2, pp. 44-51. The next citation follows.', 'en')).toEqual([
      'Vol.',
      '3, no. 2, pp. 44-51.',
      'The next citation follows.',
    ]);
  });

  /**
   * A run-in numbered list in one Block. A reader wants `1. Introduction`,
   * `2. Methods`, `3. Results`; every cut lands one item early, so each
   * utterance is a heading with the next item's number stuck on the end.
   */
  it('cuts a run-in numbered list after the number instead of before it (wrong)', () => {
    expect(texts('1. Introduction 2. Methods 3. Results', 'en')).toEqual(['1.', 'Introduction 2.', 'Methods 3.', 'Results']);
  });

  /**
   * The third paragraph of the angle-bracket fixture, which 1.0.31 kept whole.
   * 0.4.2 protects a parenthesised span from being cut inside, but the regular
   * expression that does it (`Language.parensRegex`) lists `<` as an opening
   * character and does **not** list `>` as a closing one, so an angle group is
   * never matched and the full stop before the `>` breaks the sentence. The
   * result is a lone `>` utterance, which is not Speakable and so becomes
   * silence rather than being spoken — the damage is a pause, not a bracket read
   * aloud.
   */
  it('cuts before a closing angle bracket (wrong: one utterance)', () => {
    const utterances = segmentBlock('<The next sentence keeps its words and punctuation.>', 'en', options);
    expect(utterances.map((u) => u.text)).toEqual(['<The next sentence keeps its words and punctuation.', '>']);
    expect(utterances.map((u) => u.speakable)).toEqual([true, false]);
  });

  /**
   * Chinese quoted speech. `zh` is not one of 0.4.2's 29 languages, so it is
   * split by the English rules, and the English quote-pair handling protects
   * everything between `“` and `”` from being cut — which is right for
   * English and wrong here, where the `。` inside the quotation really does
   * end the sentence. 1.0.31 split it. An unquoted pair still splits, so this
   * costs a paragraph of dialogue rather than a chapter.
   */
  it('runs a quoted Chinese sentence into the next one (wrong: two utterances)', () => {
    expect(texts('他说：“我不知道。”然后离开了。', 'zh')).toEqual([
      '他说：“我不知道。”然后离开了。',
    ]);
    expect(texts('他说我不知道。然后离开了。', 'zh')).toHaveLength(2);
  });

  /**
   * French `M.` is Monsieur, and `en` gets this right while `fr` does not —
   * the language parameter makes this case worse rather than better. Worth
   * having on record because it is the argument against assuming a per-language
   * rule set is per-language *better*.
   */
  it('cuts after the French M. when told the text is French (wrong)', () => {
    expect(texts('M. Dupont est ici. Il part.', 'fr')).toEqual(['M.', 'Dupont est ici.', 'Il part.']);
    expect(texts('M. Dupont est ici. Il part.', 'en')).toEqual(['M. Dupont est ici.', 'Il part.']);
  });

  /** And the other way round: Dutch `bv.` is handled in `nl` and cut in `en`. The language has to be the document's. */
  it('needs the document own language to get an abbreviation right', () => {
    expect(texts('Dat is bv. zo. En dan?', 'nl')).toEqual(['Dat is bv. zo.', 'En dan?']);
    expect(texts('Dat is bv. zo. En dan?', 'en')).toEqual(['Dat is bv.', 'zo.', 'En dan?']);
  });

  /**
   * An unknown or absent language tag is not an error and not a refusal: it
   * falls back to a rule set that still cuts at a full stop. So a document
   * whose `dc:language` is missing is read, just less well — and on 0.4.2 that
   * fallback carries `ro` and `zh` too. There is no detector to reach for
   * (ADR 0006).
   */
  it('falls back rather than failing on a language it does not know', () => {
    for (const tag of ['xx', '', 'und', 'mul', 'ro', 'zh']) {
      expect(texts('One sentence. Another one.', tag)).toEqual(['One sentence.', 'Another one.']);
    }
  });
});
