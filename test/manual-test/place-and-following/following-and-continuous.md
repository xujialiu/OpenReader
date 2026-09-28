# The Following mark, the way back, the collapsed lock, and Continuous (#71 batches 3/4, `FollowingProbe.swift`, `hx.cjs`, `continuous-follow.cjs`)

Verifies design 0050/ADR 0050 batches 3 (A/M, the way back, the collapsed
lock) and 4 (Continuous) against this merge of main's #67 (the floating bar
and Reading Button) and #68 (the Reading held in the Library) into #71.
Needs a real book already on the shelf, well underway (this session used
"Cultivation Online" from `~/Works/epub_books`, already past section 20 of
48), Fish's "Laura" (Word Timings) the chosen Voice, and the app running
against this tree's Metro.

`hx.cjs` is a small generic harness sender the other scripts here lacked:

```sh
node test/manual-test/kit/hx.cjs SIMULATOR_UDID '{"do":"say"}'
node test/manual-test/kit/hx.cjs SIMULATOR_UDID '{"do":"settings","patch":{"following":{"scrolling":"continuous","linePosition":50}}}'
```

One JSON command, no `SECONDS`/mode arguments to get right — useful for the
setup/inspection half of any manual run (Pitfalls above: `following` is
patched as a whole object, both fields, every time, or the other one goes
back to `undefined`).

`FollowingProbe.swift` (`test/manual-test/place-and-following/following-touch.sh`, the same
`ManualTests.xcodeproj`/`LockScreenProbe` scheme shape as every other probe
here) holds two general-purpose methods driven by
`/tmp/openreader-following-params.txt` (`KEY=VALUE`, `SyncProbe.param`'s
convention) — `testDragPageByParams` (a drag or, with `VELOCITY` set, a
fling) and `testTapControlByParams` (`WHAT=A|M|Play|Pause|Collapse|
ShowPlayer|Contents|BodyText|ContentsAfterCurrentPlus:N`) — plus one bespoke
method per scenario batches 3/4 needed: fresh-open-before-any-Play (#53),
drag-then-return and Contents-then-return while paused, near/far drag then
M-tap while playing, the collapsed lock's full sequence, the Scrolling menu,
a Library round trip changing Line position and Scrolling live, the
Continuous drift stopping under a finger, and the automatic recovery rule
(two versions — see the Pitfalls above for why the second, Contents-based
one replaced the first). Every method is independent; run one at a time
with `-only-testing:testName`, since which state a given scenario needs
(paused/playing, By line/Continuous, collapsed/expanded) differs across
them and `.activate()` inherits whatever the previous run left.

`continuous-follow.cjs` is `line-follow.cjs`'s counterpart for Continuous's
own per-frame drift shape (step sizes, intervals, glides, rests), reusing an
independent recorder under `window.__continuousFollow` the same way
`glide-touch.cjs` keeps its own beside `line-follow.cjs`'s:

```sh
node test/manual-test/place-and-following/continuous-follow.cjs SIMULATOR_UDID METRO_LOG 20      # 1.0x
node test/manual-test/place-and-following/continuous-follow.cjs SIMULATOR_UDID METRO_LOG 10 2   # 2.0x, restores rate 1 after
```

Needs Continuous already chosen (it does not choose it); sends `play`,
waits SECONDS, `pause`s, and prints the drift step/interval distributions,
any glides (a run of 8+ consecutive moving frames covering 15+ px — the
Pitfalls above explain why not a time-gap grouping) and rests (12+ still
frames). Measured 2026-09-26: at 1.0×, 1170-1238 frames over ~22 s, drift
steps 1-4 px (median 1 px), intervals median 92-100 ms, 2 glides at
217-302 ms (rate 0.093-0.115 px/ms) and 12 rests of 183-534 ms; at 2.0×, 703
frames over ~12 s, the same 1-4 px steps, intervals roughly halved (median
50 ms — the drift's cadence follows the words, not its step size), 3 glides
at 217-234 ms (rate ~0.115-0.12 px/ms, not rate-scaled: a glide is a fixed
animation length) and 3 rests of 350-1130 ms.

Item 9's trim check reused `line-follow.cjs`'s own `arm`/`analyse` (its
`views` field does not care which scrolling mode is active): a genuine
continuous-playback window crossing one section boundary (utterance
175→227, section 23→24, over about five real minutes at this book's pace —
"derive the time from section length" was not a fast derivation here, this
book's sections are long) recorded zero `views` changes at all, and a
follow-up `--skips 45` run (Continuous still selected) forced one in
seconds: `views 8263 3->4 moving` then `views 23739 4->3 moving`, the trim
itself a single 16 ms frame (`-4090 px in 16 ms`) sitting between two
ordinary skip-glides that both rested within a pixel of target — the text
did not visibly move. Item 9's fling check reused the existing
`fling-jump.cjs SIMULATOR_UDID METRO_LOG down N` (#58) unmodified: 6 of 7
runs GREEN under Continuous, 1 RED (a blank+jump matching the pre-#58
signature exactly); a same-day, same-position comparison under By line was
3 of 3 GREEN. `FlingProbe` never plays, so Continuous's own drift mechanism
was inactive throughout every one of these runs regardless of which
scrolling mode was selected, which is why this reads as the
already-documented class of gesture/timing flakiness in this probe rather
than a Continuous-specific regression — reported to the implementing agent
as a finding worth a slightly larger sample, not as a confirmed defect.
