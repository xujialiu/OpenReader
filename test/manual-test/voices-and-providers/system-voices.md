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
owner downloaded in Settings → Accessibility → Spoken Content → Voices.

## On the phone: the System Voices app

`SystemVoicesApp.swift` does both jobs inside a signed app, for every voice the
phone has. Every launch lists the voices (`voices.tsv`, `summary.txt`). Launched
with `--measure`, it then writes one sentence per voice through `write`, in the
voice's language where the app has one (en, zh, yue, ja, ko, de, fr, es, ru;
English otherwise, marked `nativeText=no`), and records the format, the word
markers and how long each synthesis took (`markers.tsv`); without it, the last
`markers.tsv` is shown. Then every English voice writes a longer passage,
introduced by its own name, to `Documents/samples/FAMILY-LOCALE-NAME.wav`, and
`done.txt` is written. Nothing is played until the owner taps a voice's row,
which speaks the passage on the phone. It keeps the screen awake while it runs;
a locked phone suspends it. A run of both takes about 30 s.

```sh
out=/tmp/openreader-systemvoices-app; mkdir -p $out
ruby test/manual-test/voices-and-providers/system-voices-app.rb $out TEAM_ID
xcodebuild -project $out/SystemVoices.xcodeproj -scheme SystemVoices \
  -configuration Release -destination 'id=IPHONE_UDID' \
  -derivedDataPath $out/DerivedData \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration -quiet build
xcrun devicectl device install app --device IPHONE_UDID \
  $out/DerivedData/Build/Products/Release-iphoneos/SystemVoices.app
xcrun devicectl device process launch --terminate-existing --device IPHONE_UDID \
  top.xujialiu.openreader.systemvoices --measure
for f in summary.txt voices.tsv markers.tsv done.txt samples; do
  xcrun devicectl device copy from --device IPHONE_UDID \
    --domain-type appDataContainer \
    --domain-identifier top.xujialiu.openreader.systemvoices \
    --source Documents/$f --destination $out/$f
done
```

A new bundle id needs a new provisioning profile, so Xcode must have the
owner's Apple ID signed in (pitfalls/physical-iphone.md, `No Accounts`). The
phone must be unlocked for the launch. `done.txt` missing means the run has not
finished; copy again later.

The phone's voice identifiers are not fixed: between two runs ten minutes apart
41 `super-compact` voices came back as `compact` ones (notes/NOTES_2026-09-29.md,
21:25). Compare lists by name and locale, not by identifier.

Measured results: notes/NOTES_2026-09-29.md, 20:56.
