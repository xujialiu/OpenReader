/**
 * The Voice list, as two levels (ADR 0020), named and ordered as the desktop
 * plugin's are (#232, ADR 0081).
 *
 * The picker is provider → Language → Voice, and the middle level is the reason
 * this file exists. Two of the six Providers do not have one: Fish Audio,
 * Speechify and Azure report a locale per Voice, and Kokoro's comes from the
 * first letter of its Voice id (ADR 0020), while OpenAI and an OpenAI Compatible
 * server report `MULTILINGUAL` for every one of theirs — a voice that speaks
 * whatever it is given.
 *
 * So the level is built either way, and where a Provider has no locale it is **one
 * entry reading "Multilingual"**. The alternative was to skip the level for those
 * Providers, which would have made the picker one screen shallower for two of them
 * than for the other four, so that choosing a Voice was a different act
 * depending on who was speaking. One extra tap on the Providers that cannot answer
 * the question is the cheaper half of that trade.
 *
 * Platform-free, like `settings.ts` and `segment.ts` beside it, and for the same
 * reason: what it decides is testable and what the sheet draws is not
 * (`test/README.md`).
 */

import { localeName } from '../core/locale-names';
import { MULTILINGUAL, type VoiceInfo } from '../core/providers/types';

/** What the level of Voices that speak any language is called (CONTEXT.md). The one place the word is written. */
export const MULTILINGUAL_LABEL = 'Multilingual';

/** One level of the picker: a locale, and the Voices in it. */
export interface VoiceLevel {
  /**
   * The locale as the Provider reported it, or `MULTILINGUAL`. The key, never the
   * label: two Providers spell `en-US` the same way and neither spells it the way
   * a person reads it.
   */
  locale: string;
  /** What the level shows: the language's English name, or "Multilingual" where there is none. */
  label: string;
  /** The Voices in it, by name. */
  voices: readonly VoiceInfo[];
}

/**
 * The desktop plugin's `compareVoiceLabels`: Chinese collation, which puts Han
 * before Latin and orders it by pinyin (晓…, 云…, then A…Z) instead of by code
 * point somewhere after Z; numbers by value; case and accents ignored. Hermes's
 * `Intl.Collator` on iOS sorts exactly as Node's (ADR 0081); a runtime without
 * `Intl` falls back to code points, as the plugin's does.
 */
const collator = typeof Intl !== 'undefined' && typeof Intl.Collator === 'function' ? new Intl.Collator(['zh', 'en'], { numeric: true, sensitivity: 'base' }) : null;

export function compareLabels(a: string, b: string): number {
  if (collator) return collator.compare(a, b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The tag up to its first hyphen: `en` for `en-US`, `zh` for `zh-Hans-CN`. */
function baseLanguage(locale: string): string {
  return locale.replace(/-.*$/, '');
}

/**
 * Each locale's name, as the plugin's `dropdownLabels` writes it: with its
 * region (and script) only where the list holds its language under more than
 * one locale. Kokoro's `en-US` and `en-GB` read `English (United States)` and
 * `English (United Kingdom)`; its lone `ja-JP` reads `Japanese`.
 *
 * **Unlike the plugin, no two locales are merged.** It files Azure's `zh-CN`,
 * `zh-HK` and `zh-TW` under one `Chinese` because Zotero's own dropdown does
 * (xujialiu/Zotero-OpenReader#223); here they stay three, so a Cantonese Voice
 * is not hidden among Mandarin ones by a name that cannot tell them apart.
 */
function levelLabels(locales: readonly string[]): Map<string, string> {
  const count = new Map<string, number>();
  for (const locale of locales) count.set(baseLanguage(locale), (count.get(baseLanguage(locale)) ?? 0) + 1);
  return new Map(locales.map((locale) => {
    if (locale === MULTILINGUAL) return [locale, MULTILINGUAL_LABEL];
    return [locale, localeName((count.get(baseLanguage(locale)) ?? 0) > 1 ? locale : baseLanguage(locale))];
  }));
}

/**
 * A Provider's Voices, grouped into the levels a picker shows.
 *
 * `MULTILINGUAL` sorts first and the rest by name, and the Voices in each level
 * by name too (`compareLabels`), as the plugin sorts them. The owner chose that
 * over the Provider's own order (#232): Speechify's 992 Voices and Azure's 691
 * arrive in no order a person can search a menu by.
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

  const labels = levelLabels([...byLocale.keys()]);
  return [...byLocale.entries()]
    .map(([locale, list]) => ({
      locale,
      label: labels.get(locale) ?? locale,
      // Stable: Voices of the same name keep the order the Provider gave them.
      voices: [...list].sort((a, b) => compareLabels(a.label, b.label)),
    }))
    .sort((a, b) => {
      // The level that is not a language goes first, where it is either the only
      // one or the answer for a Voice that speaks anything.
      const multilingual = Number(b.locale === MULTILINGUAL) - Number(a.locale === MULTILINGUAL);
      return multilingual || compareLabels(a.label, b.label) || (a.locale < b.locale ? -1 : a.locale > b.locale ? 1 : 0);
    });
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
 * a caption can use a previously remembered name without another request
 * (ADR 0026). Internal ids are no longer shown as captions.
 */
export function voiceInList(voices: readonly VoiceInfo[] | null | undefined, id: string): VoiceInfo | null {
  if (!voices || !id) return null;
  return voices.find((one) => one.id === id) ?? null;
}

/**
 * The level a Voice id is in, or null.
 *
 * So that the picker opens showing the Voice in use rather than at the top of a
 * list of a hundred and fifty Languages — the same reason the contents list opens at the
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
