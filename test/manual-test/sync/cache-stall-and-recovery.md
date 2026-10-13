# Cache, the stalled download, and the switch-on recovery (#166, #168, #177)

Verified on the simulator, 2026-10-13, against `1.0.0 (8)-beta7-debug` at
11a890c on `xujialiu/fix2--ios-sync`. Simulator: `fix2-sync`, a dedicated
iPhone 17 Pro on iOS 27.0 (UDID `4F994805-2BD3-489F-A582-D96AA1C2F2D4`),
Debug build from the worktree, JavaScript from the worktree's own Metro on
port 8093. Everything here is this run's measurement, not a general recipe.

## The tools this run added

- **`cacheable-dav.cjs`** — the controlled WebDAV stub the three issues need
  in one process: every GET answers cacheable (`Cache-Control: public,
  max-age=3600`, a backdated `Last-Modified`, an `ETag`, **and a `Date`
  header** — without `Date` NSURLCache stores nothing, see Pitfalls), a
  one-shot stalled GET (`/__stall?on=1`) that sends success headers and then
  never the body and logs the close with its elapsed time, a password list
  (`/__accept?list=a,b`, `list=*` for anything) whose rejects answer 401,
  content swap by POST to `/__set`, and full request-header logging with the
  Authorization masked. State under `/tmp/openreader-fix2-dav/`.

  ```sh
  node test/manual-test/sync/cacheable-dav.cjs 8765
  curl -s http://127.0.0.1:8765/__state
  ```

- **`SyncRecoveryProbe.swift`** — `testFailThenRecoverInWindow`: relaunches
  the app (whose launch sync then meets the stub's 401), waits for the failed
  line on the Sync screen, switches off, clears and retypes the new password
  (files, mode 600), switches on, requires the `Synced at` line, then idles
  45 s on the screen so the host can read the stub's counters around it. It
  prints a `RECOVERY` line with a wall-clock for each step.

## #166 — the older file that the cache holds (green path and negative control)

The app's own first uploads (PUT) gave two real, document-matching places:
PUT #1 (utterance 11, "The second chapter begins here…") and PUT #3
(utterance 15, "The middle of the second chapter…"). From those the host
crafted two served files, each stamped ahead of the app so the merge must
take it, under device `fix2-desktop`:

- **v_old** = PUT #1's place, stamp +45 s. A real-touch Play pressed at
  12:31:… — the Debug Log shows `play: ok, 1 items in the file, 1 places
  taken` and `[reading] play at utterance 11` (it moved *back* from 15), the
  stub's GET line carries `cache-control="no-cache"`. The cache now holds
  v_old as fresh (max-age 3600).
- **v_new** = PUT #3's place, stamp +90 s, swapped in while the app sat idle
  and paused (no sync moments in between).

Negative control, **on the same running app's own global fetch** (the
`expo/fetch` the transport wraps), installed through `kit/cdp.cjs --eval`
(`artifacts/negative-final-install.js`):

- a plain `fetch(url, {headers: {Authorization}})` returned the **stale**
  v_new (stamp 1791865733915) and the stub logged **no GET at all** — the
  iOS URL cache answered;
- the same with `cache: 'no-store'` in the init also returned stale, also
  with no GET — Expo drops `RequestInit.cache` before the native request
  (#166's mechanism), read from `expo/src/winter/fetch/NativeRequest.ts`,
  here measured on the wire;
- a fetch with the `Cache-Control: no-cache` **header** reached the server
  (conditional GET: `if-none-match`/`if-modified-since`) and returned the
  fresh body. Final captured result:
  `{"plain":1791865733915,"nocache":1791867071937}` — stale vs fresh, one
  server GET in the window (`artifacts/negative-final-result.json`).

Then the app path: real-touch Play at 12:31:54 against the newest served
file — the stub logged the revalidating GET
(`cache-control="no-cache" if-none-match=…`) at 04:31:54.206, the Debug Log
`play: ok, … 1 places taken`, and `[reading] play at utterance 15`: the Play
started at the server's newer place, not the local end-of-book one.

## #168 — success headers, then a stalled body

On the Sync screen, with real touches on the switch: off, on. The check
passed (PROPFIND 207), the run's GET answered `200` with the true
`Content-Length` and **no body** (the stub's one-shot stall). The outcome,
from the app's own log and the stub's socket:

- `STALLED GET closed after 15018 ms (client gave up: true)` — the deadline's
  abort reached the socket;
- Debug Log `switch-on: error (No reply from http://127.0.0.1:8765/fix2dav/
  within 15 s.), … nothing uploaded` 15.0 s after the run began — one
  deadline over headers and body, the run ended as a failure;
- the Sync screen's status line switched to `Sync at 12:35 PM failed: No
  reply … within 15 s.`;
- **no PUT in the stall window** — nothing healed the partial file;
- after `/__stall?on=0`, switch off and on again: PROPFIND, then a **new GET
  0.04 s into the run** (`switch-on: ok … uploaded`, status `Synced at
  12:36 PM.`). The single flight had been released: a queued run behind a
  stuck one could not have sent that GET.

## #177 — a failed sync, the correction, the switch-on inside the window

The stub restricted accepted passwords to a new one (`/__accept?list=…`), so
the app's saved password was wrong. `SyncRecoveryProbe` then relaunching the
app made the launch sync fail; the probe read the failed line, corrected, and
turned the switch back on, all inside one XCTest run:

- 12:38:50 launch sync → **401** (stub logged two, the launch and the
  activation poke);
- 12:38:55 the failed line on the Sync screen: `The server rejected the
  username or password (HTTP 401).`;
- 12:38:57 switch off; 12:39:15 the new password retyped; 12:39:17 switch on
  — **22 s after the failure, inside the 60 s window** the old build spent
  doing nothing;
- 04:39:15.913 PROPFIND (the check) → 04:39:16.002 **GET → 200** — the run
  itself, not only the check — and its PUT landed 5 ms later;
- the status line became `Synced at 12:39 PM.`; after the probe's 45 s idle
  on the screen the stub's log held **no further requests** — staying
  enabled does not continuously sync.

## What the run cannot prove

- The negative control drives the app's own global `fetch` from CDP, not the
  transport (there is no switch to turn the header off in the shipped code);
  the stale-serving is the same native fetch, session and cache the
  transport uses, but the transport's own stale read is inferred from it.
- The stub answers a conditional GET with a full 200, never 304; production
  hosts mostly answer 304, which the client reads from its cached body —
  not exercised end to end here.
- #168 ran through the switch-on path, not Play's two-second wait (that
  bound is #106's, covered by its own probe; the deadline and the release
  under test are the same transport code).
- A physical device, a real WebDAV host, and iOS suspending the process
  remain untested.

## Run metadata

- Simulator `fix2-sync` (iPhone 17 Pro, iOS 27.0), UDID above; booted,
  silenced (`silence.sh set`, checked before every play), Debug app
  installed from `/tmp/openreader-fix2-sync-dd`, launched with
  `-RCT_jsLocation localhost:8093`.
- Artifacts: `/tmp/fix2-sync/` — `artifacts/` (Debug Log, stub request log,
  PUT bodies, negative-control scripts and results, probe run summaries),
  `probe-setup/` and `probe-recovery/` (xcresults and test logs).
- Playback: four plays, ~50 s total, all at `sim_volume=0` (checked in the
  same `&&` chain immediately before each): two template recordings (~21 s
  with the consent hold, ~8 s), and the two adoption Plays (14 s and 7 s —
  both ran into the fixture's end-of-document self-stop, which is what the
  short fixture does; playback stopped itself and was confirmed stopped).
