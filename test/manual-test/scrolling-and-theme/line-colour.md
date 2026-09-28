# A drawer's lines in the other theme's colour (#29, `line-colour.sh`)

With the current Debug app connected to this tree's Metro, `A Short Test of
Reading Aloud` in the Library and no LogBox banner on the screen:

```sh
bash test/manual-test/scrolling-and-theme/line-colour.sh SIMULATOR_UDID NEW_OUTPUT_DIR dark light    # the app dark on a light phone
bash test/manual-test/scrolling-and-theme/line-colour.sh SIMULATOR_UDID NEW_OUTPUT_DIR light dark    # the reverse
bash test/manual-test/scrolling-and-theme/line-colour.sh SIMULATOR_UDID NEW_OUTPUT_DIR system dark   # following the phone
```

It sets the theme through the walkthrough harness, goes back to the Library,
and `LineColourProbe.swift` opens with real taps: the Library's drawer by a
long press and then by its `...`, the reader (the player), Contents, the voice
drawer (waiting for any "Asking … for its Voices…" note to clear first), the
reader's actions drawer, its Download page — tapping "The First Chapter"
there afterward if it exists and is not already downloaded, never starting a
download, and photographing the picked state as `reader-download-selected` —
and its Appearance page. `line-colour.py` then lists, for each screenshot,
every pixel row at least half the screen wide in `#dcdce2` or `#33333c`, and
any run of 24 pixels or more in the other theme's one. Plays nothing; puts
back the theme and the simulator's appearance it found. About 75 s once the
runner is built.

Exit 1 = RED, some line is in the other theme's colour; 0 = GREEN; 3 = the
probe failed, so the screenshots are not the drawers. A GREEN also lists the
rows it found in the right colour: compare them with a RED run's, because a
line that has gone altogether is GREEN too.

**What this does not score**: the voice chips' borders and the download
checkbox ring take `borders.text`, `borders.reading` or `borders.quiet`, none
of which is one of the two hairline greys `line-colour.py` looks for, so a
chosen chip (border = fill, deliberately no visible seam) or a checked/
unchecked ring never turns a run RED or GREEN by itself — read those
screenshots by eye, or sample the exact pixels (below). The voice drawer only
has rows and chips to look at once a Provider is enabled on the device under
test (`OfflineFixProbe.testConfigureFishProvider`, with a key dropped once at
`/tmp/openreader-fish-key.txt`); with none enabled the sheet shows only its
"Enable a provider in Settings" note, GREEN and empty.

Measured 2026-09-24 (notes, 13:34–13:37 and 13:55–14:00): on the tree before
#29's fix, dark on light was RED in six of eight screenshots and light on dark
in six, following the phone GREEN; after it, all four pairings GREEN with the
same rows present. It cannot see a line in any other colour, a border shorter
than 24 px, or the voice drawer's rows and chips when no Provider is enabled.

Independently re-verified 2026-09-24 (ios-tester, `0.0.2-beta22`, "iPhone 17
issue_29"), with Fish Audio enabled so the voice drawer has real rows and
chips: dark on light and light on dark both GREEN across all nine
screenshots (the original eight plus `reader-download-selected`), the same
rows as the notes above. Sampling exact pixels for what `line-colour.py`
cannot score: in the voice drawer, an unchosen locale chip's 1 px top and
bottom border read `#33333c` dark / `#dcdce2` light exactly (`BORDER.*.line`),
with no seam at the chosen Fish Audio/`af` chips, whose border and fill are
the same `#e6e6ea` dark / `#16161a` light (`BORDER.*.text`) all the way
across — found by scanning a column through each chip rather than a full row,
since a rounded chip's flat hairline is only a few pixels wide in any single
row. In the Download page, tapping "The First Chapter" turned its ring from
an outline of exactly `#9d9daa` dark / `#5d5d68` light (`BORDER.*.quiet`,
776–828 exact-match pixels around the ring in each theme) to a filled circle
of exactly `#f0a828` dark / `#b26a00` light (`BORDER.*.reading`), zero pixels
of the other theme's version of either colour at the same tolerance. A loose
tolerance (6 levels per channel) does turn up a handful of pixels that read as
the wrong theme's grey at the ring's own antialiased edge (24 of them, light
on dark); tightening to 3 levels or exact finds none, so that is antialiasing
against the tolerance, not a stray colour — worth re-checking at a tighter
tolerance before reporting a chip or ring border as wrong from a loose scan.
`live-theme-drawer.sh` ([live-theme-drawer.md](live-theme-drawer.md)) covers the one path this script cannot: a
theme changed while a drawer is already open.
