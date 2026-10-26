# The voice is chosen like the provider and the language

_The engineering half of this decision is
[ADR 0081](../adr/0081-voice-menu-and-language-names.md). Issues
[232](https://github.com/xujialiu/OpenReader/issues/232) and
[300](https://github.com/xujialiu/OpenReader/issues/300)._

## What the owner saw

The Voice drawer had two rows that open a small menu, Provider and Language,
and under them the voices of that language as a long list filling the rest of
the drawer. So the same kind of choice was made two ways in one drawer.

The Language row showed each language as the code the provider sent: `en-US`,
`zh`, `ja-JP`. A voice that speaks any language was under `multilingual`, in
lower case. The languages were in the order of their codes, and the voices in
whatever order the provider sent them. For a provider with nearly a thousand
voices, that is no order anyone can search by eye.

## What changes

- **Voice is a third row, opened the same way.** It names the voice in use, and
  its menu lists every voice of the language shown, with a check on the one in
  use. Choosing one reads with it, as tapping a row did before.
- **Languages have their full English names**: `English (United States)`,
  never `en-US` or `American English`. The brackets say only what tells a
  language apart from the provider's others of the same language:
  - **The country**, only when the provider has the language in more than one.
    Kokoro has English twice, so it shows `English (United Kingdom)` and
    `English (United States)`, but `Japanese` alone.
  - **A regional dialect by its place alone**: Azure's Liaoning voices are
    `Chinese (Liaoning)`, as are its Guangxi, Henan, Shaanxi, Shandong and
    Sichuan ones, even for a provider whose only Chinese is a dialect.
  - **The alphabet, where that is the difference**: Azure has the same two
    Serbian voices in each alphabet, `Serbian (Cyrillic)` and
    `Serbian (Latin)`. An unusual alphabet is named even when it is the only
    one; where the country differs too, both are named.
  - **Short place names**: `Hong Kong` and `Macao`, not `Hong Kong SAR China`.

  `Wu Chinese` (Shanghainese) and `Cantonese` keep those names.
- **`Multilingual`** comes first, with a capital letter, and the other
  languages follow in alphabetical order.
- **Voices are in alphabetical order**, as the desktop plugin sorts them.
  Chinese names come first, in pinyin order, then the Latin ones from A to Z.
- **Chinese stays split by country and region.** Azure's voices for mainland
  China, Hong Kong and Taiwan are three languages: `Chinese (China)`,
  `Chinese (Hong Kong)` and `Chinese (Taiwan)`. The desktop plugin
  puts all three under one `Chinese`, and has been asked to stop
  ([Zotero-OpenReader issue 223](https://github.com/xujialiu/Zotero-OpenReader/issues/223)).
- **Looking at another provider or language chooses nothing.** If the voice in
  use is not in the list being looked at, the Voice row shows no name and the
  menu checks nothing until the owner chooses a voice.
- **While a chosen voice gets ready**, the drawer stays open, the row already
  shows the new name, and a spinner stands where the menu's mark was.

## Why

- **One way to choose.** All three levels open the same kind of menu from a row,
  so choosing a voice works the same way as the two choices above it.
- **Names a person reads.** `zh-HK` is a code, and so, nearly, was the first
  name the phone gave it, `Chinese (Hong Kong SAR China)`, with the dialects in
  capitals after a country the plain Chinese already named:
  `Chinese (China, LIAONING)`. `Chinese (Hong Kong)` and `Chinese (Liaoning)`
  say what the voices speak and nothing else. `Serbian (Serbia)` did not say
  that its voices read Cyrillic; `Serbian (Cyrillic)` does.
- **Alphabetical order makes a long list searchable.** In a menu with hundreds
  of entries, the only way to find a voice you know by name is to know where
  its name falls.
- **Cantonese stays visible.** Azure's Hong Kong voices speak Cantonese, and
  their names, such as 曉曼, do not say so. In one `Chinese` list of about forty
  names, the owner could not tell them from the Mandarin voices without trying
  each one.

## What it costs

- **No search.** A language with hundreds of voices is still one menu to
  scroll. A list of the old kind was no better at this, but it is not solved.
- **The provider's own order is gone.** Fish Audio sends its own voices in an
  order of its own choosing, and that order is no longer shown. A voice is now
  found by its name.
- **The names are English only**, whatever language the phone is set to, as
  the rest of the app is.
- **The phone and the desktop disagree** about Chinese, Hong Kong, the
  dialects and Serbian until the desktop plugin follows
  [Zotero-OpenReader issue 223](https://github.com/xujialiu/Zotero-OpenReader/issues/223),
  where it has been asked to use the same names.
- **Hong Kong sits among the provinces.** Languages are in alphabetical order,
  so `Chinese (Hong Kong)` falls between `Chinese (Henan)` and
  `Chinese (Liaoning)`, and `Wu Chinese` is far below the other Chinese.
- **The menu covers part of the drawer while it is open**, and the row turns
  into the menu as it opens, as the other two rows already do (decision 0035).

## Turned down

- **Keeping the voices as a list under the two menus.** It is the form that
  made the drawer two kinds of choice. The owner asked for the voice to be
  chosen the way the provider and the language are.
- **Choosing the new language's first voice automatically.** Just looking at
  another language would then change the voice every document is read in
  (decision 0089), and could leave the audio already downloaded unused.
- **Merging the Chinese regions, as the desktop plugin does.** The plugin
  merges them because Zotero's own menu does. Here, merging would hide which
  voices are Cantonese.
- **The provider's own order.** It looks deliberate for one provider and
  arbitrary for another, and none of them sort by name.
- **Keeping the country beside a dialect**, `Chinese (China, Liaoning)`: it
  says China twice over for a province.
- **The provider's own names for the dialects**, such as
  `Chinese (Northeastern Mandarin)`: few readers know which province that is.
- **`Chinese (Wu)` and `Chinese (Cantonese)`**, to keep them with the other
  Chinese: Cantonese would then sit beside `Chinese (Hong Kong)`, whose voices
  speak Cantonese too, and the two could not be told apart by name.
- **The dialects listed together after `Chinese (China)`**: one language would
  then be in an order of its own, and a dialect could not be found where its
  name falls.
- **Naming Simplified and Traditional** for every Chinese: the place already
  says it, and every Chinese name would grow longer.
