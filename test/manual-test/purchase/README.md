# The Trial and the Unlock (#148)

ADR 0075 is the record. What a tester needs is below.

## Which App Store a build asks

| Build | App Store | Fallback record |
| --- | --- | --- |
| `EXPO_PUBLIC_OPENREADER_UNLOCKED=1` (no lock) | none: everything speaks, no StoreKit call, no Settings row | none |
| Debug Mode (every Metro build, and the owner's phone build) | the **pretend App Store**, as if the Unlock were owned until a harness command says otherwise | in memory only |
| No Debug Mode (TestFlight, App Store, a release check) | StoreKit | `Library/Application Support/purchase.json` |

So every existing probe and recipe that presses Play still plays: a build with
Debug Mode starts unlocked. Nothing in them changes.

The pretend App Store's state is kept in the app's container at
`Library/Application Support/purchase-debug.json`, so it survives a relaunch.
Delete that file, or send `{"do":"store","state":"unlocked"}`, to put a
simulator back the way every other test expects it.

## Driving it through the harness

Each command is written to `Documents/harness.json` as any other
(`kit/hx.cjs`), and answers with one `HX store …` line, after the app's
controller has read what is owned:

```text
HX store use=fake access={"kind":"trial","endsAt":1791734400000} allows=true price=$4.99 unavailable=false fake={…}
```

| Command | Effect |
| --- | --- |
| `{"do":"store"}` | report only |
| `{"do":"store","state":"not-started"}` | neither the Trial nor the Unlock: Play raises "Read Aloud Free for 30 Days" |
| `{"do":"store","state":"trial","days":12}` | the Trial with 12 days left (it ends a minute short of 12 whole days, so Settings reads `12 days left`) |
| `{"do":"store","state":"trial","seconds":20}` | the Trial ending 20 s from now: for the end of the Trial reached mid-use |
| `{"do":"store","state":"ended"}` | the Trial over, no Unlock: Play raises "Your Free Trial Has Ended" |
| `{"do":"store","state":"unlocked"}` | the Unlock owned |
| `{"do":"store","state":"unavailable"}` / `"available"` | whether products load; with them out, a gated press raises "Purchases Unavailable" |
| `{"do":"store","outcome":"cancelled"}` | the next purchase: `purchased` (default), `pending` (Ask to Buy), `cancelled`, or `failed` (raises "Purchases Unavailable") |
| `{"do":"store","revoke":"unlock"}` | a refund of the Unlock (or `"trial"`) |
| `{"do":"store","arrive":"unlock"}` | the Unlock reported by itself while the app runs, as a purchase on another device or a parent's approval is. Since beta12 it resumes nothing: a download the lock paused stays Paused until Resume all or a ring |
| `{"do":"store","use":"real"}` / `"fake"` | StoreKit instead of the pretend App Store, kept across launches |

`state`, `outcome` and `revoke` make the app's controller afresh, as a launch
does, so the products load again and a press asks from the new state. `arrive`
does not: it is the one that tests what the running app hears by itself.

A purchase through the pretend App Store shows no App Store sheet: the
alert's button is the whole interaction. The App Store's own sheet appears only
with `"use":"real"`.

## What it cannot show

- **StoreKit itself.** The module, the App Store sheet, Restore's sign-in and
  revocations reported by `Transaction.updates` are reached only with
  `"use":"real"`, and the simulator's StoreKit answers only from
  `storekit/OpenReader.storekit` when Xcode launched the app (Product > Run);
  `npx expo run:ios`, `xcodebuild` and `simctl launch` ignore the scheme's
  StoreKit configuration (ADR 0075). Otherwise it asks the App Store's sandbox,
  whose products need their App Store Connect metadata complete.
- **App Review's and TestFlight's sandbox**, where purchases cost nothing.
  Only an upload shows those.

## Recipe: the gate, the alerts and the end of the Trial (#148)

1. Silence the simulator (`kit/silence.sh set`), launch the Debug build, open
   a book with a Provider and Voice ready, and stop at the player.
2. `{"do":"store","state":"not-started"}`. Press Play: the trial alert, with
   `$4.99`. Not Now: nothing plays and nothing is sent. Play again, Start Free
   Trial: it plays. The last row of Settings' first card reads **Purchase**,
   its label in the tint as Privacy Policy's is, `30 days left` on the right in
   grey, and a chevron. Before the Trial it has no value. It opens a page titled
   Purchase: Start Free Trial (before the Trial only), Unlock for $4.99,
   Restore Purchase.
3. `{"do":"store","state":"ended"}`. Press Play: the ended alert with Unlock for
   $4.99, Restore Purchase, Not Now. Unlock: it plays. The row is now plain, not
   tinted, reads `Unlocked` and opens nothing.
4. `{"do":"store","state":"unavailable"}` after `"state":"ended"`: Play raises
   "Purchases Unavailable"; OK; nothing plays.
5. The end of the Trial mid-use: `{"do":"store","state":"trial","seconds":20}`,
   press Play, and let 20 s pass while it plays. It keeps playing. Pause, then
   Play: the ended alert.
6. A download across the end (`download-across-end.sh`): it stops at the next
   sentence and is **Paused**, as Pause all pauses it. The drawer shows no state
   line, Resume all, and Resume download rings. `{"do":"store","arrive":"unlock"}`
   resumes nothing; Resume all then goes on with no question. Without the
   Unlock, Resume all or a ring raises the ended alert, and Unlock there
   resumes it. Sent to the background and back while locked, it stays Paused,
   nothing is fetched, and the Debug Log has no `continued task submitted` line.
   A relaunch while locked leaves it Paused too.
7. A Lock Screen Play while locked plays nothing and leaves no alert behind,
   and the centre button **goes back to Play** (`LockScreenProbe`, after the
   kit's `play`), where beta11 and beta12 left it on Pause. Use
   `lock-device.sh UDID play-refused` for the press, not `play`: from beta13 the
   button is on Pause for about 400 ms, so `play`'s "turns to Pause" assertion
   fails and the failed run leaves xcodebuild in `simctl diagnose` for minutes
   (Measured on beta13, below).
8. Restore with nothing to restore: `{"do":"store","state":"ended"}`, Play,
   Restore Purchase raises **No Purchase Found** / "There's no purchase to
   restore for this Apple Account." with OK, and nothing plays. The same from
   Purchase → Restore Purchase. The pretend App Store's restore always finishes,
   so a cancelled sign-in, which says nothing, is reached only with
   `"use":"real"`.
9. Leave the simulator with `{"do":"store","state":"unlocked"}`.

Play only while measuring, then stop (MEMORY/device-testing.md).

## Scripts

Both press with real touches (`axe touch`), read the app's own answers from the
Debug Log, and set and check the simulator's volume before every press. The
Lock Screen's refused Play is `kit/lock-device.sh UDID play-refused` (above).

```sh
bash test/manual-test/purchase/trial-end.sh SIMULATOR_UDID [SECONDS] [--ask]
bash test/manual-test/purchase/download-across-end.sh SIMULATOR_UDID SECONDS SHOTS_DIR [FAKE_LOG]
```

- `trial-end.sh` is step 5's Reading: the Trial of `SECONDS` (default 3), a Play
  inside it, a Pause 4 s after its end, and `TRIALEND` lines naming the end
  (`endsAt`, from the app's own `HX store` line), the press, every cue after the
  end and any `play while read-aloud is locked` line (none may precede the end).
  `--ask` then presses Play and prints the ended alert. Reader open and paused,
  Voice ready.
- `download-across-end.sh` is step 6's Download: with the drawer open and
  chapters chosen, a Trial of `SECONDS`, a press on `Download selected (N)`, a
  poll of the drawer until it shows Paused (Resume all, no running state; it
  fails on beta11's Interrupted), a screenshot, the drawer's lines, the fake
  server's last requests beside the Trial's end, and a press on Resume all that
  raises the ended alert (answered Not Now). Its Provider needs to be slow and
  the Document not yet saved in that voice (see below).

## Measured on beta13 (2026-10-09, iPhone 17, iOS 27.0, Metro 8082): the Lock Screen button

beta13 writes the reading as playing when a Play is refused, and as paused again
400 ms later. A Reading was played and paused once (the Now Playing session),
`{"do":"store","state":"ended"}`, `lock-device.sh UDID lock`, then
`lock-device.sh UDID play-refused`, `unlock`, and `LockScreenProbe` reading the
centre button (`run-probe.sh LockScreenProbe UDID OUT --expect-player`).

- **The button comes back to Play.** Refused at 17:51:49.087: the test's own
  reads were `label when the tap returned: Pause` (17:51:49.284) and `label 2 s
  later: Play` (17:51:51.353); `LockScreenProbe` read `Play` at 17:52:40.434 (51 s
  later, where beta12 read Pause at 36 and 42 s). Refused at 17:53:06.085: `Pause`
  at 17:53:06.276, `Play` at 17:53:08.320, probe `Play` at 17:53:48.519 (42 s).
  The first run used the old `play` test (refusal 17:43:52.950), which failed its
  own assertion (`XCTWaiterResult(rawValue: 2)`, `Executed 1 test, with 1
  failure`, DeviceLockProbe.swift:89): the label had turned back before its
  first look, 1.5 s after the tap. Its xcodebuild then sat in `simctl diagnose
  -l -b` for 5 minutes until its process group was killed, and `LockScreenProbe`
  read `Play` 6.5 minutes later.
- **`mediaremoted` shows the pair**: `17:51:49.109 PlaybackState changed from
  Paused to Playing`, `17:51:49.501 … from Playing to Paused` (392 ms); `17:53:06.092`
  and `17:53:06.486` (394 ms); `17:43:52.957` and `17:43:53.365` (408 ms). Beta12 had
  none.
- **Nothing played**: in all three the Debug Log has `play while read-aloud is
  locked: asking`, `locked, and not asked away from the screen`, `read-aloud
  still locked: nothing plays`, no `[reading] play at utterance`, no `playing=true`
  (the app stayed `playing=false app=background`), and the fake server's text
  count did not move (141 before and after). No alert waited after the unlock.
- **Control, the Unlock owned**: the kit's `play` passed (`Executed 1 test, with 0
  failures`); `17:54:19.341 [reading] play at utterance 29` with `app=background`,
  `mediaremoted` `Paused to Playing` at 17:54:19.397, a harness pause at
  17:54:21.421 (2.1 s of play), `Playing to Paused` at 17:54:21.439, and
  `LockScreenProbe` read `Play` afterwards: the button follows the real state.
  The `restate` is not involved (no pair of its kind).
- **A refusal with the app in front** (Play, Not Now) writes the same pair
  (`17:55:28.990` and `17:55:29.309`) and plays nothing.

## Measured on beta12 (2026-10-09, iPhone 17, iOS 27.0, Metro 8082, the fake Kokoro at one sentence a second)

Every press is a real touch; `store` and `open` are harness commands. To repeat
a download run: Manage downloads → Delete all saved audio (it drops the task,
so `Download selected` counts the chapters again), relaunch (the memory cache
would answer sentences already fetched, `pitfalls/verification-runs.md`), then
`Select all`. Before a relaunch put `{"do":"noop"}` in `harness.json`, or the
last `store` command runs again at launch.

- **A download across the end of the Trial is Paused.** Trial of 7 s ending at
  17:23:02.821; the last request left at 09:23:02.612Z (in flight at the end,
  saved), none after; `17:23:02.874 [download] read-aloud is locked: every
  download that would go on is paused (#148)`, 53 ms after the end. The drawer
  has no state line, `Resume all`, and four `Resume download` rings
  (`download-across-end.sh` saw `no state line` plus `Resume all` at 17:23:03.156
  and took its screenshot; the Paused test of the script is right on the screen).
  `Resume all` raised the ended alert; Not Now left it Paused.
- **The same with the app in the background**: a 15 s Trial ending at 17:33:08.335
  with the app away since 17:33:00.5: last request 09:33:08.305Z (9 of 10 saved),
  `17:33:08.585` paused (the timer ran away from the screen), and on the return
  Paused, 131 requests before and after, no `continued task submitted`.
- **Locked, a background and return** leaves it Paused: no `Queued`, no
  request (79 before and after 10 s), no `continued task submitted` line, and
  no `[download]` line at all after `[app] app active`. **A relaunch while
  locked** does too, including a Trial that ended while the app was not running:
  killed mid-download at 17:26:05, the Trial ended 17:26:12.034, launched
  17:26:23.837, `owned: unlocked false` 17:26:24.159, paused 17:26:24.374, 102
  requests before and after, no continued task.
- **A purchase change pauses at once**: `{"do":"store","state":"ended"}` while a
  download ran paused it in the same millisecond as the new controller
  (17:24:59.604).
- **An Unlock arriving by itself resumes nothing**: transaction 17:25:14.438,
  90 requests before and after 9 s, still Paused. `Resume all` then went on with
  no alert (90 to 93 in 3 s). After the end, `Resume all`, the alert, and Unlock
  resumed it (17:24:47.432, 79 to 82 in 3 s).
- **Control**: killed mid-download with the Unlock owned, the launch read
  `owned: unlocked true` at 17:27:20.267 and `continued task submitted … 3 of 5
  chapters` at 17:27:20.462, and the requests went on (108 to 111 in 5 s). A
  Download from the not-started state, Start Free Trial: trial owned 17:36:59.238,
  continued task and requests, not paused.
- **No Purchase Found** ("There's no purchase to restore for this Apple
  Account.", OK) from the Purchase page in a Trial, after it and before it, and
  from the ended alert's Restore Purchase, which then plays nothing
  (`restored: ended`, `nothing plays`). With `"use":"real"`, Restore raises the
  system's own `Sign in to Apple Account` sheet (Apple Account, Password, Cancel,
  OK); Cancel logged `[purchase] restore did not finish: Error:
  UnexpectedException: Request Canceled` and the app showed nothing.
- **The Purchase row**: label in the tint as Privacy Policy's, value in grey,
  chevron; `Purchase` (no value) before the Trial, `12 days left`, `1 day left`,
  `Trial ended`; plain `Purchase · Unlocked` that opens nothing; the page titled
  Purchase; unavailable shows `Unlock` and the footnote. Light and dark.
- **The Lock Screen button did not come back to Play** (beta12; beta13 fixes it, below). Three
  refused Plays with the Trial over (17:19:17.118, 17:28:36.864, 17:30:00.476):
  `LockScreenProbe` read `Pause` at 17:19:59.029 (42 s later) and 17:30:36.328
  (36 s later), and the kit's `pause` test, which passes only while the button
  reads Pause, passed on a run started 24 s after the second. The app did
  restate: the simulator's log has `Setting nowPlayingInfo` with
  `PlaybackRate = 0` from OpenReader at 17:19:17.116, 2 ms after the command's
  success reply. But `mediaremoted` logged no `PlaybackState changed` or
  `isPlaying changed` at all in that minute (it does on a real Play: `17:18:32.013
  PlaybackState changed from Paused to Playing`), and MediaRemoteUI's own
  waveform controller said `playing=1` for the app at 17:19:56: the button is the
  system UI's own state from the tap, and rewriting the same paused state moves
  nothing. A diagnostic through `globalThis.expo.modules.OpenReaderNowPlaying`
  (`cdp.cjs --eval FILE http://127.0.0.1:8082`: `show({…, playing:true})`, then
  `show({…, playing:false})` 400 ms later, no app code changed) put the button
  back to `Play` (`LockScreenProbe`).
  How to look: `xcrun simctl spawn UDID log show --start 'YYYY-MM-DD HH:MM:SS'
  --end '…' --predicate 'process == "mediaremoted"' --style compact`, whole
  seconds only (fractions answered nothing).

## Measured on beta11 (2026-10-09, iPhone 17, iOS 27.0, Metro, the fake Kokoro)

What beta11 did, kept as measured. beta12 changed two of these on the owner's
decision: a download the lock stops is now Paused and not Interrupted, and an
Unlock arriving by itself no longer resumes it. A refused Lock Screen Play now
puts the button back to Play (recipe steps 6 and 7).

- **The least Trial that works is 2 s.** A real touch lands about 1.4 s after
  the harness command is written: the app reads it within 250 ms, and `axe
  touch` takes about 0.85-1.2 s before the event arrives when `describe-ui` is
  not run first. `"seconds":2` put the Play 0.85 s inside the Trial
  (`endsAt` 16:11:23.550, `[reading] play at` 16:11:22.697); `"seconds":3` put it
  1.2-1.4 s inside. `"seconds":1` cannot work, and `ax.py touch` (which runs
  `describe-ui` for 2 s first) needs 5 or more.
- **A Reading playing across the end plays on, and keeps fetching.** With `"seconds":3`
  the Trial ended at 15:48:16.206, mid-sentence 6; cues for 7, 8, 9 and 10
  followed at 15:48:17.0, 18.8, 20.6 and 22.6, and the fake server was asked for
  four new sentences after the end (15:48:16.7, 18.3, 20.1, 22.5). That is ADR
  0075's accepted read-ahead. The next Play after Pause met the ended alert.
- **A Pronunciation's automatic resume raises no alert after the end.** With
  Word Lookup on and `pauseReading` off (a `settings` patch with
  `lookup:{enabled:true,pauseReading:false,direction:"en-zh",target:"zh-CN",service:"youdao",microsoftRegion:""}`
  and `"lookup:youdao"` in `consent`), a real long press
  (`axe touch -x 157 -y 156 --down --up --delay 1.2`, on a word at the top of the
  page) opens the drawer with Youdao's entry (the Mac reaches
  `www.youdao.com` and `dict.youdao.com/dictvoice`), and `Play UK pronunciation`
  is a button in the tree. With the drawer up the player is covered, so the
  Reading is started by `{"do":"play"}` (the same gated `play()`). Trial of 3 s:
  end 15:51:31.416, `{"do":"store"}` at 15:51:32.430 read `access ended allows=false`,
  the press paused the Reading at 15:51:33.572, and the resume
  (`[reading] play at utterance 5`) came at 15:51:35.293 with no `play while
  read-aloud is locked` line and no alert. `pauseReading` on leaves the Reading
  paused when the button is pressed, which owes no resume.
- **A Download stops after the sentence in flight.** The fake at one sentence a
  second (`OPENREADER_FAKE_TTS_DELAY_MS=1000`, the local Provider's one sentence
  at a time): the Trial ended at 07:58:06.017Z, the last request left at
  07:58:05.616Z and was saved (`7 / 10`), none left after. The drawer reads
  `Interrupted · continues when available` with `Resume all` and `Resume
  download` rings. After the app went to the background and came back, the same
  download read `Queued` with `Pause all`, no request was made while it did
  (44 before and after, 15:59:34 to 16:00:30), and the Debug Log said
  `[download] continued task submitted showing "Downloading 1 book" … : not run`.
  `Resume all` and a ring both raise the ended alert; Unlock
  there resumes it; `{"do":"store","arrive":"unlock"}` resumed it 0.2 s after
  the transaction (07:59:01.989Z, next request 07:59:02.192Z) with no relaunch,
  and from the `Queued` state after a background and return too (transaction
  16:28:37.287, request count 61 to 62 within 1.2 s).
  A sentence the Reading fetched earlier in the process is read from memory
  (`pitfalls/verification-runs.md`, #134): download a Document not played in this
  process, or relaunch after deleting.
- **The Lock Screen.** `OPENREADER_LOCK_DEVICE_WORK=DIR bash kit/lock-device.sh
  UDID lock|play|pause|unlock` (see its header) with the Trial ended: the Play
  reaches the app while it is `app=background` and plays nothing (`[reading]
  play while read-aloud is locked: asking`, `[purchase] locked, and not asked away
  from the screen`, `[reading] read-aloud still locked: nothing plays`), no alert
  waits on return. **The kit's `play` test still passes** (the system turns the
  centre button to Pause at the tap), so its exit status says nothing about
  whether the app played; and the button then **stays on Pause**: the kit's own
  `pause` test, run 10 s later, and `LockScreenProbe` 85 s later both read it as
  Pause while `[hx] playing=false`. With the Unlock the same `play` plays
  (`[reading] play at utterance 4` at `app=background`, 2.1 s until the harness
  paused it) and the label follows the app.
- **StoreKit itself (`"use":"real"`) on this simulator, launched by `simctl`,
  no Apple ID, no StoreKit configuration:** `[purchase] StoreKit environment:
  unavailable` (`AppTransaction.shared` threw), no entitlements (`access`
  `not-started`), and the products loaded 1.3 s after the switch:
  `top.xujialiu.openreader.unlock $4.99`, `top.xujialiu.openreader.trial $0.00`,
  no error line. Play then raised the trial alert with the real price. Nothing
  was bought. Whether the answer is the App Store sandbox's or a leftover local
  configuration cannot be told from these lines.
- **The first `HX store` line after a state command is early.** It is printed
  once what is owned has been read, a millisecond before the products load or
  fail, so it says `price=null unavailable=false` even for `"state":"unavailable"`;
  the `[purchase] products:` or `products did not load` line follows. Send
  `{"do":"store"}` again for the settled line.
- **A relaunch replays `harness.json`'s last command.** With the last command a
  `store` state, deleting `purchase-debug.json` and relaunching read `not-started`
  and wrote the file again. Put `{"do":"noop"}` there and let it run before
  terminating; a launch alone never writes `purchase-debug.json`, and a fresh
  one reads `unlocked`.
