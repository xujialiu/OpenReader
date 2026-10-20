# The sentence-boundary batch, and the preparation it invalidates (#240, #245, #241, #242) — 1.0.0 (9)-beta18

Record of the final iOS verification of `xujialiu/fix_2--ios-segmentation` at
6a9c2f3 (batch commits `fbdd7d1` boundary repairs, `9451d12` three-letter
aliases, `b8c9843` preparation revision/migration), run 2026-10-20
~17:25–18:10 (+08:00). One Debug build from the batch tree (Xcode 27.0,
iphonesimulator, derived data outside the repository); the binary carries main's
Library-preservation native side — `git diff f12eefc..6a9c2f3 -- ios/` is
empty, so one binary served both the pre-batch baseline and the batch
JavaScript. Session-owned iOS 26.5 simulator `iPhone 17 seg18`
(UDID `F5A43FD4-697E-458F-81DC-16423F51ECCE`), created for this run. Two
Metros: 8095 from this worktree (batch JS, patched `sentencex` via npm ci's
`patch-package`) and 8096 from a detached `.worktrees/legacy-js` checkout of
**f12eefc** (`1.0.0 (9)-beta17`) with `npm ci --ignore-scripts`, so its
`sentencex` 0.4.2 is **unpatched** — the true pre-batch rules. The app was
switched between them by `simctl spawn … defaults write top.xujialiu.openreader
RCT_jsLocation` and a relaunch; no app-source edit was made for seeding. The
Provider is the app's Local Kokoro against `fake-kokoro-two-voices.cjs` on
127.0.0.1:8812 (voice `af_bella`), a controlled local TTS: no paid request was
made, and its log records every synthesis request's exact text.

## Fixtures

`fixtures/segmentation-fixture.ts` writes seven one-chapter EPUBs holding the
batch's own example sentences: `seg-zh` (`zh`), `seg-ja` (`ja`),
`seg-en-negs` (`en`), `seg-ellipsis` (`en`), `seg-deu` (`deu`), `seg-ger`
(`ger`), `seg-de` (`de`). Imported through the harness (`add`); ids in the run
log. Expected cuts were computed from the patched package before the device run
and then compared with the app's own lists and request log.

## Pre-batch baseline (beta17 JS, unpatched sentencex, through the app Reading)

`walk-utts.cjs` over every book on Metro 8096 — the Reading's actual
Utterance lists (`records/prebatch-utterances.txt`):

- zh/ja: `这是第一句。2024年发生了很多事。` and `これは最初の文です。2024年の出来事でした。` are **one** Utterance each (the digit suppresses the CJK stop), and the lowercase-Latin paragraphs are one each (#240's faults).
- en-negs: `She said no. He left.` and `He looked at me. I smiled.` are **welded** (#245's faults); `Dr. Smith` and `No. 5` were already abbreviations.
- ellipsis: `I was thinking...` / `maybe we should go.` split, and the spaced ellipsis mangles into `Wait .` / `.` / `.` / `what happened here.` (#241's faults).
- deu/ger: `Er wurde am 3.` + `Oktober 1990 in Berlin geboren.` — the English rules, because neither alias reached the German ones (#242's fault); the `de` control already split correctly.

## Legacy Downloads staged on that baseline (real catalogue, real SQLite)

Downloads through the app's own offline runtime (`download-chapter.cjs` and the
same runtime module over CDP), all voice `af_bella`, Provider Local Kokoro →
the fake:

- `seg-en-negs`: task **done**, 88,039 bytes, 7 requests — the old joined texts (`She said no. He left.`, `He looked at me. I smiled.`) are in the fake's log.
- `seg-ellipsis`: task **done**, 7 requests (old cuts, incl. `Wait .`).
- `seg-zh`: task **done**, 3 requests (heading + two joined paragraphs; one request was refused on purpose once and succeeded on the retry).
- `seg-ja`: **paused unfinished** — enqueued under the legacy runtime, one chapter `nav.0`, the fake slowed to 3,000 ms/request, `toggleTask` paused it mid-chapter after 2 of 3 sentences (`分割`, `これは最初の文です。2024年の出来事でした。`); `task-state` read `paused`, the third sentence never fetched.
- `seg-deu`/`seg-ger`/`seg-de`: never downloaded (Reading-only).

Consent preflight: the first synthesis raised `Send text to the server at
127.0.0.1:8812?`; the recipient was checked against the fake's address and
answered Allow once (`ax.py alert-touch Allow`); every later request went
unattended.

## The migration (switch to beta18 JS, same binary)

Relaunch on Metro 8095 at 17:44:50; the new Debug Log opens `[launch]
OpenReader 1.0.0 (9)-beta18 … cleared the Debug Log of 1.0.0 (9)-beta17`. Then:

- **Zero automatic synthesis.** The fake's log gains no `text=` line at the migration launch or across a second restart — only the voice-inventory GETs.
- **SQLite (app terminated, `Documents/offline-narration-v2/catalog.sqlite`)**: `state` holds `walk|2` and the **new row `segmentation|1`**; every nonempty prepared chapter of the four downloaded documents reads `prepared=0`; the `tasks` JSON holds the three `done` tasks unchanged and the ja task `paused` with `paused:["nav.0"]`.
- **Old audio kept**: clip counts unchanged at the first read (en-negs 7, ellipsis 7, zh 3, ja 2), and the joined clip key `06f126c9…` (= sha256 of `She said no. He left.`) still present after everything.
- **False completeness lost, without restarting**: en-negs's Download drawer (real touches: Actions → Download) reads `0 chapters downloaded`, the `Boundaries` row unchecked — while `Use downloaded voice · af_bella` is still offered and Manage · af_bella still reads `0.1 MB saved` (shots 01–03).
- **Persistently paused across restart**: a second terminate+launch left ja `paused` via the runtime read and the drawer (`Resume all`, ring `2 / 3`, shot 04), still with zero synthesis.

## Explicit continuation fetches only changed text

- **ja — Resume (real touch on `Resume all`)**: exactly 4 requests, exactly the 4 new-cut texts (`これは最初の文です。`, `2024年の出来事でした。`, `次の文です。`, `abcから始まる文。`); the joined clip and the heading were **not** re-fetched; the row then reads `分割, downloaded` and the drawer `1 chapter downloaded`.
- **en-negs — explicit re-download (drawer: Select all → Download selected (1), real touches)**: exactly 4 requests (`She said no.`, `He left.`, `He looked at me.`, `I smiled.`); nothing for the 4 unchanged sentences or the heading — disk audio reused; the row reads `Boundaries, downloaded` (shot 06). Clip count 7 → 11, the 7 legacy rows (joined ones included) untouched in SQLite.

## The batch's cuts through the app (beta18)

`walk-utts.cjs` over all seven books on 8095 — every list is the intended one:
zh/ja split at the CJK stop before the digit and before lowercase Latin;
`She said no.` / `He left.` and `He looked at me.` / `I smiled.` split while
`Dr. Smith arrived early.` / `He was polite.` / `Item No. 5 is missing.` /
`We searched everywhere.` stay; `I was thinking... maybe we should go.` and
`Wait . . . what happened here.` are single Utterances while the capitalized
control splits and `She paused… then continued speaking.` stays whole; deu, ger
and de all give `Er wurde am 3. Oktober 1990 in Berlin geboren.` +
`Dann zog er um.`.

Plays (each chained behind `silence.sh set && check`, 7–8 s, stopped at the
fact; durations from the 2.5 s fake clip at rate 1.5):

- **#240 (seg-zh)**: real touch seeked to utterance 2; the play requested exactly `2024年发生了很多事。`, `中文的句子。`, `abc接着写下去。`; `zh-play-2s.png` paints the band on `中文的句子。` alone and `zh-play-5s.png` on `abc接着写下去。` — the Next transition, one sentence per band.
- **#245 (seg-en-negs)**: playback from `He left.` (clips reused, no new requests); `ennegs-play-2s.png` paints the band on `He looked at me.` and not past `me.` — the repaired boundary, painted.
- **#241 (seg-ellipsis)**: the play fetched exactly `I was thinking... maybe we should go.` and `Wait . . . what happened here.` (both whole); `ell-play-2s.png` paints one band across the spaced ellipsis.
- **#242**: the deu, ger and de plays each requested exactly `Er wurde am 3. Oktober 1990 in Berlin geboren.` + `Dann zog er um.` — the German rules from the EPUB's `dc:language`, the alias path included.
- Settings on the batch JS reads `Version 1.0.0 (9)-beta18-debug` (shot 10); warning capture shows only benign `onAnimatedValueUpdate` lines.

## Raw artifacts (`/tmp/or-seg18-01/`)

- `fake-tts.log` — every synthesis request of the run in order (1–19), with the on-purpose refusals; the segmenter's request evidence throughout.
- `records/prebatch-utterances.txt`, `records/debug-log-pre-final.txt` (491 lines, opens with the beta18 launch and the beta17 clearing), `records/dl-legacy-*.log`.
- `shots/00…10-*.png` — 00 is the legacy phase's Settings showing `1.0.0 (9)-beta16-debug` (the first baseline attempt, Metro 8096 at 9451d12; the worktree was then re-pinned to f12eefc and 8096 restarted — the pre-batch relaunch itself is proven by 8096's cwd/checkout and by the deu/ger English split only that tree produces); post-migration drawer 01, Manage 02/03, ja paused 04 and resumed 05, en-negs re-downloaded 06, the root-level-sheet state 07/08, the clean reader 09, beta18 Settings 10; `zh-play-*.png`, `ennegs-play-*.png`, `ell-play-*.png`, `deu-play-5s.png`, `ger-play-5s.png`, `de-play-5s.png`, `ja-play-5s.png`.
- `phase1.json` (guard record: the first readiness attempt exited 69 — CDP checked 2 s after launch, before the 15 s bundle finished; the immediate recheck passed, no recovery spent), `readiness/`, `metro-8095.log`, `metro-8096.log`, `xcodebuild.log`, `prebuild.log`, `pod-install.log`.
- No XCTest probe ran in this verification; there are no `test.log` `Executed` lines to quote — the evidence is the app's own lists, its request log, SQLite and screenshots.

## What this cannot prove

- `walk-utts.cjs` reads the Reading's Utterance list, not the painted highlight; the painted evidence is the play screenshots and the seek lines.
- The catalogue was read while the app was terminated; while it runs, the drawer and the runtime reads stand in.
- The fake's word timings are its own reported ones, not audio-waveform measurements; its clips are silence, so "plays" is established by the app's own `level=word` state, the request log and the painted bands, not by sound.
- The revision's transaction-ordering guarantees (pauses saved before the revision row; rollback on failure) are covered by `test/offline/runtime-segmentation.test.ts` on the host; on the simulator I exercised the happy migration, the persisted pause and the failed-pause-then-retry path only as far as staging them deterministically allows — I did not kill the app mid-migration.
- `seg-ellipsis` and `seg-zh` keep their legacy Downloads (done, old clips) and were deliberately **not** re-downloaded; their completeness is still lost until an explicit download — that is the ADR's stated cost, observed on en-negs, not a separate defect.

## Rerun mechanics (the parts that bit)

- `fake-kokoro-two-voices.cjs` refuses only when started with
  `OPENREADER_FAKE_TTS_REFUSE=<control file>`; the file is read per request and
  `refuseFrom` compares against the process's own served counter, so recompute
  it after every restart. A refused chapter leaves the task `done` with
  `failed:[chapter]` — to stage a genuinely unfinished (pausable) download,
  slow the fake with `OPENREADER_FAKE_TTS_DELAY_MS` and pause it mid-flight
  (`toggleTask` over CDP), as the ja staging did.
- `cdp.cjs --eval` takes a file, not an inline expression.
