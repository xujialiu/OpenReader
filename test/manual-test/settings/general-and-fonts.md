# General, Theme, brackets, Manage-downloads delete-all, and Fonts

With the current Debug app connected to Metro and both `A Short Test of
Reading Aloud` and `仙逆` in the Library, `A Short Test of Reading Aloud`
already having some saved audio:

```sh
bash test/manual-test/kit/run-probe.sh GeneralFontsProbe SIMULATOR_UDID /tmp/openreader-general-fonts-01 \
  -only-testing:testFontFamiliesAvailableOnSystem \
  -only-testing:testGeneralThemeAndBrackets \
  -only-testing:testManageDownloadsDeleteAll \
  -only-testing:testFontsPageListAndBackButton \
  -only-testing:testFontSelectionChangesReadingPage \
  -only-testing:testLatinFontChangesEnglishReadingPage
```

Omit the `-only-testing` arguments to run the whole class, **except**
`testMigratedFontShowsGeorgia` (see below), which depends on state the other
methods do not set up and will fail if it runs alongside them.

`testFontFamiliesAvailableOnSystem` touches no UI: it asks `UIFont` whether
each of `READING_FONTS`' nine named `preview` faces actually resolves on this
system (family name or exact PostScript name), which is the same resolution
path React Native's own font lookup uses. A missing face is not a probe
failure to fix — it is the fact the test exists to surface, and the failure
message names the font. On the iOS 27.0 simulator runtime measured here, the
five Latin faces and `PingFang SC` resolve; `Songti SC`, `Kaiti SC` and
`Yuanti SC` do not (`UIFont.familyNames` on that runtime contains no CJK
family beyond the four PingFang variants). Confirm with real touches whenever
the reported set changes, since a missing face falls back to the system font
silently rather than erroring, and a screenshot is the only way to see that.

`testGeneralThemeAndBrackets` opens Settings → General with real touches,
photographs it, opens the Theme menu (#33) and requires Light, Dark and Match
Device in that order with the system symbols `sun.max`, `moon` and
`circle.lefthalf.filled`, photographs it, picks Light, requires the row to read
`Theme, Light`, then restores whatever theme the device had before the run,
Match Device included (photographed at each step, so both themes are covered
regardless of which one the device started in). It then drives the full bracket interlock in `general-screen.tsx`: the
field cannot be typed into while the switch is on (no keyboard appears),
typing `abc` and `() ()` with the switch off and turning it back on is
refused with the switch staying off, an inline note naming the offending
entry, the `Use <> [] instead` recovery link, and zero `app.alerts` — never a
modal — and a valid non-default list is accepted silently. It ends by
restoring the default list. It never touches Providers or downloads.

`testManageDownloadsDeleteAll` opens the English fixture's Download drawer,
enters Manage downloads, and requires `Delete all saved audio` next to `Back
to downloads` and a confirmation titled `Delete all saved audio?` naming a
size. It always cancels — this mode never deletes saved audio — and a saved
SQLite byte count taken before and after confirms nothing was removed.

`testFontsPageListAndBackButton` opens 仙逆's actions drawer, Appearance, then
Font, and requires all eleven rows (`Original Book Font` through `圆体`),
exactly one checked, and that the back button returns to Appearance rather
than closing the drawer. It photographs the list at the top and scrolled.
Whether the four Chinese rows are actually visually distinct is not something
XCTest can assert; read the attached screenshot against
`testFontFamiliesAvailableOnSystem`'s log.

`testFontSelectionChangesReadingPage` (仙逆) and
`testLatinFontChangesEnglishReadingPage` (the English fixture) each pick a
sequence of fonts through the same drawer and photograph the reading page
after every pick, ending back at `Original Book Font`. Neither asserts a
visual difference — that is also a screenshot-reading task — but a same-sized
crop diffed across screenshots (`ImageChops.difference` on the exported PNGs)
is a decisive way to tell a real font change from a coincidence of line
wrapping: on the measured run, `Times New Roman` and `Original Book Font`
were pixel-identical on the English fixture (that fixture's EPUB carries no
CSS of its own, so "follow the document" is WebKit's bare default, which
happened to already be Times), while `Georgia` differed from both by a wide
margin. The same diff against 仙逆's `楷体` and `Original Book Font` crops was
small and, on inspection, explained by sub-pixel/scroll noise rather than a
font change — consistent with `Kaiti SC` being absent from this runtime.

To verify the `serif`/`sans` id migration, terminate the app, edit the
on-device `settings.json` (`Paths.document`, reachable on the simulator via
`xcrun simctl get_app_container UDID top.xujialiu.openreader data`) to set
`"font": "serif"`, then run the one method that depends on it:

```sh
bash test/manual-test/kit/run-probe.sh GeneralFontsProbe SIMULATOR_UDID /tmp/openreader-general-fonts-migration \
  -only-testing:testMigratedFontShowsGeorgia
```

It launches (picking up the edited file), opens the English fixture's
Appearance, and requires the Font row to read `Font, Georgia`. Restore the
backed-up `settings.json` and relaunch afterward; this mode does not restore
it for you, since it is meant to be run against a deliberately prepared file.

None of these modes ever presses Play.
