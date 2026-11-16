# The reader's title in the navigation bar (#85, ADR 0057)

The bar's title is the app's own `Text` (`reader-title.tsx`): 17-point
semibold, centred, up to two lines, tail-truncated, not scaled by Dynamic Type,
`maxWidth = window width − 2×81`, exposed to VoiceOver as a heading with the
whole name. These are the checks that verified it on the simulator, and what
each cannot prove.

Prerequisites: this tree's Metro running on a free PORT (`npx expo start --port
PORT`), the Debug app launched with `-RCT_jsLocation localhost:PORT` (the build's
`RCTMetroPort` is empty, so every launch needs it — pitfalls/metro.md), the
Scroll Fixture `sha256:9acbcbe4…` in the Library. No playback, so no silencing.

## Set a name and open the reader

```sh
bash test/manual-test/library-and-reader/rename.sh SIMULATOR_UDID "《第一位传奇驯兽师 第三卷 穿越北方群山的漫长道路以及更远的地方》" PORT
sleep 5
node test/manual-test/kit/hx.cjs SIMULATOR_UDID '{"do":"open","id":"sha256:9acbcbe4480c15ba1319ecf56bad78e13a478470d2107f89791ba0f5b74f1606"}'
sleep 8
xcrun simctl io SIMULATOR_UDID screenshot /tmp/title.png
```

`rename.sh` terminates the app first: a running app rewrites both
display-names.json and library.json from memory and would discard the edit. It
leaves the app on the Library or a restored Reader; the harness `open` goes to
the Reader either way. Restore the usual 103-character name the same way.

## Measure the bar from the screenshot

Screenshots are 3× (1 pt = 3 px). `kit/ink.py PATH` prints the body text's
edges; for the bar, scan the central band x 66–332 pt (the back glass ends at
60.3 and More actions' begins at 333.3 on a 402-pt phone, so both stay out) and
group consecutive ink rows into lines: a long name must give exactly two lines,
both centred at 201.0, inside the bar's y 54–108, ending in "…" when the name
is longer than two lines. The player's collapse hiding and returning the bar is
measured the same way on before/after screenshots (glasses sampled at their
fixed centres), with the highlighted sentence's band as the proof the page did
not move.

Short name against the native title: take the "before" screenshot on the old
build (a full-res 1206×2622 PNG), then compare glyph masks — binarise y
70–95 pt by the ink threshold and compute IoU. The measured pair agreed to a
1 px vertical offset (IoU 0.80 raw, 0.94 shifted 1 px; identical pixel counts
4802 = 4802, identical x-extent 149.33–252.67 and centre 201.0). Do **not**
pixel-diff the whole bar band to compare the title glyphs: the other controls
and the system material's shading can differ between captures. The shown
horizontal bar must not reveal document lettering behind it. For the painted
band use `title-band.py`; use `title-opacity-diff.py` to check that different
hidden text does not leave different glyph shapes in the bar.

## Painted horizontal band and its opacity (#366)

`title-band.py SCREENSHOT TREE.json TITLE --bar-frame x,y,w,h --band-x0 64
--band-x1 336 --expect-page-rgb 255,255,255 [--rest-screenshot REST.png]
[--report OUT]` asserts, from pixels alone: the screen's modal colour is the
expected page colour (a sheet dimmer or a wrongly staged theme fails here);
the band behind the title holds no ink outside the title box; no fade ramp;
the paint covers exactly the supplied native bar frame (measured on the
runtime under test — on iPhone 17 / iOS 26.5 the bar is `RNSNavigationBar
(0 62; 402 54)`, so the band is y 62–116 pt, not the older 54–108); real text
scrolled to the boundary reappears immediately below it; and with
`--rest-screenshot` (a same-chrome at-rest capture) the backing ends exactly
where the page's reserved room ends. Scale derives from the PNG against the
tree's Application width; paired images must share dimensions. Exit 0 PASS,
1 FAIL, 69 BLOCKED. `--self-test` runs deterministic synthetic controls
(clean, band ink, dimmer, missing heading, wrong expected colour, wrong bar
frame) in-process.

`title-opacity-diff.py A.png B.png --bar-frame x,y,w,h --window-width-pt 402`
is the opacity counterfactual control: two captures of the same bar and scroll
position with DIFFERENT real text hidden behind it must differ by zero
structured pixels inside the band (≤16/255) while the visible page below
differs (that control proves the comparator works; a pair whose below-band
region does not differ is BLOCKED as unproven). Used with the runtime-only
LLDB transparent-bar override it proves the paint is what hides the text.

Prerequisites and limits: Pillow on the host; the Debug app with its Metro for
probes and gestures; the bar frame, button-exclusion x range and expected page
colour are per-runtime measured inputs (the tools take them as required
arguments and make no cross-runtime claims); screenshots must be full-res PNGs
of the same device (3× on this phone). The dark theme page colour on this
runtime is `17,17,20`.

## Collapse without a layout jump

Start the stability check already Following (`A`), paused, with the controls
open and no note forcing them open. Capture one settled passage's identity
and screen rectangle, then use real Collapse and Show presses. The same
passage and rectangle must remain, along with the native and document viewport
and iframe dimensions. A changed `scrollTop` alone is not a visible jump when
the renderer trims content and compensates for it; compare the passage itself.

Do not assert no movement across a collapse from Browsing (`M`). Putting away
the Player deliberately returns the page to the Reading first, even while
paused (design 0050). That is a different transition, not a layout-jump test.

`kit/probes/passage-anchor.js` reports a visible paragraph's section, text
fingerprint and screen coordinates. Use `kit/probe-answers.py capture` before
sending each existing `hx.cjs --code-file` probe, then `collect --offset-file
OFFSET --expect N`. The collector reads byte offsets, preserves raw timestamped
answers and exits nonzero on incomplete or malformed data. Null or missing
answers are never equal-state proof. Run `probe-answers.py --self-test` for its
non-ASCII-prefix and malformed/incomplete-log controls.

## VoiceOver heading

XCUITest cannot see the header trait: `XCUIElement.ElementType` has no
`.header`, `XCUIApplication` has no `headers` basket, and nothing in
XCUIAutomation's headers mentions header (checked in Xcode 27.0). Use the AXe
binary bundled with mobilebuildmcp instead:

```sh
AXE=$(find ~/.npm/_npx -path "*mobilebuildmcp/bundled/axe" | head -1)
"$AXE" describe-ui --udid SIMULATOR_UDID > /tmp/axe-tree.json
```

and look for `role: "AXHeading"`, `role_description: "heading"`, `AXLabel` =
the full name, frame width 240 at x 81 (402 − 2×81). `ReaderTitleProbe.swift`
in this folder covers what XCUITest can see — the labelled element and the
Appearance sheet's `Decrease/Increase margins` labels — by real taps.

What this cannot prove: a screenshot and the AXe tree say nothing about a
physical device's rendering, about Dynamic Type at the largest sizes (the title
does not scale by design), and `ReaderTitleProbe`'s label match proves the name
is exposed but not that VoiceOver *announces* it as a heading — that is the
AXe tree's role, and ultimately the owner's ear.
