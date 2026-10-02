# Highlight's own page and the embedded native palette (#122)

Appearance has one **Highlight** row below Alignment. It opens Highlight's
page in the same drawer (reader Actions › Appearance, and the walkthrough
harness's `appearsheet`): a pinned sample, the Blue and Amber Aa tiles, the
Sentence | Word segmented control, and below them, in the drawer's scrolling
area, **UIKit's own colour palette** (`UIColorPickerViewController`, embedded
by `modules/open-reader-palette`, the local Expo module) — Grid, Spectrum and
Sliders tabs, an OPACITY slider and the swatch row. No "Colors" title and no
eyedropper (`supportsEyedropper = false` on iOS 26+). The wells of #118 are
gone; that recipe's picker findings remain history.

Prerequisites: a Debug build **installed after `pod install`** — the palette
is a new local native module, so a Metro refresh alone cannot produce it —
launched with `-RCT_jsLocation`; a Document open; nothing playing. The paused
seek (the player's own Next sentence) is enough to put the sentence band on
the page; the word band needs a spoken word, so the sample carries both marks
while the page above shows the sentence's.

## Getting there, by real touches

```sh
python3 test/manual-test/kit/ax.py UDID touch "More actions"
python3 test/manual-test/kit/ax.py UDID touch "Appearance"
python3 test/manual-test/kit/ax.py UDID touch "Highlight"
```

Back (`Back from Highlight`) returns to Appearance; dismissing the drawer and
reopening it starts at the menu, outside the editor. The palette itself is
**invisible to `snapshot_ui`/AXe's tree** (remote UIKit content), so the
palette is driven by AXe coordinates in points (`axe touch -x -y --down --up`,
`axe drag`); everything else answers semantic touches. A grid cell selects on
touch-**down**, and a slow drag on the grid selects where it lands while a
fast `axe swipe` fling is what scrolls the palette's area (`../pitfalls/mcp.md`).

## What real touches proved (2026-10-02, 6660541, iPhone 17, iOS 27.0)

- The sample reads `Rain fell. Birds sang.` on one line — `Rain fell.` unmarked,
  `Birds` in the sentence mark, `sang` in the word mark — never scrolling away,
  at the Drawer Height and Expanded, through every palette edit.
- A grid touch changed only the editing target's mark and the stored setting
  kept the other mark and its opacity (sentence → `#b51a00`/60 with word still
  `#4456de`/50, then word → `#0056d6`/50 with the sentence untouched); the
  sample and the document band above the drawer repainted, burst screenshots
  putting the visual update inside 1.4 s of the touch.
- The palette's own OPACITY slider, dragged live, moved the sample's word mark
  through intermediate opacities (a mid-drag frame shows a half-faded mark) to
  6 % with the colour retained — `#791a3d`/06 — so dragging back restores.
- The Sliders tab's RED slider dragged 12 → 101 without a loop or crash: the
  `eventCount` acknowledgement in `PaletteEditor`/`select` holds against stale
  echoes under a continuous drag. (The rejected #122 RGB-editor RN sliders
  crashed here — "Maximum update depth exceeded" through `reading-host.tsx` —
  that code is gone.)
- The Blue tile sets both marks to Blue at 60 %/50 % and rings; Amber keeps
  22 %/62 %; a custom colour rings neither. Values were read back with
  `hx.cjs '{"do":"saysettings"}'` each time, not assumed.
- Persistence: across dismiss/reopen (menu first), Back and re-entry (the
  remounted palette shows the stored colour), and a cold relaunch.
- Both themes (the app's own setting, against the device's dark system):
  light- and dark-page composites on the sample and the document.
- `content_size accessibility-extra-large` shortens the sample to
  `Go. We run.` — still one line, letters never shrunk, both marks on it.
- Settings' version line read `1.0.0-beta19-debug` on the screen.

## What this cannot prove

Per-frame continuity (the burst is 450 ms apart), the exact byte UIKit rounds
a P3 swatch to (the cell that reads `(174, 25, 0)` on screen stored as
`#b51a00` — a colour-space conversion made inside UIKit), and anything about
speech: the palette was exercised entirely while paused, which is the state
the owner edits in.
