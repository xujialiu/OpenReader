# The phone's own voices: which exist, and whether they mark words

Two plain Swift executables, run inside a booted simulator with `simctl spawn`.
Neither is an XCTest probe and neither plays anything, so the simulator's volume
does not matter and no app has to be installed.

- `ListSystemVoices.swift`: every voice `AVSpeechSynthesisVoice.speechVoices()`
  offers, tab-separated: language, name, quality, gender, traits, identifier.
  `TOTAL n` goes to stderr.
- `SystemVoiceMarkers.swift`: one sentence per voice through
  `AVSpeechSynthesizer.write(_:toBufferCallback:toMarkerCallback:)`; prints the
  buffer format, the frames written and each word marker as
  `byteSampleOffset:text`. Edit `cases` for other voices.

```sh
out=/tmp/openreader-sysvoices; mkdir -p $out
for p in ListSystemVoices SystemVoiceMarkers; do
  xcrun --sdk iphonesimulator swiftc -target arm64-apple-ios17.0-simulator \
    test/manual-test/voices-and-providers/$p.swift -o $out/$p
done
xcrun simctl spawn SIMULATOR_UDID $out/ListSystemVoices > $out/voices.tsv
cut -f1 $out/voices.tsv | sort -u | wc -l                 # locales
cut -f1 $out/voices.tsv | cut -d- -f1 | sort -u | wc -l   # languages
xcrun simctl spawn SIMULATOR_UDID $out/SystemVoiceMarkers
```

The same `ListSystemVoices.swift` built with plain `xcrun swiftc` lists the
Mac's own voices.

**What it cannot prove**: the phone's list. The simulator runtime carries only
`super-compact` voices and no Eloquence voices, and a phone adds whatever its
owner downloaded in Settings → Accessibility → Spoken Content → Voices. The
phone needs these lines run inside a signed app on it.

Measured results: notes/NOTES_2026-09-29.md, 20:56.
