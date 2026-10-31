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
// #183: a bracket group with a sentence end inside it stays one sentence, so
// the bracket stripper finds both of its brackets. The shapes are from real
// books (Cultivation Online, My Vampire System) and the issue.
const bracketGroups: Example[] = [
  ['en', '<Level Up!>', ['<Level Up!>']],
  ['en', '<You have absorbed enough Qi for a breakthrough!>', ['<You have absorbed enough Qi for a breakthrough!>']],
  ['en', '<Congratulations! You have subdued the Silent Rippers!>', ['<Congratulations! You have subdued the Silent Rippers!>']],
  ['en', '< Would you like to activate? >', ['< Would you like to activate? >']],
  ['en', '<Quest complete!> <Reward: 100 gold.>', ['<Quest complete!> <Reward: 100 gold.>']],
  ['en', '[Unique Ability(2): Requires level 3 to activate. Deals more damage.]', ['[Unique Ability(2): Requires level 3 to activate. Deals more damage.]']],
  ['en', '[10 points spent. [Haste] obtained.]', ['[10 points spent. [Haste] obtained.]']],
  ['zh', '【恭喜你升级了。】', ['【恭喜你升级了。】']],
  ['zh', '〖叮！任务完成。〗他笑了。', ['〖叮！任务完成。〗他笑了。']],
];
// #244: an opening bracket closes only on its own kind, and a spaced or
// letter-flanked `<` is a sign, as the bracket stripper reads it.
const openersOfTheirOwnKind: Example[] = [
  ['en', 'We know that x < 5. This holds in all cases. See equation (1).', ['We know that x < 5.', 'This holds in all cases.', 'See equation (1).']],
  ['en', 'Press <Enter> to continue. Then wait. (See manual.)', ['Press <Enter> to continue.', 'Then wait.', '(See manual.)']],
  ['en', '<Quest complete!> You gained a level. You feel stronger. [Level Up!]', ['<Quest complete!> You gained a level.', 'You feel stronger.', '[Level Up!]']],
  ['en', 'A (note. Another. Third] here.', ['A (note.', 'Another.', 'Third] here.']],
  ['en', 'If x<y holds. Then x>z holds. Done.', ['If x<y holds.', 'Then x>z holds.', 'Done.']],
  ['en', 'Keep x < 5 and y > 3. Then stop. Done.', ['Keep x < 5 and y > 3.', 'Then stop.', 'Done.']],
];
// #243: an inch mark or a word-initial apostrophe is not a quotation mark.
const notQuotationMarks: Example[] = [
  ['en', 'He measured 5" of rain. Then it stopped. A 6" pipe. Done.', ['He measured 5" of rain.', 'Then it stopped.', 'A 6" pipe.', 'Done.']],
  ['en', '"Hey, kid" The man was around 1,77 metres (5’6" tall). He had blonde hair. "What’s your name?"', ['"Hey, kid" The man was around 1,77 metres (5’6" tall).', 'He had blonde hair.', '"What’s your name?"']],
  ['en', "He gave 'em what for. Then he ran. It's done. Stop.", ["He gave 'em what for.", 'Then he ran.', "It's done.", 'Stop.']],
  ['en', "Music was better in the '90s. Then it changed. It's sad.", ["Music was better in the '90s.", 'Then it changed.', "It's sad."]],
  ['en', "He said 'Tis late. Then he left. It's over.", ["He said 'Tis late.", 'Then he left.', "It's over."]],
];
// Quotations the #243 change must leave as they were.
const quotations: Example[] = [
  ['en', '"Fine. Go." He went.', ['"Fine. Go." He went.']],
  ['en', '"I’m feeling a "but" incoming." Morok sighed.', ['"I’m feeling a "but" incoming." Morok sighed.']],
  ['en', "She said 'go home. Now.' Then she left.", ["She said 'go home. Now.' Then she left."]],
  ['en', '"I was born in 1990" he said. Then he left.', ['"I was born in 1990" he said.', 'Then he left.']],
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
    for (const [issue, examples] of [
      ['#240', cjk], ['#245', english], ['#241', ellipses], ['#183', bracketGroups], ['#244', openersOfTheirOwnKind],
      ['#243', notQuotationMarks], ['#243 quotations', quotations], ['controls', controls],
    ] as const) {
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
