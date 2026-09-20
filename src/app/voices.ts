/**
 * The Voice list, as two levels (ADR 0020).
 *
 * The picker is provider → locale → Voice, and the middle level is the reason this
 * file exists. Half the Providers do not have one: measured in ADR 0020, Speechify
 * and Fish Audio report a real locale per Voice, while OpenAI, any
 * OpenAI-compatible server and Kokoro report `MULTILINGUAL` for every one of
 * theirs — a voice that speaks whatever it is given.
 *
 * So the level is built either way, and where a Provider has no locale it is **one
 * entry reading "multilingual"**. The alternative was to skip the level for those
 * Providers, which would have made the picker two screens deep for two of them and
 * one screen deep for three, so that choosing a Voice was a different act
 * depending on who was speaking. One extra tap on the Providers that cannot answer
 * the question is the cheaper half of that trade.
 *
 * Platform-free, like `settings.ts` and `segment.ts` beside it, and for the same
 * reason: what it decides is testable and what the sheet draws is not
 * (`test/README.md`).
 */

import { MULTILINGUAL, type VoiceInfo } from '../core/providers/types';

/** What a locale with no locale in it is called. The one place the word is written. */
export const MULTILINGUAL_LABEL = 'multilingual';

/** One level of the picker: a locale, and the Voices in it. */
export interface VoiceLevel {
  /**
   * The locale as the Provider reported it, or `MULTILINGUAL`. The key, never the
   * label: two Providers spell `en-US` the same way and neither spells it the way
   * a person reads it.
   */
  locale: string;
  /** What the level shows — the locale itself, or "multilingual" where there is none. */
  label: string;
  /** The Voices in it, **in the order the Provider reported them**. */
  voices: readonly VoiceInfo[];
}

/**
 * A Provider's Voices, grouped into the levels a picker shows.
 *
 * `MULTILINGUAL` sorts first and the rest ascend by locale. Two different rules in
 * one line, and the line between them is which side reported the thing: the
 * **grouping is ours**, so its order is ours to choose, and the order of Voices
 * *within* a level is the Provider's own and is left exactly as it arrived —
 * Speechify paginates and Fish merges up to three sources, and reordering what
 * either said would be a quiet rewrite of it (philosophy rule 1's habit, applied
 * to something small).
 *
 * A Voice whose locale is missing, empty or not a string joins the multilingual
 * level rather than making a level of its own. That is not tidiness: the two
 * Providers that derive a locale rather than being told one — Kokoro from a name
 * prefix, a compatible server from nothing at all — are exactly the ones that can
 * produce it, and a level headed by the empty string is a row a person cannot read.
 */
export function voiceLevels(voices: readonly VoiceInfo[]): readonly VoiceLevel[] {
  const byLocale = new Map<string, VoiceInfo[]>();
  for (const voice of voices) {
    const locale = typeof voice?.locale === 'string' && voice.locale.trim() ? voice.locale : MULTILINGUAL;
    const found = byLocale.get(locale);
    if (found) found.push(voice);
    else byLocale.set(locale, [voice]);
  }

  return [...byLocale.keys()]
    .sort((a, b) => {
      if (a === b) return 0;
      // The level that is not a language goes first, where it is either the only
      // one or the answer for a Voice that speaks anything.
      if (a === MULTILINGUAL) return -1;
      if (b === MULTILINGUAL) return 1;
      return a < b ? -1 : 1;
    })
    .map((locale) => ({
      locale,
      label: locale === MULTILINGUAL ? MULTILINGUAL_LABEL : locale,
      voices: byLocale.get(locale)!,
    }));
}

/**
 * The Voice a list calls by this id, or null.
 *
 * The one lookup between an id and the two things a reader can read — the Voice's
 * own name and its locale — and it is here rather than written out at the screen
 * because the player's line and the sheet's rows must not disagree about which
 * Voice `settings.voice` names. Null is ordinary and means only that no list
 * holding it has been asked for: a Voice list is a request against the owner's
 * account (philosophy rule 4), so nothing fetches one to complete a caption, and
 * the screen shows the id until the owner opens the sheet (design 0020 makes the
 * same argument for the locale).
 */
export function voiceInList(voices: readonly VoiceInfo[] | null | undefined, id: string): VoiceInfo | null {
  if (!voices || !id) return null;
  return voices.find((one) => one.id === id) ?? null;
}

/**
 * The level a Voice id is in, or null.
 *
 * So that the picker opens showing the Voice in use rather than at the top of a
 * list of two hundred locales — the same reason the contents list opens at the
 * chapter the reading is in (ADR 0020). Null where the id is in none of them,
 * which is ordinary: the Voice in use belongs to another Provider, or to a list
 * this server no longer publishes.
 */
export function levelOfVoice(levels: readonly VoiceLevel[], voice: string): string | null {
  if (!voice) return null;
  for (const level of levels) {
    if (level.voices.some((one) => one.id === voice)) return level.locale;
  }
  return null;
}
