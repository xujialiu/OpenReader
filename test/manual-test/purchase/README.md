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
