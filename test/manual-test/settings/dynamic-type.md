# Dynamic Type rows and player (#62, #114, #101, #102)

The owner accepts this batch on the physical iPhone. Simulator results establish
regressions only. Do not infer complete visible text from a complete AX label.

## Visible row text across all sizes, without restarting

Open the desired screen in the running Debug app. For General, choose paragraph
pause `2000 ms`. Run with a command timeout of at least 600 seconds:

```sh
bash test/manual-test/settings/dynamic-type.sh UDID /tmp/openreader-type-general \
  'Pause between paragraphs, 2000 ms' 'Pause between paragraphs' '2000 ms'
```

The script walks all twelve sizes up and down, scrolls the named row fully onto
the screen, saves screenshots and checks their recognized **visible** text with
Apple Vision. It restores `large` on exit and never restarts or plays. The same
script on Acknowledgements:

```sh
bash test/manual-test/settings/dynamic-type.sh UDID /tmp/openreader-type-ack \
  'ConcurrentQueue, BSD-2-Clause OR BSL-1.0' 'ConcurrentQueue' 'BSD-2-Clause OR BSL-1.0'
```

Also inspect fast_float and WebKit Web Audio, and Translation's Translate into
row with Simplified Chinese chosen. OCR failures can be recognition errors or
an unsettled transition: keep every failure and inspect its screenshot, rather
than suppressing the assertion. OCR cannot prove glyph bounds, hit areas or
all 132 rows; `acknowledgements-check.py UDID list` separately verifies the full
accessible inventory without assuming 53-point rows. Check native menu opening,
selection, fixed order, current check and outside dismissal by actual touches.

The helper may also be compiled once to check a captured frame:

```sh
swiftc test/manual-test/settings/visible-text.swift -o /tmp/openreader-visible-text
/tmp/openreader-visible-text /tmp/frame.png 'Pause between paragraphs' '2000 ms'
```

## Player and Library

Use an owner's EPUB from `~/Works/epub_books`, staged per the kit guide. No audio
is necessary. At each size inspect full speed text and A/M, the Voice, notes,
Contents, all transport buttons, and the speed popover. Check a step in both
directions, hold/release, outside dismissal without activating the underlying
button, and collapse/expand with no document jump. Repeat while the app remains
mounted, largest to smallest as well as the reverse. Existing notes deliberately
force the expanded player; for collapse testing use an enabled Provider and a
valid selected Voice with no error note, without playing.

For #102, start in Library at `large`, send the app to the background, change to
`extra-extra-extra-large`, and bring the **same process** back. Check the entire
progress line, then maximum accessibility and back to `large`. Do not terminate
or cold-launch between changes. Include a two-line title and a Folder. Current
LibraryRow already follows fontScale after #121; a non-reproduction is not a
new fix. Record it explicitly and keep the owner's physical check outstanding.

## Limits and recorded failures

The initial pre-fix XXL General frame read `Pause between paragrapt 200...` and
failed the full-label OCR check. Structural tests are only wiring tripwires;
`player-layout.test.ts` tests the size/reflow arithmetic, not native pixels.
An initial player OCR invocation expected `1.00` when the selected rate was
`1.50`; that verdict is invalid and cannot establish a before/after fix.
A screenshot taken during reader opening still showed Library; wait for the
reader's stable controls before capturing. Development LogBox banners can cover
the speed target; dismiss them before touch checks, preserve their warnings,
and do not confuse a covered target with a failed popover.
