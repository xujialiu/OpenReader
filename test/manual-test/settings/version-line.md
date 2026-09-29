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
