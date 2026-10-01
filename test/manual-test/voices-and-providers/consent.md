# Asking before text leaves the phone (#109), with the Privacy Policy row (#110) and the release configuration (#108)

Run 2026-09-30 22:40 → 2026-10-01 00:25 on `iPhone 17 prepare`
(`3AC0934F-6CBA-4ABE-AB07-DF01E4F07C08`, iOS 27.0), tree `xujialiu/prepare` at
6215cc2 (its app code is 81d2569's), `0.0.2-beta73-debug`, Metro on 8101, and a
fake server on `127.0.0.1:8795`. Everything below is what that run measured;
`../pitfalls/simulators.md` ("A fresh prebuild, and volume resets") says what
to do before the first build, and `../pitfalls/mcp.md` ("A system alert and a
masked field") what the touch tools do to an alert.

## What it uses

- `../player-and-reading-held/fake-kokoro.cjs PORT`: a Kokoro-FastAPI and an
  OpenAI-compatible speech server in one. `OPENREADER_FAKE_TTS_LOG` names the
  log, `OPENREADER_FAKE_TTS_DELAY_MS` holds every synthesis answer back. Each
  synthesis request is one line, `N ISO-ms text="…" voice=… words=… route=kokoro|speech
  auth=present|absent`, and every other request (`GET /v1/audio/voices`,
  `GET /v1/models`, the warm-up `GET /`) one line without a counter, so
  `grep -c 'text=' LOG` is "how many times text left the phone" and `auth=`
  says whether a key came with it, never what the key was.
- `ConsentProbe.swift` (real touches, `kit/run-probe.sh ConsentProbe UDID OUT
  -only-testing:METHOD`): `testLookupDontAllow`, `testLookupAllow`,
  `testLookupNotAskedAgain`. A long press on the reading page (an AXe long press
  starts no lookup, `../pitfalls/mcp.md`), the alert's title, message and
  buttons printed as `CONSENT …` lines in `test-STAMP.log`, and screenshots.
  Prerequisite: the reader open on `A Short Test of Reading Aloud`, `lookup`
  enabled through the harness.
- `../lock-screen/LockScreenProbe.swift`, default mode (`kit/run-probe.sh
  LockScreenProbe UDID OUT -only-testing:testLockScreen`): the `center-button`
  JSON's `label` is the system's Now Playing state, `Play` when paused and
  `Pause` when playing.
- The harness (`kit/hx.cjs`): `settings` patch (it **replaces** the whole
  `consent` list), `open`, `voice`, `seek`, `pause`, `say`, `go`, `back`,
  `watchfetch`. Answers are in the Debug Log (`Library/Application
  Support/debug-log/`) even when Metro's log has stopped.
- The alert is an `AXSheet` in `axe describe-ui`; its buttons are touched with
  `axe touch -x X -y Y --down --up --delay 0.2` at the centre `describe-ui`
  gives. A quick tap misses Allow.

## Setting a Provider at the fake

```sh
npx tsx test/manual-test/fixtures/short-test-fixture.ts OUT
node test/manual-test/player-and-reading-held/fake-kokoro.cjs 8795
# copy the EPUB to Documents/Inbox, then:
hx '{"do":"add","file":"A Short Test of Reading Aloud.epub"}'
hx '{"do":"settings","patch":{"provider":"local","enabledProviders":["local"],"local":{"engine":"kokoro","baseURL":"http://127.0.0.1:8795"},"voice":"af_bella","consent":[]}}'
hx '{"do":"open","id":"sha256:…"}'          # the id `add` answered
hx '{"do":"voice","provider":"local","voice":"af_bella"}'
```

OpenAI-compatible at the same server: patch `compatible` to
`{"baseURL":"http://127.0.0.1:8795","model":"fake-tts"}`, then Settings ›
Providers › OpenAI Compatible, the Enabled switch (its connection check is
`GET /v1/models` at the fake), and `voice` with `"provider":"compatible"`. To
type a key: switch it off, reveal the field (the eye), touch the field, then
`type_text`; switch it on again (`GET /v1/models … auth=present`). A hosted
Provider needs its key the same way and `enabledProviders` and its model from a
patch (the connection check would answer 401), so a fake key never leaves the
phone as long as the alert is answered Don't Allow.

**A sentence that needs no question never asks.** `synthesize()` reads saved
audio, then the memory cache, and only then asks: a sentence fetched earlier in
this process, or one in a downloaded chapter, plays and downloads without an
alert. Clearing `consent` and pressing Play at a sentence already read this
run showed nothing, and a download of a chapter the Reading had just fetched
sent one request (the heading) and asked once, at the press. Relaunch, or seek
to a sentence not yet fetched, before a test that expects the question.

## Facts and how each was shown

| Fact | Evidence |
| --- | --- |
| The first Play asks, in the words | `describe-ui`: `Send text to the server at 127.0.0.1:8795?` / `To read aloud, OpenReader sends your document's text to the server at 127.0.0.1:8795.`, buttons `Don't Allow`, `Allow`; a screenshot |
| Nothing is sent while it is up, or after Don't Allow | the fake's log: 0 `text=` lines before, during and 15 s after; 0 `HX fetch` lines from `watchfetch`; no `[provider] synthesis` line in the Debug Log |
| The Reading stays where it was, with no note | `say`: `playing=false utterance=3`, `note=null`, no `note attention=` line, Play in the player, the highlight unmoved |
| It does not come back by itself | no alert 24 s later, no second alert for the read-ahead's sentences |
| The next Play asks again | the same alert at 23:36:22, after the Don't Allow of 23:34 (`[reading] play at utterance 3`, no `[provider] synthesis`) |
| Allow plays, and the yes is kept | Allow at 23:51:26.0, POSTs at 23:51:27.8, `level=word`, `[reading] pause` at 23:51:28.3; `settings.json` `consent` gained `provider:local@http://127.0.0.1:8795` |
| A later Play, and one after a kill, does not ask | 23:46:26 (`playing=true`, 5 new POSTs, no alert) and 23:47:39 after `simctl terminate` + launch (4 POSTs, no alert); `consent` on disk before and after |
| Now Playing after a refusal is paused | `LockScreenProbe`: `Play` after the first refusal (fresh process); `Pause` while the alert was pending; `Play` after Don't Allow with an audio session already active |
| A Voice chosen while listening asks, and a refusal keeps the old one | `{"do":"voice","provider":"compatible",…}` during a Play from saved audio (`local`): the alert at 00:27:11.5 with the reading going on (`utterance` 1→4), Don't Allow at 00:27:14.6: `playing=true utterance=4 provider=local voice=af_bella`, `note=null`, no `voiceError`, 0 new requests |
| A download asks before it starts | `Download selected (1)` → the alert; Don't Allow: the chapter stays checked, `0 chapters downloaded`, no `Manage downloads` link, 0 requests; the next press asks again; Allow: `Preparing selected chapter…`, `[download] continued task submitted`, `1 chapters downloaded` |
| A download already under way | the fake at 2.5 s an answer, the yes revoked after the first request (`consent` patched to `[]`): the alert at 23:56:15, Don't Allow: `Needs attention` / `The server at 127.0.0.1:8795 was not allowed to receive this document's text.`, `[download] … SynthesisError(declined)`, no more requests; Resume all asks again |
| A lookup asks, per service | `CONSENT lookup … label="Send selected text to the Free Dictionary API?" texts=[…, "Word Lookup sends the text you select to the Free Dictionary API."]`, the same for Youdao; Don't Allow: drawer closed, `not allowed to reach …`, no `[lookup] … GET`; the next lookup asks again; Allow: `GET https://www.youdao.com/w/that/ -> 200`, a result; the third asks nothing |
| A typed server names itself, says its key only when one is set | Kokoro and OpenAI Compatible without a key: `…to the server at 127.0.0.1:8795.`; with a key: `…8795 with your API key.` and the POST at the fake read `auth=present` (`auth=absent` without); a different Provider at the same address is another recipient (`provider:compatible@…` beside `provider:local@…`) |
| A hosted Provider says its policy | `Send text to OpenAI?` / `To read aloud, OpenReader sends your document's text to OpenAI with your API key. OpenAI's privacy policy applies.`; Don't Allow: 0 `api.openai.com` lines in the Debug Log, `playing=false`, `note=null` |
| No microphone prompt | `TCC.db`: no row for the app and none for `kTCCServiceMicrophone`; `xcrun simctl spawn UDID log show --predicate 'eventMessage CONTAINS[c] "service=kTCCServiceMicrophone"'`: six `tccd` requests, all `preflight=yes, query=1` (a status query; five carry OpenReader's process ids, one per launch, when the reader first opens), none that prompts; no permission alert in any screenshot |
| The Privacy Policy row | `describe-ui` frames: card 1 at x 20, w 362, y 132–344; card 2 at x 20, w 362, y 376–429 (rows 53 pt); the version at y 437; the top corners' left-edge profile identical to card 1's; light and dark; a touch opened Safari, whose `History.db` holds `https://xujialiu.github.io/OpenReader/privacy.html` (23:25:52, 12 s after the touch) and no other visit in the whole run |

## What it found

**A question left open for 60 seconds pauses the Reading one sentence on and
says it was slow (open finding, #109).** Play at `[reading] play at utterance 6`
00:20:32.896, the alert left alone: at 00:21:32.982 (60.09 s) the player showed
`compatible: no audio within 60s` under the still-open alert, and the engine
paused itself, `playing=false utterance=7`. Don't Allow at 00:21:48 sent
nothing (0 new requests) and left the note and utterance 7 in place, so the
Reading did not stay where it was and did say something. The words come from
the clip fetcher's own timer (`src/playback/clips.ts`, "no audio within 60s"),
which counts the owner's answer as the Provider's silence. Seen three times: 23:37:22.4 and about 23:40:59, each with a harness
`pause` sent first (at +18 s and +21 s), when only the note appears and the
cursor stays; and 00:21:32.98 with nothing sent, when the cursor moves too. Reproduce: a Provider not yet allowed, Play, and
`wait_for_ui` with `predicate: textContains, text: "no audio within"` and a
90 s timeout; then Don't Allow and read `say`.

Round 2 (below) ran the same steps on 230beb1, which holds the fix (07799d0),
and found the finding closed.

## What it cannot prove

- Azure's WebSocket path and the four hosted Providers other than OpenAI (the
  gate is one function; the wording is one template over `PROVIDER_LABELS`); no
  real hosted Provider answered anything, and no real key was used.
- The Free Dictionary API answering: `api.dictionaryapi.dev` timed out from this
  Mac (curl too), so Allow was shown to send the GET (`[lookup] … GET
  https://api.dictionaryapi.dev/api/v2/entries/en/that failed after 16757 ms`)
  and the drawer showed Retry. Youdao answered.
- A question asked while the app is away from the screen (a Play from the lock
  screen or headphones before the first yes, a download resuming by itself).
  `LockScreenProbe`'s `tap` mode would start the first of them.
- A Provider's yes being taken back: there is no way inside the app, so the
  runs cleared `consent` with the harness, which is not something an owner can
  do.
- The audio itself: every play was at `sim_volume` 0 with the fake's zero-valued
  PCM, and stopped at once (durations in the run's report).

## Playback in the run, and why it lasted that long

Audio was produced in five plays, about 56 s in all, every one after a `check`
of `sim_volume` 0 and with the fake's zero-valued PCM: 11.1 s (a later Play
that had to be shown not to ask, `[reading] play` 23:46:26.4 to `pause`
23:46:37.5, long because a snapshot and a guard came between the press and the
pause), 31.8 s (the same fact after a kill, 23:47:39.1 to 23:48:10.8, where the
`pause` was lost to the `say` sent 0.3 s after it, `../pitfalls/typing-environment.md`),
3.1 s (Allow to pause, the shortest that shows a request and a playing
reading), about 1 s (the compatible Provider's first request, to read `auth=`)
and 9.2 s (a Play from saved audio that had to outlast a voice switch and its
refusal). Every other `playing=true` in the Debug Log is a Play waiting on an
open alert, with no clip and no sound.

## Round 2: the answer comes before every clock (#109's fix, 07799d0)

Run 2026-10-01 02:06–02:49 on the same device and Metro, tree `xujialiu/prepare`
at 230beb1, `1.0.0-beta1-debug`, the app relaunched at 02:12 and again at 02:32.
Metro's served bundle (`index.bundle`, 9.7 MB, fetched 02:13) holds `startDeadline`,
`uncleared` and `ensureConsent`, and the Debug Log's `[launch]` line read
`OpenReader 1.0.0-beta1 … Metro bundle`.

### What it uses

- `consent-hold.sh` (this folder): raises the alert by a real touch on Play or by
  choosing a Voice in the sheet, leaves it open for a stated time, samples the
  app every ten seconds, answers by a touch pair and watches what follows.
  It needs `kit/ax.py`. It sets the simulator's volume to zero and checks it
  itself, and checks again immediately before its Play touch, so chain it after
  `silence.sh set UDID >/dev/null &&`, not after a bare `check` (one reset
  between the two stopped the first attempt with nothing played,
  `../pitfalls/simulators.md`).

  ```sh
  bash kit/silence.sh set UDID >/dev/null && bash kit/silence.sh check UDID && \
  bash voices-and-providers/consent-hold.sh UDID 75 "Don't Allow" --play --fake-log FAKELOG --after 12 --shots DIR
  bash voices-and-providers/consent-hold.sh UDID 135 "Don't Allow" --play --voice "OpenAI Compatible" "Bella (fake)" --fake-log FAKELOG --shots DIR
  ```

  `--shots DIR` saves half-size screenshots of the alert just up, at the end of
  the hold and after the watch. Each line it prints is `HOLD …`: the last
  heartbeat (`playing=`, `utterance=`, `note=`), the counts of `no audio within`,
  `voice error` and `catch up` lines in the Debug Log, and the fake server's new
  `text=` lines by route.
- `Scroll Fixture.epub` (`fixtures/scroll-fixture.ts`; 282 sentences, 62
  chapters), added with `{"do":"add","file":"Scroll Fixture.epub"}` (Document Id
  `sha256:9acbcbe4…`). The short fixture runs out in about 35 s, and every one of
  its sentences is saved for `local/af_bella` by the earlier download, so a Play
  there asks nothing. The long one is read in 7.8 minutes at 1.5×.
- Settings through the harness: `{"provider":"local","enabledProviders":["local","compatible"],"voice":"af_bella","consent":[]}`
  for 1a and 1b (`local` is the Kokoro at the fake, without a key);
  `consent` then holds `provider:local@http://127.0.0.1:8795`, and `compatible`
  (OpenAI Compatible at the same address, with a key) is the Provider not yet
  allowed in 2.
- `ConsentProbe` `testLookupDontAllow` (above) for the first lookup.

### Facts and how each was shown

| Fact | Evidence |
| --- | --- |
| 1a. A question left open 78 s is never a Provider that stopped answering | Play at 02:32:57.8 (`[reading] play at utterance 10, local af_bella`, a fresh process, nothing fetched yet); the alert up from 02:32:58.9 to the answer at 02:34:16.6 (77.7 s); 17 heartbeats from 02:32:58.5 to 02:34:17.9, every one `playing=true utterance=10 … note=null` (the old note came 60.09 s after the `[reading] play` line, at 02:33:58.06, between the 02:33:57.4 and 02:34:02.5 beats); samples at +61, +71 and +76 s `alert=up no-audio-notes=0 texts-sent=0`; the screenshot at +76 s shows the alert over a spinner on the Play button and no note |
| 1a. Don't Allow leaves the Reading where it was, sending nothing | `playing=false utterance=10 … note=null` at 02:34:19.1, 2.5 s after the touch and 10 s before my `pause` (02:34:29.5: the Reading had stopped itself); the Play icon back, the highlight still on `Chapter 3: Walked voice garden`; the fake's `text=` lines 206 before and 206 after; the Debug Log window holds no `[provider]`, no `[hx] fetch`, no `no audio within` line; no alert 17 s after |
| 1b. The next Play asks again, and Allow sends after the answer | alert again at 02:35:28.4 (a new press), up 77.6 s, `texts-sent=0` at every sample; Allow touched 02:36:46.0; the app's `[provider] synthesis local for the Reading … "Chapter 3: Walked voice garden"` at 02:36:46.6; the first POST at the fake 02:36:47.783 (four in 53 ms: the sentence and three read-ahead); `pause` 02:36:49.4; `settings.json` `consent` `["provider:local@http://127.0.0.1:8795"]` |
| 2. A voice switch's deadline does not run while the question is up | `local` playing from 02:37:36.1; the sheet's chip and row touched 02:37:44.7 and 02:37:48.3; the alert (`…to the server at 127.0.0.1:8795 with your API key.`) from 02:37:49.1 to the answer at 02:40:07.9, 139.6 s after the choice; the old code's 120 s mark (02:39:48.3) fell inside it, with `alert=up playing=true utterance=84 voice-errors=0 catch-up-errors=0` at +121 s and `utterance=90` at +131 s |
| 2. The old voice goes on, nothing goes to the new recipient | 93 new `text=` lines between 02:37:39 and 02:40:20, all `route=kokoro` (`local`), none `route=speech` (`compatible`); the heartbeats moved 10 → 93 before the answer and on to 103 at the `pause` (02:40:21.0), 12.8 s after it; 115 heartbeats, none with a note; no `[reading] note`, `voice error`, `catch up` or `no audio within` line in the Debug Log; `say`: `provider=local voice=af_bella`, no `note attention`; the screenshot under the alert shows a spinner on `Bella (fake)` and, after Don't Allow, none and no error text |
| 4. The first lookup with a service still asks | `CONSENT lookup before answering alert label="Send selected text to Youdao?" texts=["Send selected text to Youdao?", "Word Lookup sends the text you select to Youdao."] buttons=["Don't Allow", "Allow"]`; Don't Allow: `drawer closed=true alertGone=true`; `Executed 1 test, with 0 failures … in 7.866 seconds`; the Debug Log: `[lookup] … "it."` then `not allowed to reach Youdao`, no `GET` |

### What it cannot prove

- That audio already on the phone plays without the question (owner's decision
  of 2026-10-01): the runs picked sentences that had to be sent. The unit tests
  hold it.
- The other side of the switch: Allow for a Voice, where the deadline starts at
  the answer.
- A question asked with the app away from the screen, a download, Azure and the
  four hosted Providers other than OpenAI.

### Playback in the run, and why it lasted that long

All at `sim_volume` 0, each Play chained to a check, with the fake's zero-valued
PCM, and stopped the moment the fact was established:

- 1a: no audio at all. The Play sat on the question for 81 s and the refusal
  stopped it at 02:34:19.
- 1b: Allow at 02:36:46.0 to `pause` at 02:36:49.4, 3.4 s, of which the clip was
  there from 02:36:47.8: the shortest run that shows the first request coming
  after the answer.
- 2: Play 02:37:36.1 to `pause` 02:40:21.0, 164.9 s and 93 sentences (10 → 103).
  The fact concerns a 120 s deadline, which cannot be seen in less: the old code
  started it at the choice (02:37:48.3, so it would have fired at 02:39:48.3),
  and the question had to stay up past it, with the old voice going on all the
  while, before an answer showed the old voice still going on afterwards (12.8 s).
