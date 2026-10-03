# The Settings version line, rows above it, and both themes (issue #30, `SettingsVersionProbe.swift`)

With the current Debug app connected to Metro:

```sh
bash test/manual-test/kit/run-probe.sh SettingsVersionProbe SIMULATOR_UDID /tmp/openreader-settings-version-01
```

This relaunches the app (so a JavaScript-only change, such as `app-version.ts`,
is proven current rather than assumed), opens Settings, and requires an
element labelled exactly `Version <APP_VERSION>-debug` under the Sync row, reading
`APP_VERSION` from the working tree's `app-version.ts` at run time. Every Metro
build has Debug Mode, which the line shows as `-debug` (#82, ADR 0054); for a
Release build made without it, add `--mode release` and the probe requires
`Version <APP_VERSION>` instead. The label is the
accessibility label a screen reader announces, which is not the same thing as
the line's visible text, since `accessibilityLabel` replaces what iOS exposes
rather than adding to it (a screenshot is what proves the visible text has no
"Version" word). It taps General, Providers and Sync in turn, requires each
one's own nav bar to appear, and returns to Settings each time to confirm the
version line and the three rows above it are unmoved. It then opens General →
Theme, picks Light, returns to Settings and photographs it, then Dark and
photographs it, then restores whichever of Light/Dark/Match Device the device
had before the run. It never presses Play.

## The `x.y.z (n)-betaN` form (issue #127, 2026-10-03)

Rerun on `ios-tester-r124` (iOS 27.0) against a Debug build of 77a0f85 with
`APP_VERSION` `1.0.0 (5)-beta1`: `Executed 1 test, with 0 failures` in 53.5 s.
The new form survives the whole chain: XCUITest's exact label match takes the
parentheses and spaces (`Version 1.0.0 (5)-beta1-debug`), the visible footnote
text reads `1.0.0 (5)-beta1-debug` on one line in both themes (the version
element's frame is `{36, 490, 368, 15.7}` in all four captures — 15.7 pt is
one line; the two identical-frame StaticTexts are RN's usual double exposure),
and the Debug Log launch line reports `OpenReader 1.0.0 (5)-beta1, native
1.0.0 (5)`. The native `5` needed a prebuild first: the working `ios/` from
before the change still carried `CFBundleVersion` 4.
