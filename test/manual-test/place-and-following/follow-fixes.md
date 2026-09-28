# The review fixes: a pause, a re-cue, a Block crossing (#71, `follow-fixes.cjs`)

```sh
node test/manual-test/place-and-following/follow-fixes.cjs SIMULATOR_UDID METRO_LOG pause 15
node test/manual-test/place-and-following/follow-fixes.cjs SIMULATOR_UDID METRO_LOG recue
node test/manual-test/place-and-following/follow-fixes.cjs SIMULATOR_UDID METRO_LOG paragraph 12
```

Needs the reader open and paused, a Voice with Word Timings, and the simulator
silenced; it chooses nothing in Settings, so set Scrolling first with `hx.cjs`
(pause and paragraph are Continuous's). Its recorder, `window.__followFixesV2`,
logs every drawn frame's `scrollTop`, every message the highlighter is sent
(with a speak's Utterance, `reveal`, `recover` and first Block), and every A/M
the program posts, on one clock, and re-wraps the program on every arm. `pause`
is GREEN when nothing moved after the `hold`; `recue` puts the page in M with
the program's own `browse` message once a second sentence has begun, changes
the speed (and puts it back), and is GREEN when the re-cue moved nothing and
posted no A before the next Utterance; `paragraph` lists every run of moving
frames. Measured 2026-09-26 15:57–16:02 (notes).
