# A real collapse and reopen during live playback (#71, `player-touch.sh`)

```sh
node test/manual-test/place-and-following/line-follow.cjs SIMULATOR_UDID METRO_LOG arm
bash test/manual-test/player-and-reading-held/player-touch.sh SIMULATOR_UDID NEW_OUTPUT_DIR_OR_EXISTING_PROJECT_DIR \
  -only-testing:testCollapseAndReopenDuringPlaybackRealTouch
node test/manual-test/place-and-following/line-follow.cjs SIMULATOR_UDID METRO_LOG analyse
```

Neither `line-follow.cjs`'s own single-process run nor `glide-touch.cjs` touches
the player's own controls (only the WebView), so a real collapse and a real
reopen needed a third pair in the same `arm`/`analyse` shape.
`PlayerTouchProbe.testCollapseAndReopenDuringPlaybackRealTouch` (`.activate()`
only, the same convention as `testHeadRowTouches`: needs a Document already
open, paused, on a sentence with Word Timings, the player expanded) taps Play,
waits 1.5 s into the reading, taps "Collapse the player", waits 7 s collapsed
(2-3 s per line, this book, so comfortably more than the two line changes
wanted), then taps the collapsed pill's own button. There is no separate expand
gesture while playing: the collapsed state offers only the one Play/Pause
button, and a real Pause is what reopens the player
(`reading-view.tsx`'s `setCollapsed(false)`) — so reopening here also pauses,
the current behaviour and not a limitation of the probe. `Executed 1 test, with
0 failures (0 unexpected) in 21.002 (21.014) seconds` (2026-09-26).

`analyse` read back four line changes, all resting 0.4 px from the 60 %
target (374 px): one just after the real Play (69604 ms into the still-running
recording), two more while collapsed (72654, 75513: `msg … inset bottom 52
open 134.667` at 69843 sits inside the first episode's own window, well before
either), a fourth still collapsed (78054), then the reopen tap
(`msg 78680 inset bottom 134.667 open 134.667`, `open` unchanged throughout,
exactly ADR 0050's point) with the reading already paused (`msg 78440 hold`)
and nothing further moving. The run's `other` array was empty: no unmatched
scroll at the collapse message, the reopen message, or in between.
