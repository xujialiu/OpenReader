import { describe, expect, it } from 'vitest';
import { blockRuns, continuesSentence, endsMidSentence, segmentBlocks, type Block } from '../../../src/core/segmenter';
import { splitWithSentencex } from '../../../src/core/segmenter/sentencex';

const options = { splitSentences: splitWithSentencex };
const spoken = (blocks: readonly Block[], rejoin = true) => segmentBlocks(blocks, 'en', { ...options, rejoin }).map((u) => u.text);

/**
 * The repair layer of ADR 0006, adapted from the plugin's
 * `src/read-aloud/paragraph-parts.ts` (issue #104) and its test.
 *
 * The texts are that issue's — the owner's manuscript as Zotero's document
 * worker structured it, measured live on 2026-09-14, where blocks 108, 109 and
 * 110 each cut a sentence. What does not come across is the geometry: the
 * plugin's fourth test asks whether the next block sits where the first's next
 * line would be, in PDF points, and an EPUB has no page. Adjacency in reading
 * order, the paragraph role and the section take its place.
 */
const TAIL_108 =
  'To ensure accurate quantitative analysis, images should be corrected for lateral magnification based on the actual AL of each eye. ' +
  'That said, image magnification error correction is not required for';
const HEAD_109 = 'longitudinal monitoring of individuals ';
const TAIL_109 =
  ' or for other instances in which no significant change in AL is expected. ' +
  'It is also worth noting that some OCTA-derived metrics are not impacted by AL,';
const HEAD_110 = 'including FAZ-C ';
const TAIL_110 = '. Despite growing awareness, uncorrected images remain common.';

function manuscript(): Block[] {
  return [
    { text: 'In this study, we showed that applying the correction altered intergroup differences in OCTA metrics. ' + TAIL_108 },
    { text: HEAD_109 + '[66]' + TAIL_109 },
    { text: HEAD_110 + '[67]' + TAIL_110 },
  ];
}

describe('the sentence across a Block boundary', () => {
  it('reads as one utterance, spanning both Blocks', () => {
    const blocks = manuscript();
    const utterances = segmentBlocks(blocks, 'en', options);
    const joined = utterances[2];
    expect(joined.text).toBe(
      'That said, image magnification error correction is not required for longitudinal monitoring of individuals [66] ' +
        'or for other instances in which no significant change in AL is expected.',
    );
    expect(joined.spans).toEqual([
      { block: 0, start: 233, end: 300, textOffset: 0 },
      { block: 1, start: 0, end: 116, textOffset: 68 },
    ]);
    // The invariant that makes a Range out of a Word Timing: each span's
    // characters are exactly the Block's own, at the offset the text says.
    for (const span of joined.spans) {
      expect(joined.text.slice(span.textOffset, span.textOffset + span.end - span.start)).toBe(
        blocks[span.block].text.slice(span.start, span.end),
      );
    }
  });

  it('spends two joins and two utterances on three Blocks that cut two sentences', () => {
    // The plugin measured the same relation on the real document: the utterance
    // count fell by exactly the number of joins (559 → 541 over 18).
    expect(spoken(manuscript(), false)).toHaveLength(7);
    expect(spoken(manuscript(), true)).toHaveLength(5);
    expect(blockRuns(manuscript()).map((run) => run.blocks)).toEqual([[0, 1, 2]]);
  });

  it('leaves the two halves apart when the repair is switched off', () => {
    const halves = spoken(manuscript(), false);
    expect(halves[2]).toBe('That said, image magnification error correction is not required for');
    expect(halves[3]).toBe(
      'longitudinal monitoring of individuals [66] or for other instances in which no significant change in AL is expected.',
    );
  });

  it('inserts one space, and only where neither side brought one', () => {
    expect(blockRuns([{ text: 'ends for' }, { text: 'longitudinal monitoring is expected.' }])[0]).toEqual({
      blocks: [0, 1],
      text: 'ends for longitudinal monitoring is expected.',
      offsets: [0, 9],
    });
    expect(blockRuns([{ text: 'ends for ' }, { text: 'longitudinal monitoring is expected.' }])[0].offsets).toEqual([0, 9]);
    expect(blockRuns([{ text: 'ends for' }, { text: ' longitudinal monitoring is expected.' }])[0].offsets).toEqual([0, 8]);
  });
});

describe('what starts a continuation', () => {
  it('takes a lowercase letter, a citation bracket, or a bracket group before a lowercase word', () => {
    const cases = [
      'longitudinal monitoring of individuals is expected.',
      '[66] or for other instances in which no change is expected.',
      '(12) or for other instances in which no change is expected.',
      '(Table 4) exhibited the largest effect sizes, suggesting they are the ones to keep.',
    ];
    for (const text of cases) {
      expect(continuesSentence(text)).toBe(true);
      expect(blockRuns([{ text: 'the paragraph was cut after' }, { text }])[0].blocks).toEqual([0, 1]);
    }
  });

  it('refuses a capital, a bare digit, and a bracket group before a capital', () => {
    // `(A) The first criterion` and `2023 was the year` both open real
    // paragraphs; the plugin's sieve refused them and so does this one.
    const cases = ['Longitudinal monitoring of individuals is one case.', '2023 was the year the correction became standard.', '(A) The first criterion is the effect size.'];
    for (const text of cases) {
      expect(continuesSentence(text)).toBe(false);
      expect(blockRuns([{ text: 'the paragraph was cut after' }, { text }]).map((run) => run.blocks)).toEqual([[0], [1]]);
    }
  });

  it('refuses when the first Block ended a sentence of its own', () => {
    expect(endsMidSentence('That said, correction is not always required.')).toBe(false);
    expect(blockRuns([{ text: 'That said, correction is not always required.' }, { text: 'longitudinal monitoring is one case.' }]).map((r) => r.blocks)).toEqual(
      [[0], [1]],
    );
  });

  it('takes a closing quote or bracket after the terminator as still the end of a sentence', () => {
    for (const text of ['He said "Stop!"', 'the answer (see above).', '“Nothing.”', 'a list of names [1].']) {
      expect(endsMidSentence(text)).toBe(false);
    }
  });

  it('counts an ideographic full stop as the end of a sentence', () => {
    // Behaviourally moot — an uncased script is never rejoined — but a predicate
    // that is wrong for Chinese would be borrowed later and be wrong somewhere
    // that matters.
    expect(endsMidSentence('第三句结束这一段文字。')).toBe(false);
    expect(endsMidSentence('第三句结束这一段')).toBe(true);
    expect(endsMidSentence('他说：“我不知道。”')).toBe(false);
  });

  it('calls empty text the continuation of nothing', () => {
    expect(endsMidSentence('')).toBe(false);
    expect(endsMidSentence('   ')).toBe(false);
  });
});

describe('what the structure has to say', () => {
  it('never joins a heading to what follows it, or what precedes it to a heading', () => {
    // The one cut the plugin's live run was still refusing after the fix was
    // exactly this: a heading `Image analysis`, then `was performed using
    // OCTAVA …` much further down. Rightly refused.
    const afterHeading: Block[] = [{ text: 'Image analysis', role: 'heading' }, { text: 'was performed using OCTAVA and the defaults.' }];
    expect(blockRuns(afterHeading).map((run) => run.blocks)).toEqual([[0], [1]]);
    const intoHeading: Block[] = [{ text: 'The method used was' }, { text: 'image analysis', role: 'heading' }];
    expect(blockRuns(intoHeading).map((run) => run.blocks)).toEqual([[0], [1]]);
  });

  it('never joins across a section, so a chapter file does not run into the next', () => {
    const across: Block[] = [
      { text: 'and the door closed behind', section: 'ch1.xhtml' },
      { text: 'him, or so he thought.', section: 'ch2.xhtml' },
    ];
    expect(blockRuns(across).map((run) => run.blocks)).toEqual([[0], [1]]);
    const within = across.map((block) => ({ ...block, section: 'ch1.xhtml' }));
    expect(blockRuns(within).map((run) => run.blocks)).toEqual([[0, 1]]);
  });

  it('treats a Block with no role as a paragraph, which is all a caller holding plain text could mean', () => {
    expect(blockRuns([{ text: 'cut after' }, { text: 'this continuation.' }]).map((run) => run.blocks)).toEqual([[0, 1]]);
    expect(blockRuns([{ text: 'cut after', role: 'other' }, { text: 'this continuation.' }]).map((run) => run.blocks)).toEqual([[0], [1]]);
  });

  it('jumps an empty Block — an <hr>, a <p> a converter left behind — which produces no utterance either way', () => {
    const blocks: Block[] = [{ text: 'the sentence was cut after' }, { text: '' }, { text: '\n  ' }, { text: 'this continuation of it.' }];
    expect(blockRuns(blocks).map((run) => run.blocks)).toEqual([[0, 3]]);
    expect(spoken(blocks)).toEqual(['the sentence was cut after this continuation of it.']);
  });

  it('refuses when something visible sits between the two halves', () => {
    // A `<div epub:type="pagebreak">143</div>` is real text a reader can see,
    // and it is Speakable. The plugin skipped a PDF's page numbers because a
    // classifier had labelled them furniture; an EPUB's text flow carries no
    // such label, so the safe answer is to leave the two halves alone.
    const blocks: Block[] = [{ text: 'the sentence was cut after' }, { text: '143' }, { text: 'this continuation of it.' }];
    expect(blockRuns(blocks).map((run) => run.blocks)).toEqual([[0], [1], [2]]);
  });

  it('leaves a blank Block that was not spent on a join producing nothing', () => {
    const blocks: Block[] = [{ text: 'A whole sentence.' }, { text: '   ' }, { text: 'Another whole one.' }];
    expect(blockRuns(blocks).map((run) => run.blocks)).toEqual([[0], [1], [2]]);
    expect(spoken(blocks)).toEqual(['A whole sentence.', 'Another whole one.']);
  });

  it('copes with no Blocks and with one', () => {
    expect(blockRuns([])).toEqual([]);
    expect(blockRuns([{ text: 'Alone.' }])).toEqual([{ blocks: [0], text: 'Alone.', offsets: [0] }]);
  });
});

describe('a book a converter made out of print', () => {
  /**
   * The failure the plugin met in a PDF arriving by another road: an EPUB
   * produced from print with one `<p>` per typeset line. Every line but the last
   * ends mid-sentence and every line but the first starts lowercase, so the
   * whole paragraph comes back together and is read as the two sentences it is.
   */
  const LINES = [
    'It is a truth universally acknowledged, that a single man in',
    'possession of a good fortune, must be in want of a wife.',
    'However little known the feelings or views of such a man may be',
    'on his first entering a neighbourhood, this truth is so well fixed',
    'in the minds of the surrounding families.',
  ];

  it('reads the lines as two sentences rather than five fragments', () => {
    const blocks = LINES.map((text) => ({ text }));
    // Two runs, not one: line 1 ends at `a wife.`, so line 2 begins a sentence
    // of its own and nothing joins them. One run per sentence, five lines put
    // back into two.
    expect(blockRuns(blocks).map((run) => run.blocks)).toEqual([
      [0, 1],
      [2, 3, 4],
    ]);
    expect(spoken(blocks)).toEqual([
      'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.',
      'However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families.',
    ]);
  });

  it('gives each utterance one span per line it crosses, and every span its exact characters', () => {
    const blocks = LINES.map((text) => ({ text }));
    const utterances = segmentBlocks(blocks, 'en', options);
    expect(utterances.map((u) => u.spans.map((s) => s.block))).toEqual([
      [0, 1],
      [2, 3, 4],
    ]);
    for (const utterance of utterances) {
      for (const span of utterance.spans) {
        expect(utterance.text.slice(span.textOffset, span.textOffset + span.end - span.start)).toBe(
          blocks[span.block].text.slice(span.start, span.end),
        );
      }
    }
  });
});

describe('the scripts this layer cannot help', () => {
  /**
   * `\p{Ll}` matches no character of Han, Hangul, Hebrew, Arabic, Devanagari or
   * Thai, so a cut paragraph in any of them is never rejoined. That is the right
   * answer rather than a Latin oversight: in a script without case there is
   * nothing in the text that tells a continuation from a new paragraph, and the
   * plugin's own reason for refusing a bare digit — it opens real paragraphs too
   * — applies to every uncased script at once.
   */
  it.each([
    ['Chinese', '第二句话稍微长一些', '用来观察每个汉字。'],
    ['Hebrew', 'זה המשפט הראשון', 'והמשך שלו.'],
    ['Devanagari', 'यह पहला', 'वाक्य है।'],
  ])('leaves a cut %s paragraph cut', (_name, first, second) => {
    expect(endsMidSentence(first)).toBe(true);
    expect(continuesSentence(second)).toBe(false);
    expect(blockRuns([{ text: first }, { text: second }]).map((run) => run.blocks)).toEqual([[0], [1]]);
  });
});
