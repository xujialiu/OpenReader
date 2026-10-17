# Failed Provider responses on the simulator (#203, #211, #204)

First attempt 2026-10-17 against `1.0.0 (8)-beta17` at 387d02f on
`xujialiu/fix--ios-check`. Simulator `ios203-check`, a dedicated iPhone 17 Pro
on iOS 27.0 (UDID `21A03AF5-D72F-4D2B-9855-35BD47E094F2`), Debug build from
`/tmp/ios203-check/derived-data`, JavaScript from the worktree's own Metro on
port 8093, controlled fault server on 127.0.0.1:8765. Everything here is this
run's measurement; adjust UDIDs/ports for your own run.

## The tools this run added

- **`provider-fault-server.cjs`** — the controlled OpenAI-shaped TTS server all
  three issues need in one process: `POST /v1/audio/speech` whose behaviour is
  switched live (`/__mode?speech=…`: `ok-pcm`, `ok-wav`, `cut`, `stall`,
  `json-error`, `html-error`, `text-error`, `502`, `503`, `429`, `404`),
  `GET /v1/audio/voices` (`/__mode?voices=…`: `ok` fixture list, `junk`, and
  the status codes), `GET /v1/models`, and plain boundary endpoints for driving
  the app's native `expo/fetch` directly (`/cut/text|bytes|json` with
  `?prefix=N&delay=MS`, `/ok/*`, `/stall?prefix=N`, `/stallcut?hold=MS`,
  `/slow/MS`). Every cut writes success headers **and real body bytes**
  (`flushHeaders()`, then a partial write) before destroying the socket —
  headers alone is a fetch-stage repro, not a body failure (#168). Every
  complete answer carries `Date` (else NSURLCache stores nothing) and
  `Cache-Control: no-store`. A request/close journal with elapsed times goes to
  stdout; `/__log` returns it as JSON.

  ```sh
  node test/manual-test/voices-and-providers/provider-fault-server.cjs 8765
  curl 'http://127.0.0.1:8765/__mode?speech=cut&voices=503'
  curl 'http://127.0.0.1:8765/__state'
  ```

- **`native-body-faults.cjs`** — one CDP connection to the running app that
  drives the app's own global `fetch` (the native expo/fetch the providers run
  on) against the fault server and prints one JSON line per scenario with the
  stage times (`fetchResolvedAt`, `readerCalledAt`, total ms, raw error). This
  is a native-boundary probe, not a UI test; label it as such in evidence.

  ```sh
  OPENREADER_METRO=http://127.0.0.1:8093 \
    node test/manual-test/voices-and-providers/native-body-faults.cjs \
    http://127.0.0.1:8093 http://127.0.0.1:8765
  ```

  What it establishes on beta17 (run 3, 11/11): with an 8192-byte prefix and a
  cut at +1000 ms, `fetch()` resolves at +3..127 ms — before the cut — and
  `text()`/`arrayBuffer()`/`json()` reject at the cut (total ≈1005–1161 ms);
  consumption deliberately delayed until +2500 ms rejects ≈0–3 ms after the
  reader is called (the error-is-already-recorded path; unpatched
  `waitFor(.bodyCompleted)` cannot take it and hangs); a stalled 8192-prefix
  body keeps `text()` pending (no spurious failure) and the explicit abort at
  +3000 ms rejects at +3018 ms (`FetchRequestCanceledException`,
  `NativeResponse.swift:63`); complete text/JSON/bytes controls resolve.

  The **prefix size is the difference between two failure layers** on expo
  57.0.24: with only a 200-byte prefix the response never reaches JavaScript
  before the cut, and `fetch()` itself rejects at the destroy (run 1's
  "delayed" cases were fetch-stage; the reader was never called). 8192 bytes
  exposes the response, so the reader owns the failure — which is the layer
  the patch changes. Vary only the prefix when comparing runs.

- **`ProviderVoiceDrawerProbe.swift`** — a real native tap on "Choose a Voice"
  after a failed startup prefetch and a no-restart server recovery; requires
  the fixture voices on the sheet and requires the OpenAI fallback names to be
  absent. The fresh listing request itself is proven by the fault server's
  log line at the tap. Attach to the running reader; it does not navigate and
  never presses Play.

  ```sh
  bash test/manual-test/kit/run-probe.sh ProviderVoiceDrawerProbe SIMULATOR_UDID \
    /tmp/openreader-probe-drawer -only-testing:ProviderVoiceDrawerProbe/testDrawerAsksAgainAndListsFixtures
  ```

## What the app run adds (measured)

- Startup prefetch (#24/#204): each cold launch asks every enabled Provider
  once (`[provider] compatible GET http://127.0.0.1:8765/v1/audio/voices -> 503
  in 46 ms` in the Debug Log). 502/503/429 are served by the fault server and
  stay silent in the UI; the loader remembers only fulfilled lists, so the
  Drawer asks again. All three statuses were served to three cold launches
  (server log 06:12:20Z 502, 06:14:00Z 503, 06:14:12Z 429; a later run's 503 at
  06:49:03Z with Debug Log `-> 503 in 46 ms`).
- Recovery without a restart: with `voices=ok` set while the app runs, the
  drawer's first open produced a fresh request (server
  `07:11:14.136Z REQ GET /v1/audio/voices → OK voices ok 152 bytes`; Debug Log
  `15:11:14.735 [provider] compatible GET … -> 200 in 1386 ms`) and listed the
  fixture voices (`Fixture Willow/Alto/Breeze` under Provider
  "OpenAI Compatible", Language "multilingual"), not `alloy`/`ash`/`ballad`.
  `ProviderVoiceDrawerProbe` run 1 failed its 20 s existence wait (every AX
  snapshot took 20–40 s on a loaded machine — keep the 60 s waits) while the
  app behaviour was already correct; run 2 passed: `Executed 1 test, with 0
  failures` in 12 s. With `voices=404` or `junk` (an unusable complete 200)
  the documented-name fallback is what the sheet would show — the control
  that keeps the fallback (unit-tested in `test/app/voice-lists-http.test.ts`;
  not exercised live in this run).

## What this run did not get to

The app-level Reading and Download scenarios (#203's "a cut audio body is
reported as a connection failure through the real paths" and #211's no-save
checks) were **not run**: the fresh iOS 27.0 simulator wedged four times in
the session (each needing a shutdown/boot; see `../pitfalls/simulators.md`),
and the run was stopped by the parent before those scenarios. The boundary
evidence above covers the native readers the providers call; the runtime
(`offline/runtime.ts`'s `withTimeout` + scheduler retries) is covered by
`test/offline/runtime-response.test.ts` in Vitest but was not exercised
end-to-end on-device in this attempt.


## Pitfalls this run met (details in `../pitfalls/`)

- A harness `open` sent while the app is still launching is consumed with no
  effect: `navigationRef.isReady()` is false at that moment. Re-send after the
  app settles.
- A fresh iOS 27.0 simulator wedged three times in one session (spawned
  `launchctl list` and `io screenshot` hang, one boot refused with
  "could not bind to session, launchd_sim may have crashed"): `simctl
  shutdown` that UDID, boot again (twice, if the first boot does not stick),
  re-silence, relaunch.
- After a wedge, `simctl io screenshot` can answer with **stale frames** (the
  status-bar clock frozen minutes back). Compare the screenshot's clock with
  the host's before reading anything off it.
- The boot and the app relaunch both reset `sim_volume`; `silence.sh set`
  again immediately before any play.
