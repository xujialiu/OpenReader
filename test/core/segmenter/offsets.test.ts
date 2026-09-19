import { describe, expect, it } from 'vitest';
import { segmentBlock, segmentBlocks, type Utterance } from '../../../src/core/segmenter';
import { splitWithSentencex } from '../../../src/core/segmenter/sentencex';
import type { SplitSentences } from '../../../src/core/segmenter/sentences';

const options = { splitSentences: splitWithSentencex };

/**
 * Every utterance's spans put back together must be exactly its text, and every
 * span must be exactly the characters of the Block it names. This is the whole
 * contract: a highlight is built from the spans and the provider speaks the
 * text, so the moment the two stop agreeing the highlight drifts.
 */
function checkSpans(utterances: readonly Utterance[], blocks: readonly { text: string }[]): void {
  for (const utterance of utterances) {
    expect(utterance.spans.length).toBeGreaterThan(0);
    for (const span of utterance.spans) {
      expect(utterance.text.slice(span.textOffset, span.textOffset + span.end - span.start)).toBe(
        blocks[span.block].text.slice(span.start, span.end),
      );
    }
  }
}

/** Where each utterance sits in a single Block, as `[start, end]` pairs. */
function offsets(utterances: readonly Utterance[]): [number, number][] {
  return utterances.map((u) => {
    expect(u.spans.length).toBe(1);
    return [u.spans[0].start, u.spans[0].end];
  });
}

describe('offsets into the Block', () => {
  it('reports the span of each sentence, trimmed, in UTF-16 code units', () => {
    const text = 'This is first sentence. This is another one.';
    const utterances = segmentBlock(text, 'en', options);
    expect(utterances.map((u) => u.text)).toEqual(['This is first sentence.', 'This is another one.']);
    expect(offsets(utterances)).toEqual([
      [0, 23],
      [24, 44],
    ]);
    checkSpans(utterances, [{ text }]);
  });

  /**
   * The trailing space `sentencex` leaves on a sentence is not part of it.
   * A clip's cache identity is provider, voice and text (ADR 0009), so
   * `This is first sentence. ` and `This is first sentence.` would be two
   * entries for one sentence and the owner would pay for the second.
   */
  it('trims the whitespace the splitter leaves on either end', () => {
    const text = '  leading space. and more.  ';
    const utterances = segmentBlock(text, 'en', options);
    expect(utterances.map((u) => u.text)).toEqual(['leading space.', 'and more.']);
    expect(offsets(utterances)).toEqual([
      [2, 16],
      [17, 26],
    ]);
    checkSpans(utterances, [{ text }]);
  });

  it('gives a blank run of its own no utterance', () => {
    // sentencex returns ['One.', '\n\n', 'Two.'] here — the paragraph break is
    // a piece of its own, and there is nothing in it to say or to highlight.
    const utterances = segmentBlock('One.\n\nTwo.', 'en', options);
    expect(utterances.map((u) => u.text)).toEqual(['One.', 'Two.']);
    expect(offsets(utterances)).toEqual([
      [0, 4],
      [6, 10],
    ]);
  });

  it.each([[''], ['   '], ['\n\n'], ['\u00a0\t\n']])('gives %j no utterance at all', (text) => {
    expect(segmentBlock(text, 'en', options)).toEqual([]);
  });

  /**
   * The offsets are UTF-16 code units, not code points, and one astral character
   * is the whole difference: this text is 17 code units and 16 code points, so a
   * code-point system puts the second sentence at 11 and a code-unit system at
   * 12. A `Range` is built from code units, so 11 would start the highlight
   * inside the emoji and stay one behind for the rest of the Block.
   *
   * No splitter is asked where a sentence is. 0.4.2 reports no offsets at all
   * and 1.0.31's were Unicode scalar indices; the spans are found by locating
   * each returned piece in the text.
   */
  it('counts code units, not code points', () => {
    const text = 'A \u{1F600} emoji. Next.';
    expect([text.length, [...text].length]).toEqual([17, 16]);
    expect(offsets(segmentBlock(text, 'en', options))).toEqual([
      [0, 11],
      [12, 17],
    ]);
    expect(text.slice(0, 11)).toBe('A \u{1F600} emoji.');
    expect(text.slice(12)).toBe('Next.');
  });

  /**
   * `sentencex` cuts between a full stop and a combining acute that belongs to
   * it, which would hand a provider a bare combining mark and start the
   * highlight half a character early. The cut moves forward to the cluster
   * boundary instead, so the mark stays with the sentence it ends.
   */
  it('never cuts inside a grapheme cluster', () => {
    const text = 'Hello.\u0301 World.';
    expect(splitWithSentencex('en', text)).toEqual(['Hello.', '\u0301 World.']);
    const utterances = segmentBlock(text, 'en', options);
    expect(utterances.map((u) => u.text)).toEqual(['Hello.\u0301', 'World.']);
    expect(offsets(utterances)).toEqual([
      [0, 7],
      [8, 14],
    ]);
    checkSpans(utterances, [{ text }]);
  });

  it('keeps an astral character and a flag whole', () => {
    const text = 'Family \u{1F468}\u200D\u{1F469}\u200D\u{1F467}. Flag \u{1F1FA}\u{1F1F8}. Done.';
    const utterances = segmentBlock(text, 'en', options);
    expect(utterances.map((u) => u.text)).toEqual(['Family \u{1F468}\u200D\u{1F469}\u200D\u{1F467}.', 'Flag \u{1F1FA}\u{1F1F8}.', 'Done.']);
    checkSpans(utterances, [{ text }]);
  });

  /**
   * Text with nothing pronounceable in it is still an utterance — the reader
   * sees it and the highlight passes over it — and it is flagged so that
   * nothing sends it to a provider. It becomes silence (CONTEXT.md).
   */
  it('marks an utterance with no letter and no digit as not Speakable', () => {
    const utterances = segmentBlock('* * *', 'en', options);
    expect(utterances).toEqual([{ text: '* * *', speakable: false, spans: [{ block: 0, start: 0, end: 5, textOffset: 0 }] }]);
  });

  it('keeps a Block with no terminator whole', () => {
    const utterances = segmentBlock('No terminator at all', 'en', options);
    expect(utterances.map((u) => u.text)).toEqual(['No terminator at all']);
  });

  it('numbers spans by the Block they came from', () => {
    const blocks = [{ text: 'First block. Still first.' }, { text: 'Second block.' }];
    const utterances = segmentBlocks(blocks, 'en', options);
    expect(utterances.map((u) => [u.text, u.spans[0].block])).toEqual([
      ['First block.', 0],
      ['Still first.', 0],
      ['Second block.', 1],
    ]);
    checkSpans(utterances, blocks);
  });
});

describe('a splitter that does not return the text it was given', () => {
  /**
   * `sentencex` 0.4.2 — the last pure-JS release, and the one candidate for
   * running on Hermes — drops the whitespace between sentences, so its pieces
   * do not concatenate back to the input. The offsets have to survive that,
   * because it is the difference between one working splitter and none.
   */
  it('recovers exact offsets from pieces with the whitespace dropped', () => {
    const dropsSpaces: SplitSentences = (_language, text) => text.split(/(?<=\.)\s+/u);
    const text = 'One sentence. Another one.  A third.';
    const utterances = segmentBlock(text, 'en', { splitSentences: dropsSpaces });
    expect(utterances.map((u) => u.text)).toEqual(['One sentence.', 'Another one.', 'A third.']);
    expect(offsets(utterances)).toEqual([
      [0, 13],
      [14, 26],
      [28, 36],
    ]);
    checkSpans(utterances, [{ text }]);
  });

  /**
   * A splitter that rewrote the text is refused rather than guessed at: the
   * Block comes back as one utterance. A long utterance is a listenable
   * failure; a wrong offset is the drift this project exists to prevent, and it
   * is not visible until the highlight is three lines away.
   */
  it.each([
    ['rewrites a character', (text: string) => [text.replace('.', '!')]],
    ['invents a piece', (text: string) => ['Something else entirely.', text]],
    ['reorders the sentences', (text: string) => text.split(/(?<=\.)\s+/u).reverse()],
    ['drops a sentence', (text: string) => [text.split(/(?<=\.)\s+/u)[1]]],
  ])('refuses a splitter that %s', (_name, split) => {
    const text = 'One sentence. Another one.';
    const utterances = segmentBlock(text, 'en', { splitSentences: (_l, t) => split(t) });
    expect(utterances.map((u) => u.text)).toEqual([text]);
    expect(offsets(utterances)).toEqual([[0, 26]]);
  });

  it('takes a piece of pure whitespace and a piece that is empty', () => {
    const text = 'One. Two.';
    const utterances = segmentBlock(text, 'en', { splitSentences: () => ['', 'One.', ' ', 'Two.', ''] });
    expect(utterances.map((u) => u.text)).toEqual(['One.', 'Two.']);
    expect(offsets(utterances)).toEqual([
      [0, 4],
      [5, 9],
    ]);
  });
});

/**
 * `sentencex` 0.4.2 ships no types, so `src/core/segmenter/sentencex-module.d.ts`
 * is written by hand — believed by the compiler and checked by nothing. These
 * are the assertions that check it, so a version bump that changes the shape
 * fails a test instead of type-checking quietly.
 */
describe('the pinned package', () => {
  it('exports the splitter as its default and nothing else', async () => {
    const pkg: Record<string, unknown> = await import('sentencex');
    expect(typeof pkg.default).toBe('function');
    // 1.0.31 had a named `segment` and a `get_sentence_boundaries`; 0.4.2 has
    // neither, which is why `import { segment }` was `undefined` at runtime.
    expect(pkg.segment).toBeUndefined();
    expect(pkg.get_sentence_boundaries).toBeUndefined();
  });

  it('returns the sentences as an array of strings', () => {
    const pieces = splitWithSentencex('en', 'One sentence. Another one.');
    expect(Array.isArray(pieces)).toBe(true);
    expect(pieces).toEqual(['One sentence.', 'Another one.']);
    for (const piece of pieces) expect(typeof piece).toBe('string');
  });

  it('drops the whitespace between sentences, which is what locating survives', () => {
    // The property 1.0.31 had and 0.4.2 does not. Nothing here may depend on it.
    expect(splitWithSentencex('en', 'One. Two.').join('')).toBe('One.Two.');
    expect(segmentBlock('One. Two.', 'en', options).map((u) => [u.spans[0].start, u.spans[0].end])).toEqual([
      [0, 4],
      [5, 9],
    ]);
  });

  it('never throws on a language it does not know, however the tag is shaped', () => {
    // 0.4.2 knows 29 languages and falls back through its own fallbacks.json to
    // English. `ro` and `zh` are both among the ones that fall back.
    for (const tag of ['ro', 'zh', 'xx', '', 'und', 'mul', 'en-US']) {
      expect(splitWithSentencex(tag, 'One sentence. Another one.')).toEqual(['One sentence.', 'Another one.']);
    }
  });
});

describe('the language is a parameter, never sniffed', () => {
  /**
   * ADR 0006 keeps `eld` and its two megabytes out because an EPUB declares its
   * own `dc:language`. That only pays off if the parameter does something, so
   * here is a case where it decides the answer: the Greek question mark ends a
   * sentence in `el` and does not in `en`.
   */
  it('splits Greek on the Greek question mark only when told the text is Greek', () => {
    const text = 'Τι κάνεις; Είμαι καλά.';
    expect(segmentBlock(text, 'el', options).map((u) => u.text)).toEqual(['Τι κάνεις;', 'Είμαι καλά.']);
    expect(segmentBlock(text, 'en', options).map((u) => u.text)).toEqual([text]);
  });

  it('hands the language through untouched, whatever shape the tag is in', () => {
    const seen: string[] = [];
    const record: SplitSentences = (language, text) => {
      seen.push(language);
      return [text];
    };
    for (const tag of ['en', 'en-US', 'zh-Hans', 'ro', '']) segmentBlock('Text.', tag, { splitSentences: record });
    expect(seen).toEqual(['en', 'en-US', 'zh-Hans', 'ro', '']);
  });
});

describe('the cap of last resort', () => {
  /**
   * Off unless asked for. An utterance is one sentence, and a cap that fired on
   * ordinary prose would be a silent rewrite of the document.
   */
  it('does nothing by default, however long the Block is', () => {
    const text = 'word '.repeat(2000).trim();
    expect(segmentBlock(text, 'en', options)).toHaveLength(1);
  });

  it('cuts a Block with no terminator on whitespace', () => {
    const text = 'alpha bravo charlie delta echo foxtrot golf hotel';
    const utterances = segmentBlock(text, 'en', { ...options, maxLength: 20 });
    expect(utterances.map((u) => u.text)).toEqual(['alpha bravo charlie', 'delta echo foxtrot', 'golf hotel']);
    for (const [start, end] of offsets(utterances)) expect(end - start).toBeLessThanOrEqual(20);
    checkSpans(utterances, [{ text }]);
  });

  /**
   * A Chinese paragraph punctuated only with `，` is one sentence to
   * `sentencex` and has no whitespace to cut on. There is no word segmenter
   * available on Hermes either — `unicode-segmenter`'s `Intl.Segmenter` adapter
   * throws for `granularity: 'word'` — so the cut falls on a grapheme cluster,
   * which at least never lands inside a character.
   */
  it('cuts a script written without spaces on a grapheme boundary', () => {
    const text = '第二句话稍微长一些，用来观察每个汉字的时间标记';
    const utterances = segmentBlock(text, 'zh', { ...options, maxLength: 10 });
    expect(utterances.map((u) => u.text)).toEqual(['第二句话稍微长一些，', '用来观察每个汉字的时', '间标记']);
    checkSpans(utterances, [{ text }]);
  });

  it('leaves a single cluster longer than the cap whole rather than splitting a character', () => {
    const text = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}';
    expect(segmentBlock(text, 'en', { ...options, maxLength: 2 }).map((u) => u.text)).toEqual([text]);
  });
});
