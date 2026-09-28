# A live theme change with a drawer already open (#29, `live-theme-drawer.sh`)

`line-colour.sh` always opens a drawer after the theme is already set, so it
cannot show whether an *open* drawer's lines follow a theme changed while the
drawer stays on screen — the one path ADR 0046 made depend on a React
re-render, where every other colour in `INK` needed none.

```sh
bash test/manual-test/scrolling-and-theme/live-theme-drawer.sh SIMULATOR_UDID NEW_OUTPUT_DIR dark light
```

Needs `A Short Test of Reading Aloud` in the Library and this tree's Metro.
`LineColourProbe.testOpenContentsAndLeaveIt` opens Contents by real taps and
leaves it open; the script then photographs it, pushes a theme patch through
the harness without touching the simulator's own appearance, photographs the
same drawer again with no reopen in between, and scores each photograph with
`line-colour.py` against the theme that should be in force at that point. It
restores the starting theme and closes the drawer (`{"do":"shut"}`) before
exiting. Plays nothing. Exit 1 = RED (the drawer did not read as the theme in
force at that point), 0 = GREEN, 3 = the probe itself failed, so the
screenshots may not show the drawer.

Measured 2026-09-24 (ios-tester, `0.0.2-beta22`): dark → light with the
simulator's own appearance kept light throughout — Contents' top edge and
both separators (y=866/1421/1559) read `#33333c` before the patch and
`#dcdce2` after it, at the same rows, with no reopen between the two
screenshots. GREEN.
