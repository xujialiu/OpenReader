# `http://` by any name, the speech-route check, the PCM memory, and per-Provider Voice notes (1.0.0 (9)-beta6)

Verification of `31efebc` (`xujialiu/fix2--ios-check`, identical to `xujialiu/fix2`), issues #210, #209,
#202, #205, on 2026-10-18. Run directory `/tmp/openreader-fix2-ioscheck-01/` holds every raw artifact
named below. Unit/integration coverage (`npx vitest run` 2943/2943, `tsc --noEmit`, `eslint .`,
`expo config --type introspect`) was the implementing agent's; this record is the simulator pass.

## Environment

- Simulator: `openreader-fix2-ioscheck`, **UDID `E5EEBF6E-901C-42D5-B782-3D8D247C1546`**,
  iPhone 17, iOS 27.0 — created for this run, booted 02:08. Volume set to 0 after the boot and
  re-set before every launch; `silence.sh check` passed immediately before each play.
- Build: clean `npx expo prebuild --platform ios --no-install` + `pod install` (a bare `--no-install`
  prebuild generates no `.xcworkspace` — pod install creates it), then the guarded Debug build
  (`ios_guard.py run`, `/tmp/openreader-fix2-ioscheck-01/phase-a.json`, 313 s, exit 0).
- Metro: `EXPO_UNSTABLE_MCP_SERVER=1 npx expo start --port 8081` in this worktree, PID 87974
  (npm wrapper), cwd the sub-worktree; left running at the end. App launched with
  `-RCT_jsLocation localhost:8081`; `/json/list` named `openreader-fix2-ioscheck` after every launch.
- Controlled servers (`provider-fault-server.cjs`, extended in `adb5788` with the `models` mode,
  `refuse-pcm` speech mode and the `{}` probe answer; all three stopped after the evidence):
  - srvA **8801** PID 87807 — B's Compatible test (models `ok`).
  - srvB **8802** PID 87810 — C (`models=404&voices=404&speech=404`, then `speech=ok-pcm`), then
    D (`speech=refuse-pcm&voices=ok`), and E's Compatible (voices `ok` — Compatible's Address had
    stayed 8802 since C).
  - srvC **8803** PID 87813 — B's Kokoro test and E's Kokoro (voices `ok` to enable, then `502`).
- Dotted name: `atscheck.localhost` resolved to the Mac's loopback for `curl`
  (`curl http://atscheck.localhost:8790/__state` answered before any app work); the simulator
  reached the same names through the Mac's stack.

## A. Build and install — PASS

- `plutil -extract NSAppTransportSecurity json -o - <built .app>/Info.plist` printed
  **`{"NSAllowsArbitraryLoads":true}`**; `NSAllowsLocalNetworking` has no value at that key path
  (the template's dictionary is gone, which is what makes the first key count).
- Settings shows **`Version 1.0.0 (9)-beta6-debug`** (`a-02-version.png`), Debug Mode's suffix included.

## B. #210 — PASS

Real native touches (ax.py/AXe touch pairs) on the provider pages; addresses typed per character
into the focused fields and read back exactly from the AX tree before anything was tapped:

- Kokoro FastAPI, Address `http://atscheck.localhost:8803` (typed, read back verbatim): **Test
  connection → `Connection successful`** (`b-01-kokoro-ok.png` footer). srvC's journal:
  `GET /v1/audio/voices` at 18:20:37 answered 200 — one request from the app, no -1022, the
  request left the app over plain `http://` to a dotted host name.
- OpenAI Compatible, Address `http://atscheck.localhost:8801`, Model `tts-1` (both typed, read
  back verbatim): **Test connection → `Connection successful`** (`b-02-compatible-ok.png`). srvA's
  journal: `GET /v1/models` + `GET /v1/audio/voices`, both 200.

## C. #209 — PASS

OpenAI Compatible disabled, Address retyped to `http://atscheck.localhost:8802` (srvB set
`models=404&voices=404&speech=404`; journal mark taken before the touch):

- Touching **Enable** failed with exactly
  **`OpenAI Compatible: nothing at http://atscheck.localhost:8802 answers /v1/audio/speech (HTTP 404). Check the Address.`**
  as the card's footnote (`c-01-enable-fails.png`), and the `Enable OpenAI Compatible` switch read
  **0** after it. srvB's journal between the marks: `GET /v1/models` (404), `GET /v1/audio/voices`
  (404), `POST /v1/audio/speech` body `{}` → 404 — and nothing else; `/__speech` gained exactly one
  `probe: true` entry.
- srvB switched to `speech=ok-pcm` (lists still 404): touching Enable passed — switch **1**,
  `Turn off to edit.`, footer `Connection successful` (`c-02-enable-fails…c-02-enable-passes.png`).
  srvB's journal: the same three requests, the probe now answered **422** (non-404, FastAPI's
  missing-field body); a voices re-list followed the enablement, as the screen always does.

## D. #202 — **FAIL** (one extra `pcm`; memory effective from the third request on)

Setup: Compatible enabled at srvB (`speech=refuse-pcm`, voices `ok`); `Pause Gap Fixture.epub`
added through the harness and opened; Voice `alloy` chosen for the Document in the drawer by real
touch (`shelf` read back `voice=compatible/alloy`); Consent preflight done on the Play itself —
the alert was inspected (`Send text to the server at atscheck.localhost:8802?`), the recipient
matched the controlled server, and **Allow** was answered 1.5 s into the play, before any request
went out. `silence.sh set` + `check` passed immediately before the play; `reading.cjs play-for 9`
auto-paused at 9 s (`playing=false`). Duration: 9 s — long enough for the held Consent plus three
or more sentences' requests (six sentences/eight requests arrived); a second play of 4 s measured
the re-read.

The speech ledger (`/__speech`, window from the pre-play mark):

```
pcm (422)  Alpha sentence…   18:27:54.508
pcm (422)  Pause Gap Fixture 18:27:54.510   <- the title Utterance, fetched concurrently
mp3 (200)  Alpha sentence…   18:27:54.512
mp3 (200)  Pause Gap Fixture 18:27:54.513
mp3 (200)  Gamma sentence…   18:27:54.525
mp3 (200)  Beta sentence…    18:27:54.526
mp3 (200)  Delta sentence…   18:27:56.622
mp3 (200)  Epsilon sentence… 18:27:56.623
```

Expected (the phase's assertion, and #202's own device acceptance — "a Reading of three sentences
sends one PCM request, then MP3 only"): exactly one `pcm`. Actual: **two** `pcm` requests, 2 ms
apart. The engine keeps "three Utterances of read-ahead, two concurrent fetches"
(`src/playback/engine.ts:9`), so the title Utterance and the first sentence left the app together,
before either 422 had been answered and the MP3 retry had written the memory. From the third
request on — every later sentence of the same Reading — the Provider asked MP3 only, so the
per-process memory itself works; the race is exactly the first two concurrent fetches. This is not
a test-gesture artifact: the two `pcm` requests left before the app could know anything, and the
shape is the engine's documented design. `test/offline/pcm-refusal-remembered.test.ts`'s runtime
pass ("three sentences … four requests, one refused") serialises what the device fetches
concurrently.

Reproduction: compatible at a server refusing `pcm` with 422 and answering MP3, a fresh app
process, play a Document whose voice is the provider's — the first two fetches are both `pcm`.
Separating check: a re-read after the end of the book sent **zero** requests — the Clips were
already cached (`provider-response-failures.md`'s rule that cached audio hides a server-mode
change), so no second window exists without a fresh process, and a fresh process also resets the
memory under test. The 20 ms `GET /` before the first synthesis is `warm-connections.ts`'s
documented warm-up (ADR 0040), not a stray probe.

**Owner's decision (2026-10-18):** the two refusals of a Reading's opening pair are accepted, rather
than holding the second request back at the start of every Reading on a server that does PCM. ADR
0013 states the bound, and `test/offline/pcm-refusal-remembered.test.ts` holds it: the opening
pair pays the refusal once each, every later request asks MP3 only. With that, D's acceptance is
met by the ledger above (one refusal per request already out, MP3 only from the third request).

## E. #205 — PASS

Kokoro enabled on srvC while its voices were `ok` (`e-01-kokoro-enabled.png`: switch 1, `Connection
successful`). srvC switched to `voices=502`; app terminated and relaunched. Start-up prefetch at
19:10:02: Compatible's ask (`Address 8802`) answered 200 — list held; Kokoro's ask answered **502**
(srvC journal). In the Reader, the drawer opened on the Provider in use (OpenAI Compatible):

1. OpenAI Compatible: Fixture Willow/Alto/Breeze listed, **no failure sentence**
   (`e-02-drawer-compatible-no-note.png`).
2. Provider row → Kokoro FastAPI: **`Kokoro voices returned 502`** shown under Kokoro only
   (`e-03-drawer-kokoro-note.png`).
3. Provider row → OpenAI Compatible: voices again, **no sentence** — the 502 never crosses over
   (`e-04-drawer-compatible-again-no-note.png`).
4. Drawer closed by its grabber and reopened on Choose a Voice: voices, **no sentence**
   (`e-05-reopened-no-note.png`).

All switches and rows were real touches; each step's tree read is quoted in the run directory.

## Coverage limits

- Addresses were typed natively with exact readback, but the C enable and D's Consent answer were
  single runs; the D finding's shape was cross-checked against the engine's documented fetch
  design rather than by repeated runs (a repeat cannot produce one `pcm` — both requests leave
  before the memory exists).
- D's second window is empty by cache design (see above); the memory was therefore measured within
  one Reading's request stream only.
- A LogBox `Open debugger to view warnings.` banner was on screen once (02:36); `cdp.cjs --warnings`
  after the later relaunches captured nothing, and the banner did not return. Not correlated to a
  warning text.
- The scenario rename of `speech` mode `404` behaviour for `{}` bodies (probe-shaped) is covered by
  curl checks in the run directory (`srv-test2.log`), not by the app.

## Pitfalls met here (also added to the README)

- `axe batch` `key-sequence` backspaces are partially dropped on this setup; clear-verify-retype
  until the placeholder shows.
- AXe's remote automation session died mid-run on this session-created device for ~10 minutes;
  the recorded shutdown+boot recovery (through the shared lane) restored it in ~45 s.
- The shared iOS lane was held ~25 min by a parallel session's phone-install phase; long
  `--wait`s must run under `nohup` so a host tool timeout cannot kill the waiter.
