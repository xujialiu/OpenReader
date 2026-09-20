import { describe, expect, it } from 'vitest';

import { levelOfVoice, MULTILINGUAL_LABEL, voiceInList, voiceLevels } from '../../src/app/voices';
import { MULTILINGUAL, type VoiceInfo } from '../../src/core/providers/types';

/**
 * The middle level of the Voice picker (ADR 0020).
 *
 * Half the Providers report a real locale per Voice and half report none, and the
 * decision is that the level exists either way — one entry reading "multilingual"
 * where there is nothing to group by — so that choosing a Voice is the same act
 * whoever is speaking. A picker that skipped the level for three Providers and kept
 * it for two would be two pickers.
 */

const voice = (id: string, locale: string, label = id): VoiceInfo => ({ id, label, locale });

describe('voiceLevels', () => {
  it('gives a Provider with no locale one level, and it reads multilingual', () => {
    // OpenAI's eleven names, every one of them `mul` (`openai.ts`). The level is the
    // shape of the picker, not a claim about the voices.
    const levels = voiceLevels([voice('alloy', MULTILINGUAL), voice('echo', MULTILINGUAL)]);
    expect(levels).toHaveLength(1);
    expect(levels[0].locale).toBe(MULTILINGUAL);
    expect(levels[0].label).toBe(MULTILINGUAL_LABEL);
    expect(levels[0].voices.map((one) => one.id)).toEqual(['alloy', 'echo']);
  });

  it('groups a Provider that reports locales by locale, and labels each with its own', () => {
    const levels = voiceLevels([voice('a', 'en-US'), voice('b', 'zh-CN'), voice('c', 'en-US')]);
    expect(levels.map((level) => [level.label, level.voices.map((one) => one.id)])).toEqual([
      ['en-US', ['a', 'c']],
      ['zh-CN', ['b']],
    ]);
  });

  it('keeps the Provider’s own order inside a level while sorting the levels itself', () => {
    // The line between the two: the grouping is ours, so its order is ours to
    // choose; the order of Voices within a group is what the server said, and
    // Speechify paginates while Fish merges up to three sources. Reordering either
    // would be a quiet rewrite of the answer.
    const levels = voiceLevels([voice('z', 'zh-CN'), voice('second', 'en-US'), voice('first', 'en-US')]);
    expect(levels.map((level) => level.locale)).toEqual(['en-US', 'zh-CN']);
    expect(levels[0].voices.map((one) => one.id)).toEqual(['second', 'first']);
  });

  it('puts the level that is not a language first, where it is the only one or the one for a Voice that speaks anything', () => {
    const levels = voiceLevels([voice('a', 'zh-CN'), voice('b', MULTILINGUAL), voice('c', 'en-US')]);
    expect(levels.map((level) => level.locale)).toEqual([MULTILINGUAL, 'en-US', 'zh-CN']);
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
