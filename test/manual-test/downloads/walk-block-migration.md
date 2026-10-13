# The Block-walk migration, one Block per item/drop cap/line (#184, #189, #192) — 1.0.0 (8)-beta15

Record of the final iOS verification of `xujialiu/fix--b15-verify` at c52379a
(`1.0.0 (8)-beta15`, change `42a286c`), run 2026-10-14 03:52–04:24. One Debug
build from the b15-verify tree (native identical to beta14's); the migration
baseline ran the same binary against beta14 JavaScript from Metro, then the
beta15 JavaScript from Metro on the same port. Simulator: `or-fix-b15-verify`
(iPhone 17, iOS 27.0), UDID `FFDC9F36-0C61-4B2E-8C7B-B8F7262D7FD0`, created for
this run. Metro on 8093, first from `…/fix/.worktrees/b14-base` (detached at
da25b9e), then from `…/fix/.worktrees/b15-verify`; the app was launched with
`-RCT_jsLocation localhost:8093` on every launch.

## What ran

- Fixture `/tmp/orissues/fixture/walk-fixture-184.epub` imported through the
  harness (`add`): `sha256:204baf28…`, titled `walk-fixture-184`.
- Fish Audio configured on the provider page (key from
  `~/.secrets/openreader/fish_audio_apikey_2.txt`, typed per character through
  `axe batch`; exact readback checked before Enable; "Connection successful").
- Consent preflight: the first synthesis held on "Send text to Fish Audio?"
  (`ax.py alert` named Fish Audio and the document text); answered Allow there.
- Downloads driven by `kit/download-chapter.cjs` (the app's own offline
  runtime, voice Sarah `en/933563129e564b19a115bedd57b7406a`), request texts
  recorded by the harness's `watchfetch` on `fish.audio` into the Debug Log.
- Reading checks through real touches (`axe touch` points), the harness's
  `seek`/`section`/`say`, and `downloads/walk-utts.cjs`, which reads the open
  Reading's Utterance list off the React fiber tree through CDP.

## beta14 baseline (Metro from b14-base)

- Settings showed `1.0.0 (8)-beta14-debug`; the fixture's Reading reported
  `known=13`.
- Download of all 3 chapters: task `done`, 198,722 bytes, no failures. The
  Provider was asked for **13** sentences — exactly the pre-fix welds:
  `Chapter 1:Nightmare Begins`, `T`, `he door opened.`,
  `lower cost faster startup fewer moving parts`, `smaller files quicker
  builds`, `Roses are redviolets are blue`, plus the 7 unchanged ones
  (`/tmp/or-b15-records/debug-log-b14.txt`, `[hx] fetch POST …/v1/tts` lines).
- Download drawer (after "Use downloaded voice"): "3 chapters downloaded",
  every row `, downloaded`.

## beta15: the migration (Metro switched to b15-verify, app relaunched)

- Settings showed `1.0.0 (8)-beta15-debug`. The fixture's Reading now reports
  `known=15`.
- Download drawer without any download in between: "0 chapters downloaded",
  rows without `, downloaded` — the checks were lost. Contents: no Downloaded
  checks on the three rows. Manage downloads: all three chapters still listed,
  "0.2 MB saved", Delete all/Delete selected offered.
- Download of all 3 chapters again: task `done` in ~9 s (was 37 s fresh),
  bytes 198,722 → 308,008, and the Provider was asked for **exactly 8**
  sentences — the 8 changed ones, and none of the unchanged ones:
  `Chapter 1:\nNightmare Begins`, `The door opened.`, `lower cost`,
  `faster startup`, `fewer moving parts`, `smaller files`, `quicker builds`,
  `Roses are red\nviolets are blue` (short ones carry the `[Speak in English]`
  language hint at request time). Record:
  `/tmp/or-b15-records/debug-log-b15-redownload.txt`.
- Afterwards "3 chapters downloaded" again, rows `, downloaded`, Contents rows
  `, downloaded`. A further relaunch kept all of it (the walk is recorded; no
  second reset).

## Reading on beta15

- `walk-utts.cjs` over the fixture returned the 15 expected sentences,
  including `Chapter 1:\nNightmare Begins`, `The door opened.`, the five
  one-per-item list sentences and `Roses are red\nviolets are blue`.
- Real touch on "faster startup" (ch2): the seek landed on Utterance 8 of 15
  (`seek to utterance 7`, 0-based) and the painted highlight covered only that
  item (`15-faster-startup-highlight.png`).
- Real touch on "door" (ch1): highlight covered the floated drop cap **T**
  together with "he door opened." and not "It was late."
  (`17-door-opened-highlight.png`).
- Pride and Prejudice - original (`sha256:173688ad…`), Chapter I: the
  Reading's Utterance 399 is `IT is a truth universally acknowledged, that a
  single man in possession\nof a good fortune …` — the drop cap I inside the
  sentence; seeking there paints the highlight over the big I and the rest of
  the sentence as one band (`20-pp-IT-highlight.png`).
- Play ~7 s on Chapter I's second paragraph ("However little known…", Fish):
  three normal sentences synthesized with word timings (7/19/46), the sentence
  band on the whole sentence and the word band on "be"
  (`21b-pp-playing.png`). Stopped after the fact.
- Shadow Slave 1-250 (`sha256:9d9f03aa…`), chapter 1: the chapter's own
  heading Utterance is `Chapter 1:\nNightmare Begins` (the ToC row above it is
  its own single-line sentence); seeking to it paints one highlight over both
  lines, `CHAPTER 1:` and `NIGHTMARE BEGINS` (`23-ss-ch1-heading.png`).
- Play on the fixture heading (utterance 0): a first play ran ~6 s (cached
  clips; by its t4 shot the reading was already on "She waited…", word band on
  "waited"). A second, tighter run caught the fact at t≈1.0 s
  (`27-play2-t1.png`): the sentence band spans both lines of the heading and
  the word band is on **Nightmare**, reaching the line break. Playback stopped
  ~2.9 s after that play began; every play was chained behind
  `silence.sh set && silence.sh check` (volume 0 held throughout).

## Raw artifacts

- `/tmp/or-b15-shots/00…29-*.png` — screenshots quoted above (00 launch, 01
  beta14 Settings, 04 Fish enabled, 05 consent alert, 07/08 beta14 drawer,
  09 beta15 Settings, 10 Manage downloads, 11 Contents without checks, 12/13
  after re-download, 14–17 fixture highlights, 18–21 P&P, 22–23 Shadow Slave,
  24–29 the plays).
- `/tmp/or-b15-records/debug-log-{b14,b15-launch,b15-redownload,final}.txt` —
  the app's Debug Log at each stage (request texts, seek lines, levels).
- `/tmp/or-b15-records/b15-fixture-utterances.json` — the fixture's 15
  Utterances as read through CDP.
- `/tmp/or-b14-metro.log`, `/tmp/or-b15-metro.log`, `/tmp/or-b15-build.log`,
  `/tmp/or-b15-prebuild.log`, `/tmp/or-b15-dl-b14.log` — Metro and build logs.

## What this cannot prove

- `walk-utts.cjs` reads the Reading's own Utterance list, not the painted
  highlight; the highlight evidence is the screenshots and the seek lines.
- The catalogue's `state` row `walk` was not read out of the SQLite file
  directly (the app was running); the no-second-reset evidence is the checks
  surviving the third launch.
- Fish's word timings were measured as reported (`level=word`,
  `reportsWordTimings=true`), not against the audio waveform.
