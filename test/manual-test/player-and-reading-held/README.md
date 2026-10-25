# The collapsed player and the held Reading

Each recipe is its own file. Read the one for what you are testing, or the one
that names the script or probe you are about to run.

- [reading-button.md](reading-button.md) (#67, ADR 0048): collapsing the
  player, the navigation bar and the Reading Button, paused and playing; the
  lock screen's Pause while collapsed; the edge swipe's reliability, buffering,
  a failure note while collapsed, and the dark theme. `reading-button.sh` with
  `ReadingButtonProbe.swift`.
- [reading-held.md](reading-held.md) (#68): leaving the reader while playing
  keeps the Reading, the Library's button back to it, and what ends it.
  `reading-held.sh` with `ReadingHeldProbe.swift`.
- [reading-held-book.md](reading-held-book.md) (#68): the held Reading crossing
  a section not yet rendered, on a real long book. `reading-held-book.sh` with
  `ReadingHeldBookProbe.swift`.
- [provider-disabled-while-held.md](provider-disabled-while-held.md) (#68): the
  Voice's Provider disabled while the Reading is held; a harness sequence, not a
  touch.
- [player-touch.md](player-touch.md) (#71): a real collapse and reopen during
  playback, and whether the page moves. `player-touch.sh` with
  `PlayerTouchProbe.swift`, around `place-and-following/line-follow.cjs`.

- [player-drag.md](player-drag.md) (#312): a drag on the open Player moves
  nothing, at the default and the largest text size, with and without a long
  note; past the navigation bar only the notes scroll. `player-drag.py`.

- [skips-while-playing.md](skips-while-playing.md) (#86): a tap, the four
  Skips and a Contents row while playing, with no wait between the press and
  the fetch; a fake Kokoro provider that logs every request
  (`fake-kokoro.cjs`) and `Tap86Probe.swift` for the real touches.

- [tap-lock-and-sleep-timer.md](tap-lock-and-sleep-timer.md) (#325, #326):
  the Player's Tap Lock and Sleep Timer: taps under the lock, and the timer's
  native menu, length and chapter stops, also with the device locked.
  `SleepMenuProbe.swift`.

- [engine-scheduling.md](engine-scheduling.md) (#157, #169, #158, #181):
  the playback engine's guards on the simulator — short late Clips at 3×
  reading a whole fixture to the end, rate changes mid-starvation, on a
  stopped Reading and on a refusal stop that re-cue nothing, and repeated
  seeks during pending decode landing on the latest generation; the #86
  fixture and fake Kokoro, slowed to 0.4 s Clips served 1.2 s late.

`player-centre.py` has no recipe: whether the Voice name is centred in the
player, from a screenshot (#70). Its header says how to run it;
[pitfalls/providers-and-audio.md](../pitfalls/providers-and-audio.md) has a
result from it.
