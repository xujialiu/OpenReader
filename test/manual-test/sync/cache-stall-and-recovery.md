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
  one-shot stalled GET (`/__stall?on=1`) and a one-shot **partial-body**
  stall (`/__halve?on=1`, headers + first half, the shape the old code
  could not bound) plus a slow-body hold (`/__hold?ms=N`) for measuring
  when `fetch()` resolves — all three **`flushHeaders()` immediately** and
  log the close with its elapsed time —, a password list
  (`/__accept?list=a,b`, `list=*` for anything) whose rejects answer 401
  and whose log line and `/__state` expose only the **count**, never the
  values, content swap by POST to `/__set`, and full request-header logging
  with the Authorization masked. State under `/tmp/openreader-fix2-dav/`.

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

The first attempt of this run (2026-10-13 ~12:35) is **superseded and was
inadequate**: the stall branch then wrote the headers with `writeHead` and
returned — and Node buffers those bytes until the first write/end, so the
client never received them (`curl --max-time 2 --dump-header`: exit 28, **0
header bytes**, `STALLED GET closed after 2005 ms` at 04:59:51Z). Its
`closed after 15018 ms` line therefore proved a deadline over a request
whose **headers** never arrived — not the body wait the issue is about. The
raw log is preserved; the stub now calls `res.flushHeaders()` immediately.

Two mechanism facts were measured on this expo build while correcting that
(both on the app's own `expo/fetch`, via `cdp.cjs`):

- **`fetch()` does not resolve at the response's headers — it resolves at
  the first body chunk.** With headers flushed and the body held 8 s, the
  response object arrived at the same millisecond the body did
  (`responseArrivedAt == textDoneAt`, +8.06 s); with headers flushed and
  **zero** body bytes ever, `fetch()` was still unresolved at 20 s and the
  abort rejected it (`FetchRequestCanceledException`); with **half** the
  body flushed, it resolved at **+87 ms** while `.text()` hung (and a later
  cancel left that pending `text()` neither resolved nor rejected within
  3 s). The issue's source reading ("resolves once the response's headers
  are in") does not hold for this build; the unbounded shape of the old
  code is precisely *headers + at least one body byte, then stall* —
  `fetch()` resolves, and the old `response.text()` ran outside any
  timeout.
- Hence the corrected app run uses exactly that shape: the stub flushed the
  success headers **and the first 194 of 389 bytes**, then withheld the
  rest.

On the Sync screen, real touches on the switch: off, on (13:10:06).

- 13:10:07.203 the run starts; GET at 05:10:07.215Z → `200 PARTIAL (194 of
  389 bytes flushed, rest withheld)`, request carrying
  `cache-control="no-cache"` + conditional validators;
- **`PARTIAL GET closed after 15007 ms (client gave up: true)`** — the
  deadline's abort reached the socket;
- Debug Log `switch-on: error (No reply from http://127.0.0.1:8765/fix2dav/
  within 15 s.), … nothing uploaded` at 13:10:22.219 — **15.016 s** after
  the run began, one deadline over the whole exchange;
- status line `Sync at 1:10 PM failed: No reply … within 15 s.`;
- **no PUT in the window** — nothing healed the partial file;
- after `__halve on=0`, switch off and on again at 13:10:57: PROPFIND, then
  a **new GET at 05:10:58.961Z** (0.05 s into the run) → `switch-on: ok …
  1 place taken … uploaded`, status `Synced at 1:10 PM, 1 place taken from
  other devices.` — the single flight had been released.

What the stall variants add: the pure zero-byte stall (headers flushed, no
body) now also ends at the deadline — bounded at the `fetch()` stage —
while the partial-body shape is the one the old code could not bound.

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
  — from the raw failure to the completed run: **12:38:50.562 → 12:39:16.007
  = 25.445 s** (app Debug Log; the server's own 401→GET-200 pair: 25.47 s),
  and the real-touch re-enable was confirmed at **26.735 s** — all inside
  the 60 s window the old build spent doing nothing;
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
- The measured `fetch()` resolution point (first body chunk) is this expo
  build's behaviour; other versions may differ, and the app-level bound
  (one deadline over the whole exchange) is what the fix guarantees.
- The stub answers a conditional GET with a full 200, never 304; production
  hosts mostly answer 304, which the client reads from its cached body —
  not exercised end to end here.
- The superseded first #168 run and the pre-fix control-query log lines
  (requests.log before 05:00:32Z) contain the stub's **throwaway**
  password in `/__accept?list=…`; the raw logs are preserved as evidence
  and the values are loopback-throwaway only.
- #168 ran through the switch-on path, not Play's two-second wait (that
  bound is #106's, covered by its own probe; the deadline and the release
  under test are the same transport code).
- A physical device, a real WebDAV host, and iOS suspending the process
  remain untested.

## Integrated delivery smoke (beta10, 109c6b4)

2026-10-13 13:21–13:25, after the parent merged main (playback repairs
#157/#158/#169/#181) and fast-forwarded this worktree: same simulator and
Metro, app relaunched onto the new bundle (JS-only diff, no rebuild). Raw
proof, all against the stub in normal mode:

- the served bundle contains `1.0.0 (8)-beta10` and the `flush('switch-on')`
  fix; Settings shows **`Version 1.0.0 (8)-beta10-debug`**
  (tree read + `shots/beta10-version.png`);
- relaunch's launch sync `launch: ok … uploaded` at 13:21:04.083; switch
  off → on at 13:22 completed normally (`Synced at 1:22 PM.`, GET + PUT #4
  at 05:22:40Z);
- a server-newer place (the app's own 12:25 utterance-11 item, stamp +60 s,
  device `fix2-desktop`) swapped in while the reader sat idle-paused; a
  real-touch Play at 13:25:12 adopted it — Debug Log `play: ok, … 1 places
  taken` and `[reading] play at utterance 11, compatible af_bella` — and
  played silently (`sim_volume=0` checked in the `&&` chain). The short
  fixture's end-of-document stop ended the reading at 13:25:26
  (`pause: ok … uploaded`); playback stopped. Integrated playback + sync
  cooperation holds at beta10 with no re-run of the earlier scenarios.

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
