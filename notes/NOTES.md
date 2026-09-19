# Notes

Measured findings live here, in dated files (`NOTES_YYYY-MM-DD.md`) as in the
Zotero-TTS repo. Decisions live in `docs/adr/`; see ADR 0015 for why both.

Nothing has been built yet. What follows is the list of things assumed but **not
verified**, accumulated while planning on 2026-09-19. Each is cheap to settle and
expensive to get wrong later.

## Verify before writing much code

1. **`String.prototype.normalize('NFKC')` on Hermes.** Load-bearing in the word
   aligner and the bracket-stripping code. It has crashed on Hermes historically
   and recent release notes do not mention it. One line to test.
2. **`TextDecoder` on the Hermes bundled in React Native 0.86.** The Hermes
   release notes of 2026-06-05 say it ships with the engine; an older issue says
   it does not. Unresolved.
3. **CFI round-trip against Zotero, both directions.** Take one EPUB. Store a
   position from the desktop plugin and resolve it in an epub.js reader; generate
   a CFI with standard epub.js and hand it to Zotero's `toDisplayedRange`. Record
   not just whether it resolves, but whether it resolves to the *right* text —
   the known failure mode is silently landing on the wrong node. Zotero uses its
   own copy of epub.js, which is why this is in doubt. See ADR 0008.
4. **A 60–90 minute backgrounded playback session on a real device**, before any
   UI work. The failure modes are all invisible on a desk: the audio session
   going inactive between clips, the keychain refusing the API key while the
   screen is locked, the buffer queue draining.
5. **Lock-screen support in `react-native-audio-api`** — which remote commands it
   registers and whether it writes elapsed time and playback rate. Being audited.
6. **Whether the *Piper - Neural TTS* app's system-wide voices emit word
   markers.** If they do, free offline neural voices with word timing cost this
   project nothing at all.
7. **`Intl.Segmenter` sentence quality on real books**, against the constructed
   cases in the plugin's `test/fixtures/` — CJK, Romanian diacritics, angle
   brackets, numbers. It is the first segmenter, not the final one.
