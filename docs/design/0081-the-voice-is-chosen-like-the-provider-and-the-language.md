# The voice is chosen like the provider and the language

_The engineering half of this decision is
[ADR 0081](../adr/0081-voice-menu-and-language-names.md). Issue
[232](https://github.com/xujialiu/OpenReader/issues/232)._

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
- **Languages have their full English names**, as the desktop plugin writes
  them: `English (United States)`, never `en-US` or `American English`. The
  country is named only when the provider has the same language in more than
  one country. Kokoro has English twice, so it shows `English (United Kingdom)`
  and `English (United States)`, but `Japanese` alone.
- **`Multilingual`** comes first, with a capital letter, and the other
  languages follow in alphabetical order.
- **Voices are in alphabetical order**, as the desktop plugin sorts them.
  Chinese names come first, in pinyin order, then the Latin ones from A to Z.
- **Chinese stays split by country and region.** Azure's voices for mainland
  China, Hong Kong and Taiwan are three languages: `Chinese (China)`,
  `Chinese (Hong Kong SAR China)` and `Chinese (Taiwan)`. The desktop plugin
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
- **Names a person reads.** `zh-HK` is a code. `Chinese (Hong Kong SAR China)`
  says what the voices speak. The phone and the desktop now use the same words
  for the same thing.
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
- **A few names are awkward.** A regional dialect that has no English name is
  written as the provider spells it, in capitals: `Chinese (China, SICHUAN)`.
  That is how the desktop plugin writes it too.
- **The phone and the desktop disagree about Chinese** until the plugin follows
  issue 223.
- **The menu covers part of the drawer while it is open**, and the row turns
  into the menu as it opens, as the other two rows already do (decision 0035).

## Turned down

- **Keeping the voices as a list under the two menus.** It is the form that
  made the drawer two kinds of choice. The owner asked for the voice to be
  chosen the way the provider and the language are.
- **Choosing the new language's first voice automatically.** Just looking at
  another language would then change this document's voice and the default for
  new documents (decision 0010), and could leave the audio already downloaded
  unused.
- **Merging the Chinese regions, as the desktop plugin does.** The plugin
  merges them because Zotero's own menu does. Here, merging would hide which
  voices are Cantonese.
- **The provider's own order.** It looks deliberate for one provider and
  arbitrary for another, and none of them sort by name.
