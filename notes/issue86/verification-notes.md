# Issue #86 verification — measurements (2026-09-29)

iPhone 18 issue86 (`9F8F6EE8-90A7-411E-AF61-54700D1E12E5`, iOS 27.0), tree
`xujialiu/logic--ios-test` at 3c54209, Metro 8099 (PID 61919), fake Kokoro
`fake-kokoro.cjs` on `127.0.0.1:8791` (PID 67280). The app's Debug Log stamps
+08:00; the fake server's log stamps UTC (add 8 h to compare).

Verdict: **PASS** — every expected result reproduced; no application defect
found.

| # | Fact | Evidence |
|---|------|----------|
| 1 | Tap while playing: stop at press, immediate seek, highlight never returns | 20:02:55 real tap mid-clip (rate 1.5): `seek to utterance 6` 55.421, next-cursor fetches 55.484 (+63 ms), 55.523; cue of 6 at 55.980; old queue's next (due ~55.78) never cued; pause at 7 |
| 2 | Five quick next-sentence presses end at start+5 | 20:10:54–55, presses 330–500 ms apart: from 1→2→3→4→5→6, each seek line the same ms as its skip line; pause at 6 |
| 3 | Four Skips while playing: immediate, no 600 ms gap | 20:12:09–17: prev-sentence 09.850 seek → fresh fetch of utt 11 (synthesis 09.984, +134 ms); next-sentence 12.520, next-paragraph 15.167, previous-paragraph 17.833 — all same-ms seeks, cache hits instant |
| 4 | Paused: tap and Skips move the highlight, no sound | 20:01:28 paused tap → `seek to utterance 6`, zero fetches; 20:16:01/05 paused skips 14→15→14, `playing=false` throughout, zero fetches |
| 5 | Contents row, text-less page, while playing (fixture, real touch) | 20:24:48.797 `contents row 2 while playing: utterance 20`; The Third Chapter heading+sentences fetched 49.10–49.18; old sentence's boundary 0.1 s away never cued; page moved to The Third Chapter (screenshot `after-volume-two.png`) |
| 6 | Contents row, unrendered chapter, while playing (real 仙逆, handler probe section 58) | 20:27:51.856 `wait for section 58`; 51.933 reported empty → `wait for section 59`; 52.179 first fetch of 第55章夺基大法 (+323 ms from press); **nothing fetched between press and then**; old clip (2.1 s left) never cued; reading resumed at the chapter's first sentence |

## Incidents and near-misses

- The new simulator's volume reset to 60 twice (~20:00 and ~20:24) after the
  boot `set` — the documented recurring reset. The second one caught a harness
  `{"do":"play"}` that had not been chained to the check: ~10 s played at
  volume 60 before `pause`. Recovered (`set`, relaunch), and the simulators
  pitfall file now records that the harness's `play` command does not check.
- The Contents sheet of the first fixture build said every row was unreachable
  (xhtml-nav href spelling) — fixture rebuilt with NCX contents; recorded in
  `fixtures/README.md`.
- The first E1 tap run (20:02) ran at rate 1.5 (default), so clips lasted
  1.67 s and the read-ahead had just reached the tapped utterance — the press
  was a cache-hit seek. Later runs pinned rate 1 (2.5 s clips) to keep the
  read-ahead window predictable.

## Not probed (remaining risks)

- The buffering spinner during a Contents wait (the real book's wait was
  ~300 ms; too fast to photograph).
- A Contents chapter that never reports; a voice switch during a wait; the
  lock screen during a wait.
- `readingFromRow`'s `end`/`nothing` branches on a device (unit-tested).
