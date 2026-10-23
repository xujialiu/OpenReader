# Verifying #316: the old unscoped Unlock, and what a simulator can show of it (1.0.1 (12)-beta7-debug, 2026-10-23)

Record of the iOS verification of `0d2f4d2` (`purchaseCacheStore` offers
1.0.0 (7)'s unscoped `{ unlocked, trialStartedAt }` Unlock, never its Trial date,
once to a verified `production` source with no version-2 record of its own). The
app tree was clean at `0d2f4d2` (HEAD moved to `780960e` during the run; the two commits since touch
`README.md`, `docs/release-to-app-store.md`, `notes/` and `test/app/no-outgoing-links.test.ts` only, so the
app code is the same); the run used a session-created `iPhone 17
purchase316` (iOS 27.0, 24A434, `BBA6B4B7-AD14-4E66-8720-C819BFCD52AF`), a Debug
app built from the tree, this checkout's Metro on 8081 (PID 2218) and the kit's
fake Kokoro on 127.0.0.1:8895. Every Play was a real touch (`ax.py touch Play`,
chained to `silence.sh check`); `store`, `noop` and `say` are harness commands,
named as such below.

**Coverage limit, stated first.** The simulator has no `production` source, so the
migration itself (an unscoped Unlock becoming a version-2 production record) is
proved only by the host tests (`test/app/purchase-source.test.ts`,
`test/purchase/source.test.ts`: 26 tests, re-run here, passing), which run the
real startup, adapter, controller and cache with StoreKit and the files doubled.
What this run shows is that nothing else changed: an unverified read still gets
nothing from the old file, and the pretend App Store works as before. It cannot
show an App Store-over-TestFlight install, a real production empty read
(FB22556883), or a `sandbox` or `xcode` source (only Xcode's own Run applies
`storekit/OpenReader.storekit`).

## 1. The installed build is this tree's

- `expo prebuild` was needed: the `ios/` of 2026-10-18 said `1.0.0` and build 9.
  `EXPO_PUBLIC_OPENREADER_DEBUG_MODE=1 npx expo prebuild --platform ios` (25 s)
  wrote `CFBundleShortVersionString` `1.0.1` and `CFBundleVersion` `12` (the
  Debug Mode build of the pair, ADR 0083). `xcodebuild` (Debug, iphonesimulator,
  `RCT_METRO_PORT=8081`, a fresh `-derivedDataPath`, `-jobs 6`) took 159 s,
  `BUILD SUCCEEDED`; the product's and the installed app's `Info.plist` both read
  `1.0.1`, `12`, `RCTMetroPort` `8081`.
- The Debug Log's launch line: `OpenReader 1.0.1 (12)-beta7, native 1.0.1 (12),
  Debug Mode on, Metro bundle`. The bundle Metro serves holds `unscopedUnlock`
  (`function unscopedUnlock(data)`, and its call) and `APP_VERSION =
  '1.0.1 (11)-beta7'`.
- `SettingsVersionProbe` (`kit/run-probe.sh`, real touches): `Executed 1 test,
  with 0 failures (0 unexpected) in 45.325 seconds`; it found the exact label
  `Version 1.0.1 (12)-beta7-debug`, and the screenshot's footer reads
  `1.0.1 (12)-beta7-debug` with the Purchase row `Unlocked`.
- `ios_ready.py … --metro http://127.0.0.1:8081`: `outcome: ready`.

## 2. An unverified source, unchanged

The harness was switched to StoreKit with `{"do":"store","use":"real"}`. On this
simulator the native module answers, read through `cdp.cjs` (booleans and
product ids only, never an identifier):

```text
snapshot {"state":"done","source":null,"owned":[],"revoked":[]}   environment() "unavailable"
```

So every real-path read below is an unverified one (`source` null). The Debug Log
never names a source (`keep()`: "A source identifier is not a diagnostic"), so what it
says of the source is `StoreKit environment: unavailable` and the `owned:` line that
follows; the null `source` itself is from the native read above.

- **Control first.** With the pretend App Store (the Debug default, Unlock
  owned), a real Play at 10:49:58.846 (`[reading] play at utterance none, local
  af_bella`) raised Consent for `127.0.0.1:8895`; the alert was read before it
  was answered (`Send text to the server at 127.0.0.1:8895?`), Allow was a real
  touch at 10:50:10.929, the fake server logged four synthesis requests at
  10:50:11.36 (`text=` lines 1 to 4), and a harness pause landed at 10:50:12.354
  (`lastContentPosition=0.75`). The Provider, Voice, Document and Consent are
  therefore a working control. That is the only playback of the run, about 1 s
  at simulator volume 0.
- **No file (baseline).** `use=real` at 10:50:34.959 logged `the lock is on;
  StoreKit decides`, `StoreKit environment: unavailable`, `owned: unlocked false,
  trial began never`, then `HX store use=storekit access={"kind":"not-started"}
  allows=false price=$4.99`, and the products (`unlock $4.99`, `trial $0.00`).
  A real Play raised `Read Aloud Free for 30 Days` / `After 30 days, reading aloud
  and offline narration need a one-time purchase of $4.99. Reading documents
  stays free.` with `Start Free Trial` and `Not Now`; Not Now logged
  `read-aloud still locked: nothing plays`.
- **The planted file.** The app was terminated, then
  `plant-record.sh UDID unscoped` wrote exactly `{"unlocked":true,"trialStartedAt":null}`:
  39 bytes, no newline, sha256 `9adf3d27c397a4872bacac8f49517654c20618d9e91ee82f1285a66267c5bc2d`,
  modified 10:51:22. Relaunch at 10:51:31:

  ```text
  [purchase] the lock is on; StoreKit decides
  [purchase] StoreKit environment: unavailable
  [purchase] owned: unlocked false, trial began never
  [hx] store use=storekit access={"kind":"not-started"} allows=false price=$4.99 unavailable=false
  ```

  No `purchase.json could not be read` line. Settings > Purchase read plain
  `Purchase` in the tint with a chevron and **no value** (not `Unlocked`); the
  Purchase page listed `Start Free Trial`, `Unlock for $4.99`, `Restore Purchase`.
  A real Play at 10:52:48.227 raised exactly the baseline alert, with the fake
  server's `text=` count 4 before, while the alert stood for 5 s, and after Not
  Now (10:53:03.569). The Debug Log has `play while read-aloud is locked: asking
  (#148)` and `read-aloud still locked: nothing plays` and no `[reading] play at
  utterance`. The player's button stayed Play and the Reading `playing=false`.
- **The file did not change.** From the plant (10:51:22) through the cold
  launch, the Settings and Purchase pages, the alert and its answer, and a
  background and foreground, it stayed 39 bytes, the same sha256, modified
  10:51:22. After the control below the exact file was planted again (10:56:10);
  a second cold launch (10:56:13, the same four lines and `access` `not-started`),
  the switch to the pretend App Store, the Settings and Reading alerts and the
  reset left it byte-identical, modified 10:56:10, until it was deleted at about
  10:59.
- **A foreground entry reads again and still gives nothing.** `axe button home`
  did nothing (`pitfalls/lock-and-background.md`: it does nothing on iOS 27.0),
  so the first attempt proved no foreground entry. `simctl launch
  com.apple.Preferences`, then `simctl launch top.xujialiu.openreader`: the status
  line went `app=inactive` (10:54:15) then `app=background` (10:54:20), and
  `[purchase] owned: unlocked false, trial began never` at 10:54:23.422 is the
  refresh on the return. The file was byte-identical.
- **Control for the file being read at all.** A version-2 envelope holding a
  `production` Unlock of a made-up id (`plant-record.sh UDID v2`, 163 bytes,
  sha256 `9f2fbd08fecb9574521696e13fcef681240879bc2e5998fb16253b1f23ca5a1e`) gave,
  on the same unverified read, `HX store use=storekit access={"kind":"unavailable"}
  allows=false … unavailable=true`, Settings `Purchase, Unavailable`, and a Play
  that raised `Purchases Unavailable` / `Your purchase could not be verified. Try
  again or restore your purchase.` (OK; `text=` still 4; the file untouched).
  That is #162's behaviour for a kept record whose source cannot be verified, and
  it shows `purchase.json` is read at launch in this build. The two files differ
  in what the buyer sees: the old unscoped Unlock is not a kept record for an
  unverified read, so it reads `Not started` (the Trial is offered), where a
  version-2 Unlock reads `Unavailable`.

## 3. The pretend App Store, as before

`{"do":"store","use":"fake"}` with the unscoped file still planted:

- `use=fake access={"kind":"unlocked"} allows=true price=$4.99`; Settings `Purchase,
  Unlocked` (a plain row, not a button). The fake path never reads
  `purchase.json`, which stayed byte-identical.
- `state` `not-started`: `access={"kind":"not-started"}`, the row `Purchase` with no
  value, and a real Play raised the Trial alert with `$4.99`; Not Now:
  `nothing plays`, `text=` 4.
- `state` `ended`: `access={"kind":"ended"}`; a real Play raised `Your Free Trial
  Has Ended` / `Unlock reading aloud and offline narration for good with a
  one-time purchase of $4.99.` with `Unlock for $4.99`, `Restore Purchase`, `Not
  Now`; Not Now: nothing played, `text=` 4.
- Reset with `{"do":"store","state":"unlocked","verification":"available","restoreOutcome":"restored","outcome":"purchased"}`
  (`access` unlocked), `{"do":"noop"}`, then the app terminated, the planted
  `purchase.json` and `purchase-debug.json` deleted, and the app relaunched on the
  default Unlock (`owned: unlocked true` at 10:59:09).

## Method

- `plant-record.sh UDID unscoped|v2|show|remove` (this folder) writes the exact
  bytes, refuses while the app runs (a running app can rewrite the file, and a plant it
  overwrites proves nothing), and prints size, sha256, mtime and the bytes. It
  cannot make a `production` source: the planted file reaches only an unverified
  read on a simulator.
- Leave `{"do":"store"}` (report only) as the last harness command before a
  terminate: the launch replays it and the `HX store …` line it prints is the
  launch's settled `access`, with nothing sent to the app.
- The Debug Log lags the app's stamp by 2.04 to 2.09 s (`FLUSH_MS` 2,000; four
  measured samples): read it 3 s after a command, not 1.5. The harness itself
  picked a command up within 0.1 to 0.2 s.
- This Mac had no iPhone simulator (eight iPads). Creating `iPhone 17 purchase316`
  and booting it took 32 s; the daemon storm of the first boot ended after about
  2.5 minutes (`top -l 2` idle 0 % for a minute, 59 % and then 67 % from
  10:42:33); the guarded phase with the prebuild took 231.7 s, the guarded
  `xcodebuild` and install 165 s.
- Evidence kept outside the repository, with the run's screenshots, phase logs,
  the Debug Log and the fake server's log, in the session's scratchpad
  (`p316/`).

## Left behind

`use=fake`, the Unlock owned (no `purchase-debug.json`), no `purchase.json`,
`harness.json` `{"seq":N,"do":"noop"}`, the staged Document `A Short Test of
Reading Aloud` with Provider `local` at 127.0.0.1:8895 (its fake server stopped
at the end), the Library open, playback stopped, simulator volume 0.
