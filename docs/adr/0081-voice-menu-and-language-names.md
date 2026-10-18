---
status: accepted
---

# The Voice is a menu row, and a Language is named from a table

_The product argument is
[design 0081](../design/0081-the-voice-is-chosen-like-the-provider-and-the-language.md).
Issue #232, and #300 for the names as they now read; the desktop plugin's half
is xujialiu/Zotero-OpenReader#223._

## What was done

**The Voice row.** `VoicePicker` (`src/app/voice-sheet.tsx`) draws a third
`DrawerMenuRow`, `Voice`, over the Voices of the Language shown, in place of the
`FlatList` of `DrawerRow`s. `chosen` is the pending Voice while it is pending,
else the Voice in use when the Provider shown is the one in use; a `chosen`
that is not among the choices names nothing and checks nothing.
`DrawerMenuRow` gained `busy`, which draws `LoadingSpinner` in place of the
`menu` icon. `ChoiceMenu`'s accessibility label is the row's name alone when
nothing is chosen (`Voice`), and `Voice, Ava` otherwise.

**The names.** `voiceLevels` (`src/app/voices.ts`) labels the levels with
`languageNames` (`src/core/locale-names.ts`), which names a Provider's locales
together, because what tells one apart depends on the others of its language
(#300, below). `mul` is `Multilingual`. Levels sort
`Multilingual` first and then by label; the Voices in each level sort by label;
both with `Intl.Collator(['zh', 'en'], { numeric: true, sensitivity: 'base' })`,
the plugin's `compareVoiceLabels`. `Array.prototype.sort` is stable, so two
Voices of one name keep the Provider's order.

**No region merge.** The plugin files a voice under Zotero's
`normalizeLanguage` (`cmn` → `zh`; `zh-CN`, `zh-HK`, `zh-TW` → `zh`; `ar-XA`,
`ar-SA` → `ar-001`; Zotero 10.0.5 `reader.js:37977`–`38010`). That is Zotero's
dropdown, not a choice the phone has to follow, and the owner declined it: each
locale stays a level.

**`localeName`** answers what
`new Intl.DisplayNames(['en'], { type: 'language', languageDisplay: 'standard' }).of(tag)`
answers — `Language (Script, Region, VARIANTS)` — from
`src/core/locale-name-table.ts`, which `scripts/locale-names.mjs` writes from
Node's ICU:

- `LANGUAGES`: every two- and three-letter code ICU canonicalizes to itself and
  names, but `und`, which ICU calls `root`.
- `LANGUAGE_ALIASES`: every two- and three-letter code ICU canonicalizes to
  another tag. The replacement's script and region are added only where the tag
  has none (`sh-RS` is `Serbian (Latin, Serbia)`, `cnr-ME` is
  `Serbian (Montenegro)`), as ICU does.
- `SCRIPTS` and `REGIONS` as they read **inside** a language's name, read out of
  `English (…)`: `Hans` is `Simplified` there and `Simplified Han` alone; the
  numeric `958` is `AA`, the code ICU replaces it with.
- `LIKELY_SCRIPTS`: the script `Intl.Locale#maximize` gives each language, and
  each language and two-letter region whose script differs from it (#300).

Written from ICU 78.2 in Node v22.23.2: 634 languages, 434 aliases, 204
scripts, 630 regions, 688 likely scripts (627 languages and 61 pairs), 51 KB of
source.

`localeName` is no longer what the drawer shows. It stays, held to Node by the
enumeration below, because it is the check that the table `languageNames`
reads is ICU's.

## Amended (#300): a Language's name says only what tells it apart

The owner found ICU's names awkward where Azure sends dialects, Hong Kong and
two scripts of one language, and chose these rules in a grilling round.
`languageNames` groups a Provider's locales by canonical language and, for
each, puts in the parentheses:

- **A dialect** (a variant subtag) by itself, first letter capital, in place of
  the country, always: `zh-CN-liaoning` is `Chinese (Liaoning)` beside
  `zh-CN`, and alone.
- **A script** for every locale of the language once one of them writes a
  script that is not its likely script (`LIKELY_SCRIPTS` for its language and
  region). A locale that writes none takes its likely one: `sr-Latn-RS` and
  `sr-RS` are `Serbian (Latin)` and `Serbian (Cyrillic)`; `sr-Latn-RS` alone is
  `Serbian (Latin)`; `uz-Latn-UZ` alone is `Uzbek`.
- **A country** only where the language's locales hold more than one region,
  no region counting as one; where script and country both tell,
  both: `sr-RS`, `sr-Latn-RS`, `sr-ME` are `Serbian (Cyrillic, Serbia)`,
  `Serbian (Latin, Serbia)`, `Serbian (Latin, Montenegro)`.
- **Shorter words** for three of ICU's, by name so the numeric codes follow:
  `Hong Kong SAR China` → `Hong Kong`, `Macao SAR China` → `Macao`,
  `Unified Canadian Aboriginal Syllabics` → `Syllabics`.

`Wu Chinese` (`wuu-CN`) and `Cantonese` (`yue-CN`) are ICU's names and stay.
Levels still sort by label, so `Chinese (Hong Kong)` falls between
`Chinese (Henan)` and `Chinese (Liaoning)`.

The facts behind it:

- **Azure's text-to-speech locales** (Microsoft Learn, "Language and voice
  support", updated 2026-09-10) are 154, among them six dialects of `zh-CN`:
  `guangxi`, `henan`, `liaoning`, `shaanxi`, `shandong`, `sichuan`, which Azure
  itself names `Chinese (Guangxi Accent Mandarin, Simplified)`,
  `Chinese (Zhongyuan Mandarin Henan, Simplified)`,
  `Chinese (Northeastern Mandarin, Simplified)`,
  `Chinese (Zhongyuan Mandarin Shaanxi, Simplified)`,
  `Chinese (Jilu Mandarin, Simplified)` and
  `Chinese (Southwestern Mandarin, Simplified)`. It names `sr-RS`
  `Serbian (Cyrillic, Serbia)` and `wuu-CN` `Chinese (Wu, Simplified)`. Of the
  154, `languageNames` names 12 differently from the rule it replaced:
  the six dialects, `zh-HK`, `en-HK`, both Serbian and both Inuktitut.
- **ICU's likely scripts would put a script on Chinese.** `maximize` gives
  `zh-CN` Hans and `zh-HK` and `zh-TW` Hant, so counting a script a tag does not
  write would have named Azure's Chinese `Chinese (Simplified, China)` and
  `Chinese (Traditional, Hong Kong)`. Only a written script that is not the
  likely one makes the script tell; `zh-Hant-TW` beside `zh-CN` names none.
- **The plugin still writes ICU's names.** It was asked to follow on
  xujialiu/Zotero-OpenReader#223; until it does, `zh-HK` reads
  `Chinese (Hong Kong)` here and `Chinese (Hong Kong SAR China)` there.

## The facts it was built on

- **`Intl.DisplayNames` is absent on Hermes** (measured below), and a missing
  call fails on the phone alone, while every test passes under Node. ADR 0032
  chose a table when it was still unmeasured (`src/core/language-names.ts`).
  That table is the default `dialect` display (`en-US` is `American English`)
  and covers only the two-letter codes and Fish's English regions; the picker
  needs `standard` and every tag a Provider can send, so it is a second table,
  not an extension.
- **The table is held to Node by enumeration**, not by samples
  (`test/core/locale-names.test.ts`, about 1 s): every two- and three-letter
  code alone and with `-US`, `-001` and `-Latn-CN`; every region with `en-` and
  `zh-`; every script with `sr-`, and one in seven beside `zh-…-TW`; and the
  tags Azure, Fish, Speechify and Kokoro send, `zh-CN-sichuan`, `wuu-CN`,
  `iu-Cans-CA` and `sr-Latn-RS` among them. A newer ICU that names anything
  differently fails it; `node scripts/locale-names.mjs` is the fix.
  `LIKELY_SCRIPTS` is held the same way: every language, alone and with every
  two-letter region, against `maximize` (about 1 s more).
- **Where it parts from ICU**, deliberately, because no Provider sends these:
  a variant ICU has a name for is written in capitals, as ICU writes one it has
  not (`ca-ES-valencia` is `Catalan (Spain, VALENCIA)`, ICU's
  `Catalan (Spain, Valencian)`); a tag with an extension (`zh-CN-u-co-pinyin`)
  comes back unchanged; `und` stays `und`. A tag ICU refuses (`en_US`,
  `zh-yue`) comes back unchanged, as the plugin's `languageDisplayName` returns
  the code when its call throws.
- **Azure's dialects have no ICU name.** `zh-CN-sichuan` is
  `Chinese (China, SICHUAN)` in Node, and so in the plugin; `localeName`
  matches, and the drawer shows `Chinese (Sichuan)` (#300).
- **The list sizes the menu has to carry**: Speechify listed 992 Voices
  (notes/NOTES_2026-09-19.md), Azure 691 in 154 locales
  (notes/NOTES_2026-09-22.md), and Fish's official listing is read up to 20 pages
  of 100 (`fish.ts`, `MAX_PAGES`).
- **Hermes has no `Intl.DisplayNames`, and its `Intl.Collator` sorts as Node's
  does** (notes/NOTES_2026-10-18.md, 13:02, iOS 27.0 simulator):
  `typeof Intl.DisplayNames` is `"undefined"`, so the plugin's call would have
  thrown on the phone. The collator's sort of Fish's 15 Chinese Voice labels in
  Hermes is byte-identical to Node's, Han by pinyin before Latin, and the menu
  showed that order.
- **A menu of 45 Voices opens as fast as a menu of one** (same note, 12:54): Fish's
  largest Language, `English`, painted within about a second of the touch and
  scrolled without a stall. Speechify's and Azure's largest Languages were not
  measured.

## Alternatives

- **`Intl.DisplayNames` at run time**, as the plugin calls it: one line instead
  of a table, and absent on Hermes.
- **Only the locales the Providers send today**, a table of a few hundred
  entries: smaller, but the first new locale a Provider adds would show as a
  code, and nothing would fail to say so.
- **Extending `LANGUAGE_NAMES`**: it is the Fish Language Hint's table, in the
  `dialect` form the plugin's hint uses, and the two must not drift into each
  other.
- **A `FlatList` under the two menus, sorted**: the owner asked for the Voice to
  be chosen as Provider and Language are.
- **For the names (#300)**: keeping the country beside a dialect
  (`Chinese (China, Liaoning)`); Azure's own names
  (`Chinese (Northeastern Mandarin)`), which few readers can place; renaming
  `Wu Chinese` and `Cantonese` to `Chinese (Wu)` and `Chinese (Cantonese)`,
  which would sit by `Chinese (Hong Kong)`, whose Voices also speak Cantonese;
  sorting the dialects after `Chinese (China)` rather than by name, which needs
  an order of its own for one language; and counting likely scripts as well as
  written ones, which names every Chinese Simplified or Traditional.
