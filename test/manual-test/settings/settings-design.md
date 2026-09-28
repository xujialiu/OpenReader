# Settings against the phone's own Settings (#48, design 0042)

Design 0042 draws the settings pages the phone's way, measured from the phone
rather than remembered, and `SETTINGS` in `src/app/controls.tsx` holds the
numbers. Two runners make the comparison cheap to repeat when the phone's look
changes; each runs its probe once in the light appearance and once in the dark,
then gives the simulator back the appearance it had:

```bash
bash test/manual-test/settings/native-reference.sh SIMULATOR_UDID /tmp/openreader-native-01
bash test/manual-test/settings/design-shots.sh SIMULATOR_UDID /tmp/openreader-design-01
```

- `native-reference.sh` (`NativeReferenceProbe.swift`) opens only the phone's
  own Settings: its front page, General, General › About, and General ›
  Keyboard at the top and scrolled down, which is where a section header over a
  card and a footer under one can be measured.
- `design-shots.sh` (`DesignShotsProbe.swift`) walks OpenReader's Settings,
  General, Providers, Fish Audio, OpenAI Compatible, Sync empty and filled with
  sample values (never switched on, and emptied again afterwards), a reader's
  player and its speed bubble. It never presses Play. The same probe's
  `testSpeedBubble` checks the bubble (one tap is 0.05 each way, a hold
  repeats, the speed is put back, and a tap on Contents while it is open only
  closes it), and `testBackButtonLabels` that every back arrow is labelled
  `Back`; run either with `-only-testing:LockScreenProbe/DesignShotsProbe/<name>`
  as `design-shots.sh` runs its own.

Screenshots land in `<dir>/<appearance>/attachments/`, named by
`manifest.json`. Measure with PIL at the screenshot's own scale (3 pixels to
the point on an iPhone 17): sample a colour in the middle of a surface, and
take a card's edges at its vertical middle, since its rounded top cuts in.

- **The simulator's Settings has no page of labelled text fields.** iOS 27.0's
  simulator has no VPN configuration and no Mail, the two places the phone sets
  up an account in rows of `Label  value` fields, so `NativeReferenceProbe`
  captures neither, and the field rows' value column is the one thing on these
  pages not checked against a measurement.

A third runner covers what the two above do not — real touches on the freeze
rule itself, not just its resting screenshots:

```bash
bash test/manual-test/kit/run-probe.sh ProviderFreezeProbe SIMULATOR_UDID /tmp/openreader-freeze-01 -only-testing:testFailurePathsNoCredentials
bash test/manual-test/kit/run-probe.sh ProviderFreezeProbe SIMULATOR_UDID /tmp/openreader-freeze-02 -only-testing:testSyncRefusalPathAlone
bash test/manual-test/kit/run-probe.sh ProviderFreezeProbe SIMULATOR_UDID /tmp/openreader-freeze-03 -only-testing:testFishVoicesFieldAndEnableDisableCycle
bash test/manual-test/kit/run-probe.sh ProviderFreezeProbe SIMULATOR_UDID /tmp/openreader-freeze-04 -only-testing:testPressedRowHighlightsEdgeToEdge
bash test/manual-test/kit/run-probe.sh ProviderFreezeProbe SIMULATOR_UDID /tmp/openreader-freeze-05 -only-testing:testDynamicTypeSpotCheck
```

`ProviderFreezeProbe.swift` (independent #48 verification, 2026-09-23):

- `testFailurePathsNoCredentials` — a bogus OpenAI key and an unreachable
  OpenAI Compatible address (in practice both are refused by a client-side
  "needs a model" check before either would reach the network — see
  Pitfalls, Sync's own timeout gap), then Sync against an address that cannot
  resolve. Each must end its switch off with a reason under the first card
  and its fields still editable; leaves every provider disabled and Sync
  empty. Prefer `testSyncRefusalPathAlone` for Sync alone — it waits for the
  check to *begin* before waiting for it to end (see Pitfalls) and is faster.
- `testFishVoicesFieldAndEnableDisableCycle` — needs the real key in
  `/tmp/openreader-fish-key.txt` (skips itself otherwise). The Voices field
  revealed by Manual voices, while unlocked: its placeholder, that it raises
  the keyboard, and that it stays reachable above it. Then the real
  enable/disable cycle: `Testing…` best-effort caught live, `Turn off to
  edit.`, `Connection successful`, the fields and the whole Voice sources
  card locked, the eye toggle's existence (never tapped — no capture here can
  then show the key), the Providers/Settings counts, and disabling again.
  Ends with Fish disabled and no stored key. If it fails partway (it did
  once, on an unrelated assertion — see Pitfalls), Fish may be left enabled
  with a real key stored: `testVoiceSourcesLockIsFunctionalThenCleanUp`
  reads the live state rather than assuming it, and disables/clears either way.
- `testPressedRowHighlightsEdgeToEdge` — a mid-hold screenshot taken from a
  background queue during `press(forDuration:)`, rather than a video
  recording, to catch a pressed `NavigationRow`'s highlight.
- `testDynamicTypeSpotCheck` — captures only, judged by eye; run with
  `xcrun simctl ui UDID content_size extra-extra-large` set first and
  restored after (the caller's job, not the probe's).
- `testReturnToLibrary` — walks back to the Library from wherever the app was
  left, for ending a session cleanly.
