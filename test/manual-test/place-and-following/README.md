# The reading place and the page following it

Each recipe is its own file. Read the one for what you are testing, or the one
that names the script or probe you are about to run.

- [chapter-boundary.md](chapter-boundary.md) (#26, #45, #46): reading from a
  downloaded chapter into one that is not, sentences that failed retried by
  Play, and a place kept when sections render out of order.
  `fixtures/boundary-fixture.ts`, the kit's `download-chapter.cjs`.
- [play-scrolled-away.md](play-scrolled-away.md) (#50, #51): Play with the
  reading's section scrolled off the page, and a book reopened on a chapter
  heading. `follow-probe.cjs`.
- [browse-while-paused.md](browse-while-paused.md) (#52): a Contents row while
  paused moves the page and not the reading, through the harness and by real
  touches, with a sentence tap and a drag. `browse-probe.cjs`,
  `BrowseTouchProbe.swift`, `browse-touch-state.cjs`.
- [line-follow.md](line-follow.md) (#71): the page gliding to each new spoken
  line, its timing and where it rests against the Line Position, paused skips,
  whole-sentence Clips, the player collapsing or showing a note, and
  `arm`/`analyse` around a real touch. `line-follow.cjs`.
- [glide-touch.md](glide-touch.md) (#71, ADR 0050): a real drag during a live
  glide, a jump across several sections, and a Font Size change while playing.
  `glide-touch.cjs`, `glide-touch.sh` with `GlideTouchProbe.swift`.
- [following-and-continuous.md](following-and-continuous.md) (#71 batches 3 and
  4, design 0050): the Following mark, the way back, the collapsed lock, and
  Continuous scrolling's drift, trims and flings. `FollowingProbe.swift` with
  `following-touch.sh`, `continuous-follow.cjs`, the kit's `hx.cjs`.
- [follow-fixes.md](follow-fixes.md) (#71): the review fixes, a pause, a re-cue
  and a Block crossing. `follow-fixes.cjs`.
- [background-crossing.md](background-crossing.md) (#112): a section crossed
  with the app away from the screen, and the queue race that stopped the
  owner's reading for good. `background-crossing.sh`, `queue-race-arm.js`,
  `queue-race-read.js`.

`PausedTransportProbe.swift` has no recipe: Play after an idle pause and a
paused word tap by real touches (#26, #45, #46, #49). Its header says what it
needs; [pitfalls/screenshots.md](../pitfalls/screenshots.md) has its
`-only-testing` form.
