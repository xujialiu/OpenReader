---
status: accepted
---

# The Voice is a menu row, and a Language is named from a table

_The product argument is
[design 0081](../design/0081-the-voice-is-chosen-like-the-provider-and-the-language.md).
Issue #232; the desktop plugin's half is xujialiu/Zotero-OpenReader#223._

## What was done

**The Voice row.** `VoicePicker` (`src/app/voice-sheet.tsx`) draws a third
`DrawerMenuRow`, `Voice`, over the Voices of the Language shown, in place of the
`FlatList` of `DrawerRow`s. `chosen` is the pending Voice while it is pending,
else the Voice in use when the Provider shown is the one in use; a `chosen`
that is not among the choices names nothing and checks nothing.
`DrawerMenuRow` gained `busy`, which draws `LoadingSpinner` in place of the
`menu` icon. `ChoiceMenu`'s accessibility label is the row's name alone when
nothing is chosen (`Voice`), and `Voice, Ava` otherwise.

**The names.** `voiceLevels` (`src/app/voices.ts`) labels a level with
`localeName` (`src/core/locale-names.ts`), the region kept only where the list
holds the same base language (the tag up to its first hyphen) under more than
one locale: the plugin's `dropdownLabels`. `mul` is `Multilingual`. Levels sort
`Multilingual` first and then by label; the Voices in each level sort by label;
both with `Intl.Collator(['zh', 'en'], { numeric: true, sensitivity: 'base' })`,
the plugin's `compareVoiceLabels`. `Array.prototype.sort` is stable, so two
Voices of one name keep the Provider's order.

**No region merge.** The plugin files a voice under Zotero's
`normalizeLanguage` (`cmn` → `zh`; `zh-CN`, `zh-HK`, `zh-TW` → `zh`; `ar-XA`,
`ar-SA` → `ar-001`; Zotero 10.0.5 `reader.js:37977`–`38010`). That is Zotero's
dropdown, not a choice the phone has to follow, and the owner declined it: each
locale stays a level. Where `, SICHUAN)` falls against `)` is left to the
collator.

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

Written from ICU 78.2 in Node v22.23.2: 634 languages, 434 aliases, 204
scripts, 630 regions, 39 KB of source.

## The facts it was built on

- **`Intl.DisplayNames` on Hermes is unmeasured**, and a missing call fails on
  the phone alone, while every test passes under Node. ADR 0032 chose a table
  for the same reason (`src/core/language-names.ts`). That table is the
  default `dialect` display (`en-US` is `American English`) and covers only the
  two-letter codes and Fish's English regions; the picker needs `standard` and
  every tag a Provider can send, so it is a second table, not an extension.
- **The table is held to Node by enumeration**, not by samples
  (`test/core/locale-names.test.ts`, about 1 s): every two- and three-letter
  code alone and with `-US`, `-001` and `-Latn-CN`; every region with `en-` and
  `zh-`; every script with `sr-`, and one in seven beside `zh-…-TW`; and the
  tags Azure, Fish, Speechify and Kokoro send, `zh-CN-sichuan`, `wuu-CN`,
  `iu-Cans-CA` and `sr-Latn-RS` among them. A newer ICU that names anything
  differently fails it; `node scripts/locale-names.mjs` is the fix.
- **Where it parts from ICU**, deliberately, because no Provider sends these:
  a variant ICU has a name for is written in capitals, as ICU writes one it has
  not (`ca-ES-valencia` is `Catalan (Spain, VALENCIA)`, ICU's
  `Catalan (Spain, Valencian)`); a tag with an extension (`zh-CN-u-co-pinyin`)
  comes back unchanged; `und` stays `und`. A tag ICU refuses (`en_US`,
  `zh-yue`) comes back unchanged, as the plugin's `languageDisplayName` returns
  the code when its call throws.
- **Azure's dialects have no ICU name.** `zh-CN-sichuan` is
  `Chinese (China, SICHUAN)` in Node, and so in the plugin; the table matches.
- **The list sizes the menu has to carry**: Speechify listed 992 Voices
  (notes/NOTES_2026-09-19.md), Azure 691 in 154 locales
  (notes/NOTES_2026-09-22.md), and Fish's official listing is read up to 20 pages
  of 100 (`fish.ts`, `MAX_PAGES`).
- **Hermes's `Intl.Collator`**: _to be measured on the simulator (#232)._

## Alternatives

- **`Intl.DisplayNames` at run time**, as the plugin calls it: one line instead
  of a table, but unmeasured on Hermes and silent where it is absent.
- **Only the locales the Providers send today**, a table of a few hundred
  entries: smaller, but the first new locale a Provider adds would show as a
  code, and nothing would fail to say so.
- **Extending `LANGUAGE_NAMES`**: it is the Fish Language Hint's table, in the
  `dialect` form the plugin's hint uses, and the two must not drift into each
  other.
- **A `FlatList` under the two menus, sorted**: the owner asked for the Voice to
  be chosen as Provider and Language are.
