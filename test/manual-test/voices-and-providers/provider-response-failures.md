# Failed Provider responses on the simulator (#203, #211, #204)

Use the [shared admission/readiness gate](../kit/ios-verification.md). Keep the
native build, the Metro worktree, simulator UDID and fault-server PID/port
explicit. No cloud service or real credential is needed. The first attempt's
measurements and untested gates are in `notes/NOTES_2026-10-17.md`; a native
boundary pass alone is not an app Reading/Download pass.

## Controlled server

```sh
node test/manual-test/voices-and-providers/provider-fault-server.cjs SERVER_PORT
curl 'http://127.0.0.1:SERVER_PORT/__mode?speech=cut&voices=503'
curl 'http://127.0.0.1:SERVER_PORT/__state'
```

Record the actual Node PID and cwd; stop only that owned process. The server
binds loopback, requires no key, and journals requests/body delivery/socket
closure. `/__log` returns its journal. Its speech route accepts the app's real
OpenAI Compatible requests; `/v1/models` answers a fixture Model.

- Speech modes: `ok-pcm`, `ok-wav`, `cut`, `stall`, `json-error`, `html-error`,
  `text-error`, `refuse-pcm` (a request naming `response_format: pcm` is
  refused 422 with FastAPI's literal_error body; any other format gets
  complete WAV — the #202 PCM-memory scenario, its per-request
  `response_format` readable on `/__speech`), `502`/`503`/`429`/`404`, and
  `flaky-503` (each distinct text answered 503 for its first `fails`
  requests, then complete PCM: `__mode?speech=flaky-503&fails=2`).
- Voice modes: `ok` (Fixture Willow/Alto/Breeze), `junk` (complete unusable
  200), and `502`/`503`/`429`/`404`.
- Models modes: `ok` (the fixture model, the default) and `404` (publishes no
  model list — the #209 scenario). A POST to `/v1/audio/speech` without a text
  `input` — the #209 connection probe's `{}` — is journaled on `/__speech`
  (`probe: true`) and answered by its mode: a status mode answers that status,
  anything else answers 422 like FastAPI refusing required fields.
- Boundary routes: `/cut/text|bytes|json?prefix=N&delay=MS`, `/ok/*`,
  `/stall?prefix=N`, `/stallcut?hold=MS`, `/slow/MS`.

A body-failure fixture must expose the response **before** cutting it. Sending
headers alone, or too small a prefix, can instead fail inside `fetch()` and
never call a buffered reader. The speech `cut` mode therefore writes 8192 of
65536 bytes, then cuts after 1000 ms; `stall` writes the same prefix and never
completes. Small-prefix boundary controls deliberately retain the other shape.
Restart an already-running fault server after changing this script; a file edit
does not update its process.

## Native reader boundary (not UI touches)

```sh
python3 test/manual-test/kit/ios_guard.py run --timeout 120 -- \
  node test/manual-test/voices-and-providers/native-body-faults.cjs \
  http://127.0.0.1:METRO_PORT http://127.0.0.1:SERVER_PORT
```

Use the rebuilt app with the patched Expo source compiled, not a stale binary
reloaded from Metro. Confirm that the returned response is Expo's FetchResponse;
the global `Response` constructor alone does not identify what native fetch
returns. Record response arrival, reader invocation and rejection times. Test
text/bytes/JSON consumption both immediately and after the cut, cancellation of
a stalled body, and complete-body controls. Preserve failed attempts. The probe
prints one result per case and exits nonzero if an expectation fails.

## Voice-list recovery (real native touch)

Configure the enabled OpenAI Compatible Provider to the local server. Cold
launch with its Voice route refusing, then change `voices=ok` without restarting
the app. Open a Document whose player offers Choose a Voice. With the sheet
closed, run:

```sh
bash test/manual-test/kit/run-probe.sh ProviderVoiceDrawerProbe SIMULATOR_UDID \
  /tmp/THIS-RUN/drawer -only-testing:ProviderVoiceDrawerProbe/testDrawerAsksAgainAndListsFixtures
```

The probe attaches without relaunching, taps Choose a Voice and asserts fixture
rows and absence of OpenAI fallback names. Pair its raw test result with a fresh
server GET and the Debug Log at the touch. Separately verify the documented-name
fallback for 404 and complete junk; a recovered list already in memory cannot
exercise that control, so give it a fresh scope/launch.

## Reading, Downloads and invalid audio

`provider-app-check.cjs` is the checked handler/runtime/catalogue probe for this
batch. Prepare two disposable fixture Documents (a Reading and a separate
Download), select a Voice, and answer the actual local-server Consent first:

```sh
OPENREADER_METRO=http://127.0.0.1:METRO_PORT \
python3 test/manual-test/kit/ios_guard.py run --timeout 180 -- \
  node test/manual-test/voices-and-providers/provider-app-check.cjs \
  SIMULATOR_UDID READING_DOCUMENT_ID DOWNLOAD_DOCUMENT_ID /tmp/THIS-RUN/app-check \
  http://127.0.0.1:SERVER_PORT
```

Add `--preflight-only` to check setup without starting the measurement. The
probe refuses a missing Voice, ungranted Consent, wrong Document/endpoint,
locked speech or running work. A normal request and unbuffered playback must
succeed before fault cases. Every assertion stops the sequence; a line saying
NOT-STARTED or zero requests is never followed by another fault scenario.

The controlled server accepts generated fixture Voice IDs so each run avoids
old memory Clips. The probe restores the selected Voice and pauses its work at
exit. Its `/__speech` ledger groups retries by a hash of speech text; it does not
infer retries from unrelated requests. No-save checks query the real offline
repository's inventory, not the number of SQLite/sidecar files. Results and CDP
expressions are retained in the output directory. Inventory rows name the hashed
`voiceKey`, not an `OfflineVoice` object; a positive saved-count control guards
that distinction. These are app handler checks, not native touches or a claim
about sound quality.

If a run reached and saved PCM recovery but its inventory assertion used the
wrong schema, `--finish-saved-run fixture-check-RUN_PREFIX` rechecks the retained
fault tasks and speech ledger, reads the saved payloads, and runs only the still
missing WAV Download and Voice fallback controls. It refuses a WAV case already
saved, rather than replaying completed work. Keep the failed run and its original
results; this continuation is a new evidence record, not an edited pass.

Complete [Consent preflight](consent-recovery.md), select the fixture Voice,
and confirm the app is paused. Set/check the simulator's own volume before every
Play. Use the repository's Reading and Download harness for state assertions;
label handler calls as such, rather than claiming touches.

1. A Reading under `cut` reports a lost connection without waiting for its
   60-second deadline. Pair the app's error timing with the server's cut.
2. A Download under `cut` uses its existing bounded retry policy; switch to
   valid PCM for recovery and confirm saved progress.
3. Each 200 JSON/HTML/plain-text error is refused. The JSON case retains
   Insufficient balance. Verify the Download catalogue/files did not gain a
   Clip from the response, not merely that the UI displayed an error.
4. Recover with valid PCM and WAV; verify success and the expected saved Clip.
   Use uncached text or a fresh app process between cases: already-cached audio
   makes a server-mode change invisible and is not network evidence.

Stop playback as soon as its fact is established, including on failure. Return
separate verdicts for native readers, Voice UI and Reading/Download persistence;
if readiness fails after the permitted recovery, preserve evidence and return
BLOCKED rather than rebooting again or relaxing the app assertion.

## A passing 5xx (#237, #280, ADR 0084)

Every Provider asks a synthesis answered 5xx again, three tries in all, 500 ms
and then 1 s apart, in a Reading as in a Download, and never a fourth time.
`/__speech` groups the requests by the hash of their text, so count them per
text, diffing from a snapshot taken just before the scenario. The Debug Log
shows each try as its own `[provider]` line (`-> 503 -> 503 -> 200`); the
Clip's note (` after 2 retries of HTTP 503, 503`) is not printed there. A
pause or a skip aborts no request (ADR 0026): a sentence already out still
makes its tries.

1. `__mode?speech=flaky-503&fails=2`, then Play on an uncached sentence: the
   Reading speaks on with no note, and `/__speech` shows three requests for
   that text, about 0.5 s and then 1 s apart.
2. The same mode, then a Download of one short chapter: it ends Downloaded,
   nothing failed, three requests per text.
3. `__mode?speech=503` on uncached text: the Reading stops on `OpenAI
   Compatible speech: HTTP 503` after exactly three requests for the text; a
   Download marks the chapter failed after three, not nine.
4. Stop the server (or point the Address at a closed port) and Play uncached
   text: the note begins `Cannot reach http://127.0.0.1:PORT` (#280).

