# Reading the end-spacer geometry over the harness (#371)

`end-spacer-geometry.js` sends one read-only probe into the running reader and
answers the Debug Log's `[probe] …` line: the stage scroll box, the `#ending`
range in viewport CSS pixels (one of these is one screen point on this
device), the installed reserve rule, and the scroll remaining. It measures
nothing painted; the card's frame comes from the paired screenshot or the AX
tree, never from the container's client bottom.

```sh
node test/manual-test/player-and-reading-held/end-spacer-geometry.js SIMULATOR_UDID
```

Used 2026-11-21 on the beta8 verification: at the drag limit with the Player
open (`remaining 0`, ending viewport 652–680) and again after the completion
note arrived (`remaining 0`, ending viewport 620–648, note card at real
screen y ≈ 740–853 pt from the screenshot). What it cannot prove: the painted
Player's frame, and anything outside the one line it probes.
