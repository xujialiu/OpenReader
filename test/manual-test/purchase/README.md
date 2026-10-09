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
| `{"do":"store","arrive":"unlock"}` | the Unlock reported by itself while the app runs, as a purchase on another device or a parent's approval is: downloads held back go on with no relaunch |
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
   Trial: it plays. Settings → Read Aloud reads `30 days left`.
3. `{"do":"store","state":"ended"}`. Press Play: the ended alert with Unlock for
   $4.99, Restore Purchase, Not Now. Unlock: it plays. Settings reads `Unlocked`.
4. `{"do":"store","state":"unavailable"}` after `"state":"ended"`: Play raises
   "Purchases Unavailable"; OK; nothing plays.
5. The end of the Trial mid-use: `{"do":"store","state":"trial","seconds":20}`,
   press Play, and let 20 s pass while it plays. It keeps playing. Pause, then
   Play: the ended alert. A download started inside those 20 s stops at the
   next sentence (`interrupted`) and goes on after `{"do":"store","arrive":"unlock"}`.
6. A Lock Screen Play while locked plays nothing and leaves no alert behind.
7. Leave the simulator with `{"do":"store","state":"unlocked"}`.

Play only while measuring, then stop (MEMORY/device-testing.md).

## Scripts

Both press with real touches (`axe touch`), read the app's own answers from the
Debug Log, and set and check the simulator's volume before every press.

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
- `download-across-end.sh` is step 5's Download: with the drawer open and
  chapters chosen, a Trial of `SECONDS`, a press on `Download selected (N)`, a
  poll of the drawer until it reads Interrupted, a screenshot, the drawer's
  lines, the fake server's last requests beside the Trial's end, and a press on
  Resume all that raises the ended alert (answered Not Now). Its Provider needs
  to be slow and the Document not yet saved in that voice (see below).

## Measured on beta11 (2026-10-09, iPhone 17, iOS 27.0, Metro, the fake Kokoro)

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
