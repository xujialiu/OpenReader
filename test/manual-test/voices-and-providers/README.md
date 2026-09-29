# Voices, providers and what is sent

Each recipe is its own file. Read the one for what you are testing, or the one
that names the script or probe you are about to run.

- [voice-lists.md](voice-lists.md) (#24, #28): the voice sheet listed at once
  after a cold start, the sheet while the list is still being asked for, and
  where the sheets' notes start. `VoiceListProbe.swift`,
  `voice-sheet-loading.cjs`.
- [stat-lines-and-brackets.md](stat-lines-and-brackets.md) (#23, #25): the text
  sent to Fish for short lines and bracketed words, where the word highlight
  falls, and what the bracket switch does to saved audio.
  `fixtures/stat-line-fixture.ts`, `stop-on-word.cjs`, `BracketsProbe.swift`.
- [azure.md](azure.md) (#39): Azure Speech's configuration and its error
  wordings, its voice sheet, word and whole-sentence highlighting, and reading
  in the background. `AzureProviderProbe.swift`.
- [context-probe.md](context-probe.md) (#61): one request per sentence against
  one per paragraph, measured from the Mac, with a blind listening page.
  `context-probe.ts`.
- [reader-sheets-and-handover.md](reader-sheets-and-handover.md): the reader's
  sheets, a Voice changed while loading or playing, a paused sentence tap after
  its audio has arrived, and Fish's regional picker by real touch.
  `ReaderProbe.swift` (default, `loading`, `fish`), `voice-playback.cjs`
  (default, `touch`, `paused-seek`).
- [system-voices.md](system-voices.md): which of the phone's own voices
  exist, in how many languages, and whether `AVSpeechSynthesizer.write`
  marks their words. `ListSystemVoices.swift`, `SystemVoiceMarkers.swift`, `SystemVoicesApp.swift`, `system-voices-app.rb`.
- [fish-narration.md](fish-narration.md) (#73): a lookup and a pronunciation
  interrupting real Fish narration, and a selection handle's release.
  `FishNarrationProbe.swift`.
