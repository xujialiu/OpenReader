import { describe, expect, it } from 'vitest';

import { levelOfVoice, MULTILINGUAL_LABEL, voiceInList, voiceLevels } from '../../src/app/voices';
import { MULTILINGUAL, type VoiceInfo } from '../../src/core/providers/types';

/**
 * The middle level of the Voice picker (ADR 0020), named and ordered as the
 * desktop plugin's (#232, ADR 0081).
 *
 * Half the Providers report a real locale per Voice and half report none, and the
 * decision is that the level exists either way — one entry reading "Multilingual"
 * where there is nothing to group by — so that choosing a Voice is the same act
 * whoever is speaking. A picker that skipped the level for three Providers and kept
 * it for two would be two pickers.
 */

const voice = (id: string, locale: string, label = id): VoiceInfo => ({ id, label, locale });

describe('voiceLevels', () => {
  it('gives a Provider with no locale one level, and it reads Multilingual', () => {
    // OpenAI's eleven names, every one of them `mul` (`openai.ts`). The level is the
    // shape of the picker, not a claim about the voices.
    const levels = voiceLevels([voice('alloy', MULTILINGUAL), voice('echo', MULTILINGUAL)]);
    expect(levels).toHaveLength(1);
    expect(levels[0].locale).toBe(MULTILINGUAL);
    expect(levels[0].label).toBe(MULTILINGUAL_LABEL);
    expect(MULTILINGUAL_LABEL).toBe('Multilingual');
    expect(levels[0].voices.map((one) => one.id)).toEqual(['alloy', 'echo']);
  });

  it('groups a Provider that reports locales by locale, and names each in full', () => {
    const levels = voiceLevels([voice('a', 'en-US'), voice('b', 'zh-CN'), voice('c', 'en-US')]);
    expect(levels.map((level) => [level.label, level.voices.map((one) => one.id)])).toEqual([
      ['Chinese', ['b']],
      ['English', ['a', 'c']],
    ]);
  });

  it('names a region only where the list has the language in more than one, as the desktop plugin does (#232)', () => {
    // Kokoro's nine (`localeForKokoroVoice`): English twice, everything else once.
    const levels = voiceLevels(['en-US', 'en-GB', 'zh-CN', 'ja-JP', 'es-ES', 'fr-FR', 'hi-IN', 'it-IT', 'pt-BR'].map((locale) => voice(locale, locale)));
    expect(levels.map((level) => level.label)).toEqual([
      'Chinese', 'English (United Kingdom)', 'English (United States)', 'French', 'Hindi', 'Italian', 'Japanese', 'Portuguese', 'Spanish',
    ]);
    // Fish: a bare `en` beside the regions it files English Voices under.
    expect(voiceLevels([voice('a', 'en'), voice('b', 'en-GB')]).map((level) => level.label)).toEqual(['English', 'English (United Kingdom)']);
  });

  it('keeps every Chinese region a level of its own, unlike the desktop plugin (#232)', () => {
    // Azure's Cantonese (zh-HK) Voices would otherwise sit among the Mandarin ones
    // under one "Chinese", with local names (曉曼, 晓晓) that do not say which is which.
    const levels = voiceLevels([voice('a', 'zh-CN'), voice('b', 'zh-HK'), voice('c', 'zh-TW'), voice('d', 'zh-CN-sichuan')]);
    // Compared by locale: where `, SICHUAN)` falls against `)` is the collator's
    // business, and Hermes's need not agree with Node's.
    expect(levels.map((level) => [level.locale, level.label]).sort(([a], [b]) => (a < b ? -1 : 1))).toEqual([
      ['zh-CN', 'Chinese (China)'],
      ['zh-CN-sichuan', 'Chinese (China, SICHUAN)'],
      ['zh-HK', 'Chinese (Hong Kong SAR China)'],
      ['zh-TW', 'Chinese (Taiwan)'],
    ]);
  });

  it('sorts the Voices of a level by name: Han by pinyin before Latin, numbers by value, case ignored (#232)', () => {
    // The plugin's `compareVoiceLabels`. The owner chose it over the Provider's
    // order, which for Speechify and Azure is no order a menu can be searched by.
    const levels = voiceLevels([
      voice('1', 'zh', 'Voice 10'), voice('2', 'zh', '晓晓'), voice('3', 'zh', 'aria'), voice('4', 'zh', '云希'), voice('5', 'zh', 'Voice 9'), voice('6', 'zh', 'Brian'),
    ]);
    expect(levels[0].voices.map((one) => one.label)).toEqual(['晓晓', '云希', 'aria', 'Brian', 'Voice 9', 'Voice 10']);
  });

  it('keeps the Provider’s order between Voices of the same name', () => {
    const levels = voiceLevels([voice('second', 'en-US', 'Ava'), voice('first', 'en-US', 'Ava')]);
    expect(levels[0].voices.map((one) => one.id)).toEqual(['second', 'first']);
  });

  it('puts the level that is not a language first, where it is the only one or the one for a Voice that speaks anything', () => {
    const levels = voiceLevels([voice('a', 'zh-CN'), voice('b', MULTILINGUAL), voice('c', 'en-US')]);
    expect(levels.map((level) => level.locale)).toEqual([MULTILINGUAL, 'zh-CN', 'en-US']);
    expect(levels[0].label).toBe('Multilingual');
  });

  it('shows a locale it cannot read as the Provider sent it', () => {
    expect(voiceLevels([voice('a', 'en_US')]).map((level) => level.label)).toEqual(['en_US']);
  });

  it('puts a Voice with no locale at all into the multilingual level rather than into one headed by nothing', () => {
    // The two Providers that *derive* a locale — Kokoro from a name prefix, a
    // compatible server from nothing — are the ones that can produce this, and a row
    // headed by the empty string is a row nobody can read.
    const levels = voiceLevels([voice('a', ''), voice('b', '   '), voice('c', 'en-US')]);
    expect(levels.map((level) => [level.locale, level.voices.map((one) => one.id)])).toEqual([
      [MULTILINGUAL, ['a', 'b']],
      ['en-US', ['c']],
    ]);
  });

  it('has no levels for a Provider that published no Voices', () => {
    expect(voiceLevels([])).toEqual([]);
  });
});

describe('levelOfVoice', () => {
  const levels = voiceLevels([voice('a', 'en-US'), voice('b', 'zh-CN')]);

  it('says which level holds the Voice in use, so the picker opens showing it', () => {
    expect(levelOfVoice(levels, 'b')).toBe('zh-CN');
  });

  it('says nothing for a Voice this Provider does not publish, which is the ordinary case for another Provider’s', () => {
    expect(levelOfVoice(levels, 'c')).toBeNull();
    expect(levelOfVoice(levels, '')).toBeNull();
  });
});

/**
 * And the Voice a line above the play button can name (design 0020).
 *
 * That line rendered `settings.voice` — `Fish Audio · zh/74c6aba5cbf94a15bbdc547ffce5cb38`,
 * a provider's internal id, while the sheet three taps away knew the Voice as
 * 「语彤 Yutong - Female Mandarin (Mainland)」 (notes/NOTES_2026-09-20.md, 07:14).
 * Design 0020 promises "the service that is reading and the voice it is reading
 * with", and a 32-character hex string is not the name of anything.
 */
describe('voiceInList', () => {
  const listed = [voice('zh/74c6', 'zh', '语彤 Yutong - Female Mandarin (Mainland)'), voice('en/9a1b', 'en', 'Aiden')];

  it('finds the Voice a Provider published under this id, with its own name and locale', () => {
    expect(voiceInList(listed, 'zh/74c6')).toEqual({ id: 'zh/74c6', label: '语彤 Yutong - Female Mandarin (Mainland)', locale: 'zh' });
  });

  it('answers null before a list has been asked for, which is not the same as a Voice that is gone', () => {
    // A Voice list is a request against the owner's account, so nothing fetches one
    // to complete a caption (philosophy rule 4) — the screen shows the id until the
    // owner opens the sheet, and both cases arrive here as null.
    expect(voiceInList(null, 'zh/74c6')).toBeNull();
    expect(voiceInList(undefined, 'zh/74c6')).toBeNull();
    expect(voiceInList(listed, 'zh/nothing-like-it')).toBeNull();
  });

  it('answers null for no Voice chosen, rather than the first one in the list', () => {
    expect(voiceInList(listed, '')).toBeNull();
  });
});
