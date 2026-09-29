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

- [skips-while-playing.md](skips-while-playing.md) (#86): a tap, the four
  Skips and a Contents row while playing, with no wait between the press and
  the fetch; a fake Kokoro provider that logs every request
  (`fake-kokoro.cjs`) and `Tap86Probe.swift` for the real touches.

`player-centre.py` has no recipe: whether the Voice name is centred in the
player, from a screenshot (#70). Its header says how to run it;
[pitfalls/providers-and-audio.md](../pitfalls/providers-and-audio.md) has a
result from it.
