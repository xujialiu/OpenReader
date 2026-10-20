import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import esmSegment from 'sentencex';
// @ts-expect-error -- the pinned package has no declarations for its readable source.
import sourceLanguages from '../../../node_modules/sentencex/src/languages/index.js';
import { segmentDocument } from '../../../src/app/segment';
import { sectionChapters } from '../../../src/offline/model';
import type { SplitSentences } from '../../../src/core/segmenter/sentences';

const cjsSegment: SplitSentences = createRequire(import.meta.url)('sentencex');
// These examples use concrete rules, plus zh's English fallback. Avoid the source
// entry's obsolete JSON import assertion, which current Node cannot execute.
const sourceSegment: SplitSentences = (language, text) => new (sourceLanguages[language] ?? sourceLanguages.en)().segment(text);
const reading: SplitSentences = (language, text) => segmentDocument([{ text }], language).map((u) => u.text);
const download: SplitSentences = (language, text) => sectionChapters(0, [{ text }], [], language).flatMap((c) => c.texts);

type Example = [language: string, text: string, expected: string[]];
const cjk: Example[] = [
  ['zh', '这是第一句。2024年发生了很多事。', ['这是第一句。', '2024年发生了很多事。']],
  ['zh', '他喜欢苹果。iPhone也不错。', ['他喜欢苹果。', 'iPhone也不错。']],
  ['ja', 'これは文です。3月に行きます。', ['これは文です。', '3月に行きます。']],
  ['zh', '数值是1.25。3个人来了！iPhone呢？2024年买的。', ['数值是1.25。', '3个人来了！', 'iPhone呢？', '2024年买的。']],
];
const english: Example[] = [
  ['en', 'She said no. He left the room.', ['She said no.', 'He left the room.']],
  ['en', 'He looked at me. I smiled.', ['He looked at me.', 'I smiled.']],
  ['en', 'He was a tall man. She was short.', ['He was a tall man.', 'She was short.']],
  ['en', 'It was the month of May. Then came June.', ['It was the month of May.', 'Then came June.']],
  ['en', 'He is ill. She is well.', ['He is ill.', 'She is well.']],
  ['en', 'Freud wrote about the id. The ego is fine.', ['Freud wrote about the id.', 'The ego is fine.']],
  ['en', 'It is a work of art. Nobody objected.', ['It is a work of art.', 'Nobody objected.']],
  ['en', 'Did you go? No. I stayed.', ['Did you go?', 'No.', 'I stayed.']],
  ...['arc', 'ark', 'con', 'fed', 'fig', 'mar', 'mass', 'miss', 'ok', 'ore', 'pa', 'rep', 'wash'].map((word): Example =>
    ['en', `The final word is ${word}. Mary spoke next.`, [`The final word is ${word}.`, 'Mary spoke next.']]),
];
const ellipses: Example[] = [
  ['en', 'I was thinking... maybe we should go. Then we left.', ['I was thinking... maybe we should go.', 'Then we left.']],
  ['en', 'I wonder . . . if he knows. Next.', ['I wonder . . . if he knows.', 'Next.']],
  ['en', 'Go...on.', ['Go...on.']],
  ['en', 'Go. . . on.', ['Go. . . on.']],
  ['en', 'Go.\t.\t. on.', ['Go.\t.\t. on.']],
  ['en', 'Go...\non.', ['Go...\non.']],
  ['en', 'What?! he asked. Nothing.', ['What?! he asked.', 'Nothing.']],
  ['en', 'Wait!! not yet. Then go.', ['Wait!! not yet.', 'Then go.']],
  ['fr', 'Je pensais... peut-être partir. Puis nous sommes partis.', ['Je pensais... peut-être partir.', 'Puis nous sommes partis.']],
  ['fr', 'Je pensais... être ailleurs. Puis il partit.', ['Je pensais... être ailleurs.', 'Puis il partit.']],
  ['es', 'Estaba pensando... quizá salir. Luego salió.', ['Estaba pensando... quizá salir.', 'Luego salió.']],
  // Already green in the diagnostic run: do not claim this was broken.
  ['de', 'Ich dachte... vielleicht gehen wir. Dann gingen wir.', ['Ich dachte... vielleicht gehen wir.', 'Dann gingen wir.']],
];
const controls: Example[] = [
  ['zh', '甲。乙。', ['甲。', '乙。']],
  ['zh', '甲。Ａ。', ['甲。', 'Ａ。']],
  ['zh', '他说：“甲。1。”然后走了。', ['他说：“甲。1。”然后走了。']],
  ['zh', '他说（甲。1。）然后走了。', ['他说（甲。1。）然后走了。']],
  ['en', 'She said yes. He left.', ['She said yes.', 'He left.']],
  ['en', 'Dr. Smith arrived. He sat down.', ['Dr. Smith arrived.', 'He sat down.']],
  ['en', 'Mr. and Mrs. Smith arrived. They sat down.', ['Mr. and Mrs. Smith arrived.', 'They sat down.']],
  ['en', 'J. R. R. Tolkien wrote it. He did.', ['J. R. R. Tolkien wrote it.', 'He did.']],
  ['en', 'No. 5 is here. We saw it.', ['No. 5 is here.', 'We saw it.']],
  ['en', 'See Art. IV and Fig. 3 for details. It is clear.', ['See Art. IV and Fig. 3 for details.', 'It is clear.']],
  ['en', 'May. 5 was cold. June was warmer.', ['May. 5 was cold.', 'June was warmer.']],
  ['en', 'Rep. Smith spoke. Miss. Jones listened.', ['Rep. Smith spoke.', 'Miss. Jones listened.']],
  ['en', 'The Mass. General Hospital report arrived. We read it.', ['The Mass. General Hospital report arrived.', 'We read it.']],
  ['en', 'The Wash. Post covered it. They agreed.', ['The Wash. Post covered it.', 'They agreed.']],
  ['en', 'Ark. State won. They celebrated.', ['Ark. State won.', 'They celebrated.']],
  ['en', 'She went to Mass. Then she left.', ['She went to Mass.', 'Then she left.']],
  ['en', 'They said no. perhaps not.', ['They said no. perhaps not.']],
  ['en', 'It cost $3.50. She paid.', ['It cost $3.50.', 'She paid.']],
  ['en', 'Really?! I had no idea. Amazing.', ['Really?!', 'I had no idea.', 'Amazing.']],
  ['en', 'Wait... Then go.', ['Wait...', 'Then go.']],
  ['en', 'Wait… what happened? Nothing.', ['Wait… what happened?', 'Nothing.']],
  ['en', '“I was thinking... maybe,” she said. Then we left.', ['“I was thinking... maybe,” she said.', 'Then we left.']],
  ['de', 'Er wurde am 3. Oktober geboren. Dann zog er um.', ['Er wurde am 3. Oktober geboren.', 'Dann zog er um.']],
];

for (const [name, split] of Object.entries({ Reading: reading, Download: download, ESM: esmSegment, CJS: cjsSegment, source: sourceSegment })) {
  describe(name, () => {
    for (const [issue, examples] of [['#240', cjk], ['#245', english], ['#241', ellipses], ['controls', controls]] as const) {
      describe(issue, () => {
        it.each(examples)('%s: %s', (language, text, expected) => expect(split(language, text)).toEqual(expected));
      });
    }
    it('cuts all three CJK terminators before each ASCII digit and lowercase letter (#240)', () => {
      for (const language of ['zh', 'ja']) for (const end of ['。', '！', '？']) for (const next of '0123456789abcdefghijklmnopqrstuvwxyz') {
        const first = `甲${end}`;
        const second = `${next}乙。`;
        expect(split(language, first + second)).toEqual([first, second]);
      }
    });
  });
}

describe('source coordinates survive changed sentence boundaries', () => {
  it.each([
    ['zh', '😀甲。2024年乙。', ['😀甲。', '2024年乙。']],
    ['en', 'I was thinking... maybe e\u0301 is right. Then we left.', ['I was thinking... maybe e\u0301 is right.', 'Then we left.']],
    ['en', 'She said no. She said no.', ['She said no.', 'She said no.']],
  ] satisfies Example[])('%s: %s', (language, text, expected) => {
    const utterances = segmentDocument([{ text }], language);
    expect(utterances.map((u) => u.text)).toEqual(expected);
    let end = 0;
    for (const u of utterances) {
      expect(u.spans).toHaveLength(1);
      const span = u.spans[0];
      expect(span.start).toBeGreaterThanOrEqual(end);
      expect(text.slice(end, span.start).trim()).toBe('');
      expect(text.slice(span.start, span.end)).toBe(u.text);
      expect(/^\p{M}/u.test(u.text)).toBe(false);
      end = span.end;
    }
    expect(text.slice(end).trim()).toBe('');
  });
});
