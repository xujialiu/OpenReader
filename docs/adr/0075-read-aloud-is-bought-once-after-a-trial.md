---
status: accepted
---

# Read-aloud is bought once after a Trial, through our own StoreKit module

_The product half is [design 0075](../design/0075-read-aloud-is-bought-once-after-a-trial.md).
Issue #148; the author's decisions of 2026-10-09 are its plan comment. The terms
are CONTEXT.md's **Trial** and **Unlock**. Every Apple page below was read on
2026-10-09: the App Store Review Guidelines "Last Updated: June 8, 2026", and the
Developer Program License Agreement (DPLA) "last updated August 18, 2026". Code
places are at `7b039fd`. None of this is built yet._

## The products

There are two Non-Consumables in App Store Connect, created on 2026-10-09
(notes 2026-10-09 14:20):

| Reference name | Product ID | Apple ID | Price |
| --- | --- | --- | --- |
| 30-day Trial | `top.xujialiu.openreader.trial` | 6820864102 | US$0.00 |
| Unlock | `top.xujialiu.openreader.unlock` | 6820865303 | US$4.99 |

The trial's identifier names no length, so a change of length keeps the
product; only its display name, "30-day Trial", follows the length.

- **"30-day Trial"**, at price 0. Guideline 3.1.1: "Non-subscription apps may
  offer a free time-based trial period before presenting a full unlock option by
  setting up a Non-Consumable IAP item at Price Tier 0 that follows the naming
  convention: “XX-day Trial.” Prior to the start of the trial, your app must
  clearly identify its duration, the content or services that will no longer be
  accessible when the trial ends, and any downstream charges the user would need
  to pay for full functionality."
  - The current help page, "Set a price for an In-App Purchase", does not show a
    free price point. An Apple DTS reply of April 2026 called the free and paid
    pair "the current approach", and that thread's app went live with one in May
    2026 (https://developer.apple.com/forums/thread/823270). On 2026-10-09 the
    Price menu offered `$0.00` as its first entry, and the trial was saved at it.
- **The Unlock**, at US$4.99 with the United States as the base storefront.
  US$4.99 is a valid point: steps are $0.10 up to $9.99. From the help page
  (https://developer.apple.com/help/app-store-connect/manage-in-app-purchases/set-a-price-for-an-in-app-purchase),
  Apple generates "prices across the other 174 storefronts and 43 currencies"
  and "will never change the price in your base country or region". Also: "If
  you select your own prices, Apple won't adjust your pricing on those
  storefronts in the future."
- **Family Sharing is off on both.** "Keep in mind that once you turn on Family
  Sharing for an In-App Purchases in App Store Connect, you can't turn it off"
  (https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/turn-on-family-sharing-for-in-app-purchases).

### Why a zero-price product, not the download date

`AppTransaction.originalPurchaseDate`: "In the sandbox testing environment, the
original purchase date is always 2013-08-01 12 AM PDT, which is 1375340400000
milliseconds in UNIX epoch time." A Trial counted from the download date would
have ended in 2013 for every TestFlight tester and for App Review. It would also
start before the app could disclose the terms that 3.1.1 requires "prior to the
start of the trial".

The DTS reply in thread 823270 makes the same point: "purchase event is not
when a user has opened or started to use your app or service. For that reason a
free non-consumable enables the users to know the terms and start the clock
when they are ready."

### The Trial's arithmetic

The Trial ends 30 days after the trial transaction's `purchaseDate`, compared
with the device clock. An App Store Commerce Engineer in January 2023
(https://developer.apple.com/forums/thread/722874): the app "will use the
transaction purchaseDate to reliably start/end their trial experience. With a
non-consumable the transaction will be consistent across all their devices with
that Apple ID - from new devices, re-installs, etc."

The same answer orders the states, and the module keeps this order:

1. the Unlock is owned;
2. the Trial is running;
3. the Trial has ended;
4. the Trial was never started, so it is offered.

A device clock wound back lengthens the Trial. That is not defended against
(decision of 2026-10-09). The free routes below make it pointless, and checking
the time over the network would mean a third party.

## The gate

### Speech: `play()`

`play()` at `src/app/use-reading.ts:1354` is the only path that builds an
engine (`build` at 1306). Every way of starting speech ends there:

- the Player's Play (`src/app/player.tsx:286` → `src/app/reading-view.tsx:742`);
- Now Playing's `play` and `togglePlayPause`
  (`modules/open-reader-now-playing/ios/OpenReaderNowPlayingModule.swift:202–230`
  → `src/now-playing/index.ts:182–188` → `reading-view.tsx:544–552`), which
  covers the Lock Screen, Control Centre, AirPods and car head units;
- the resume after a Pronunciation (`src/app/use-lookup.ts:31`,
  `src/translation/pronunciation.ts:30/41`).

The Reading Button never plays. There is no CarPlay, Siri or App Intents path.

**Saved clips are covered by the same gate, and by nothing nearer the
Provider.** Downloaded audio has no player of its own. It plays only through a
Reading's engine, via `savedClip` (`src/offline/runtime.ts:491–495`).

A gate beside `consent.ensure` in `synthesize()` (runtime.ts:510) would block
new synthesis but not downloaded audio. Three paths return a clip before that
check:

- saved clips, at 491–495;
- the runtime's memory cache, at 500–501;
- the engine's own clip cache (`src/playback/clips.ts:216–220`), which never
  reaches the runtime at all.

So the gate is `play()`.

**The purchase alert comes before Consent.** `play()` calls `consent.again()`
at 1362. There is no point asking a Provider's Consent for speech that cannot
play.

**A Reading that is playing at expiry keeps its engine** (decision of
2026-10-09). Once an engine exists, `pump()` (`src/playback/engine.ts:305`)
calls `fetchWindow` (`src/playback/read-ahead.ts:78`) whatever the playing
state. So after the Trial ends, a paused Reading's skip, word tap, Contents row,
`extend` (engine.ts:712) or Voice switch may still fetch up to three sentences
ahead. Nothing plays them until the next `play()`, which meets the gate. This
is accepted.

### Downloads: four places

- `startDownload` (runtime.ts:992; Consent at 1006–1007);
- `toggleTask` (1056), behind Resume all and Retry failed;
- `toggleChapter` (1068), behind a chapter's ring;
- the scheduler's `allowed()` hook (599–602).

**The hook is the one that cannot be left out.** `startDownloads()` (869) restarts
unfinished tasks with no tap:

- at launch (`src/app/shell.tsx:124`);
- on returning to the foreground (933–944);
- when the network comes back (894–904);
- when a Reading plays in the background (`src/app/reading-host.tsx:138–142` →
  `setReadingPlays` at 974).

A gate only at `startDownload` would let all four through. `allowed()`
answering no is also what pauses a running Download when the Trial ends. Where
exactly it stops, between sentences or between chapters, is left to the
implementation.

### A test that pins it

The gate gets a structural test of its own, in the manner of
`test/app/consent-paths.test.ts`, naming every entry above.

## StoreKit 2 through our own Swift Expo module

`modules/open-reader-store/` is a fifth local Swift Expo module, beside
`open-reader-now-playing`, `open-reader-offline`, `open-reader-palette` and
`open-reader-debug-log` (56 to 622 lines each). Its surface:

- `Product.products(for:)`;
- `product.purchase()`, verified, then `transaction.finish()`;
- iterating `Transaction.currentEntitlements`;
- a `Task` over `Transaction.updates` started in `OnCreate` and cancelled in
  `OnDestroy`. It sends events for revocations too, so a refunded Unlock locks
  again.
- `AppStore.sync()`, only from Restore Purchase. Apple's documentation for
  `sync()` says: "Call this function only in response to an explicit user
  action", and "Don't automatically restore purchases, especially when your app
  launches."
- `AppTransaction.shared`.

The deployment target is 17.2, so nothing needs an `#available` guard
(`AppTransaction` is iOS 16.0). expo-modules-core 57.0.18 ships
`ConcurrentFunctionDefinition`, so `AsyncFunction` takes an `async throws`
closure. The estimate is 200 to 300 lines of Swift and about 80 of TypeScript.
That is a judgement, not a measurement.

**A kept Unlocked flag backs up the entitlement read.** Apple Forums thread
823454 (April to August 2026, FB22556883, unresolved) reports that for a few
production users `currentEntitlements` and `Transaction.all` both return empty
for valid non-consumables, and `AppStore.sync()` does not help. The workaround
discussed there is a local "unlocked" flag kept after the purchase, plus a
Restore button. The flag is set on a verified Unlock transaction and cleared on
its revocation.

### Not expo-iap

expo-iap is the library Expo's guide names beside RevenueCat. It sends nothing
anywhere by default, and it covers every call above. It lost on what comes with
it:

- **Size**: openiap-apple is about 10,400 lines of Swift and the expo-iap JS
  build about 4,500. Most of that is Android, Amazon (Vega/Fire OS), Meta
  Horizon and Onside, none of which this app uses.
- **Churn**: `latest` 5.8.3 came out on 2026-10-07 and 6.0.0-rc.0 on
  2026-10-08. Major versions: 3.0.0 on 2025-09-12, 4.0.0 on 2026-04-10, 5.0.0
  on 2026-07-30. That is one about every three months.
- **CocoaPods**: its config plugin edits the Podfile, adding
  `source 'https://cdn.cocoapods.org/'`. The `openiap` pod comes from CocoaPods
  trunk, which becomes read-only on **2026-12-02**.
- **Refunds**: its `Transaction.updates` listener skips revoked transactions
  ("Skipping revoked transaction") and sends JS no event.
- **One bad entry fails the read**: `checkVerified` throws on any unverified
  transaction, so one unverified entry fails the whole `getAvailablePurchases`
  call.
- **Debug noise**: debug builds print a one-time console message asking for a
  GitHub star.

### Not react-native-iap, not RevenueCat

- **react-native-iap** 16.7.3 has the same native core and runs on Nitro
  Modules. Its README marks "Expo Dev Client ❌" and says "Use `expo-iap` for
  Expo projects".
- **RevenueCat** (react-native-purchases 10.12.2) needs a RevenueCat account,
  an API key and our In-App Purchase Key (.p8) uploaded to them. Their privacy
  page says "RevenueCat collects purchase history from users". It is free up to
  $2,500 a month in revenue, then 1%. It is a third-party backend, which
  [ADR 0002](0002-bring-your-own-api-keys-no-backend.md) rules out.

There is no first-party module. `expo-in-app-purchases` was removed on
2023-11-02 (expo/expo #24993). `expo-application`'s
`getAppleStoreEnvironmentAsync()` (PR #51209, merged 2026-10-08) is not in SDK
57.

## Environments: one binary, locked everywhere

| Where the app runs | `environment` | Source |
|---|---|---|
| App Store | `.production` | StoreKit receipts documentation |
| TestFlight | `.sandbox` | "Apps that you download from TestFlight always run in the sandbox environment." |
| App Review | `.sandbox` | Receipts documentation: "…when testing your app in the sandbox and while your app is in review"; DTS, May 2026: "Apple reviews In-App Purchases in the sandbox" |
| Xcode, with a `.storekit` file | `.xcode` | `AppStore.Environment` |
| Xcode, development-signed, without one | `.sandbox` | "Development-signed apps you build and run from Xcode" |

No API tells App Review from TestFlight. `AppTransaction.storeType` (iOS 27) has
only `consumer`, `education` and `enterprise`.

So nothing unlocks by environment. A rule of "free unless `.production`" would
unlock the reviewer too, and the purchase would not be "visible to the reviewer
and functional" (Guideline 2.1(b)). Two Apple Forums reports, both with no
replies, show what happens:

- **Thread 803988**: a reviewer saw a screen meant only for TestFlight, and the
  app was rejected for "items related to beta testing".
- **Thread 823953**: an app that auto-unlocked for the reviewer was rejected
  under 2.1(a).

TestFlight needs no exception, because its purchases are free:

- testflight.apple.com: "In-app purchases are free only during beta testing,
  and any in-app purchases made during testing will not carry over to App
  Store versions."
- DPLA 7.4: digital purchases in a TestFlight build "must be for no charge to
  the end user and must be for beta testing purposes only".

The TestFlight build is therefore byte for byte what App Review sees.

## What the binary and the store page never say

DPLA 7.4 allows external TestFlight testing "solely for their testing and
evaluation of such pre-release versions". It goes on: "You may not use
TestFlight for purposes that are not related to improving the quality,
performance, or usability of pre-release versions of Your Application (e.g.,
continuous distribution of demo versions of Your Application in an attempt to
circumvent the App Store … are prohibited uses)." Under 6.5, "Apple reserves
the right to require You to cease distribution of Your Application through
TestFlight, and/or to any particular Beta Tester, at any time in its sole
discretion."

Guideline 2.2: "Demos, betas, and trial versions of your app don't belong on the
App Store – use TestFlight instead."

Guideline 2.3.1(a): "Don't include any hidden, dormant, or undocumented features
in your app; your app's functionality should be clear to end users and App
Review. All new features, functionality, and product changes must be described
with specificity in the Notes for Review section of App Store Connect (generic
descriptions will be rejected) and accessible for review." Under 2.3.1(b),
"Egregious or repeated behavior is grounds for removal from the Apple Developer
Program."

So the binary and the App Store metadata never name the TestFlight beta or
building from source as a way to get read-aloud free:

- **An expired-trial alert that named them** would either be seen by App
  Review, with an App Store app pointing away from its own purchase, or never
  be seen, since no reviewer waits 30 days. The second is the hidden-feature
  case.
- **The App Store description says the app is open source and where its source
  is.** Nothing forbids that. Maccy's listing reads "Open source. The source
  code is available on GitHub under the MIT license. This version is being sold
  on the App Store to support the development."
- **The README names both free routes and how to turn the lock off.** The
  author decided this on 2026-10-09. The README is one tap from the binary
  (ADR 0017, the #129 section), so this is a known tension with the line that
  ADR draws. Its risk falls on the TestFlight program (6.5), not on the app.
  If the README links the public TestFlight invitation, that address goes on
  `PAGES_MAY_NAME` in `test/app/no-outgoing-links.test.ts`.

The Notes for Review of the version that ships this describe the Trial and the
Unlock (2.3.1(a)).

## The build switch: locked unless turned off

The lock is on in every build unless an `EXPO_PUBLIC_` value turns it off at
build time. It is read as `DEBUG_MODE` is (`src/debug/mode.ts`,
[ADR 0054](0054-debug-mode-is-fixed-when-the-app-is-built.md)): inlined into
the bundle as a constant, with `metro.config.js`'s `publicEnvironment` closing
the Metro cache trap that ADR measured. The variable is
`EXPO_PUBLIC_OPENREADER_UNLOCKED`, and `1` turns the lock off. It was named on
2026-10-09, before it was built, because the README names it.

With the switch off, there is no gate, no alert, no Settings row and no StoreKit
call.

It defaults to locked so that an official build cannot ship unlocked because a
flag was forgotten (decision of 2026-10-09).

The cost falls on someone building from source. Their bundle ID has no
products in App Store Connect, so a build that leaves the lock on finds nothing
to sell. The README tells them to turn it off. The Demo App
(`top.xujialiu.openreader.demo`) is in the same position: it has no products.

**When no product loads, speech stays locked** (decision of 2026-10-09). The
entitlement state is read from StoreKit's own cache, offline included; only the
products and their prices need the App Store. So when the gate would show an
alert but no product loads, the alert reads "Purchases Unavailable / The App
Store can't be reached right now." with one OK, and nothing plays. It names no
free route. The same alert covers the App Store copy offline or during an
outage. Letting speech through instead would let anyone whose Trial had ended
play saved Offline Narration in Airplane Mode. It would also make the
locked-by-default switch pointless for builds from source.

## Testing locally

- **The `.storekit` file lives outside `ios/`.** `ios/` is regenerated
  (`.gitignore:40`). A config plugin writes `<StoreKitConfigurationFileReference>`
  into the generated scheme's `<LaunchAction>`. Apple: "By default, StoreKit
  Testing in Xcode is disabled."
- **It applies only when Xcode launches the app.** RevenueCat: "Any command
  line tools that use the `xcodebuild` command to start running an app … won't
  use the StoreKit Configuration File specified in your scheme." expo/expo
  #39912 says the same of `expo run:ios`, which launches through `simctl`.
  `ios-tester`, which also launches through `simctl`, therefore sees no local
  StoreKit configuration. Sandbox purchases are tested on the iPhone with a
  Sandbox Apple Account.
- **The Simulator may not complete a local purchase.** Apple Forums thread
  820991 (March 2026, no replies) reports that on the iOS 26.4 Simulator a
  local StoreKit `purchase()` returns `.userCancelled` at once, even in Apple's
  sample app. iOS 27 has not been checked.

## No one installed before the Unlock (decided 2026-10-09)

The first version on the App Store already sells the Unlock (author's decision,
2026-10-09). 1.0.0 (6), submitted on 2026-10-05 as a free app with manual
release, is left to finish review for its verdict on the bring-your-own-key
model. It is not released. When the build with the Unlock is ready, 1.0.0 (6)
is withdrawn ("Cancel this release" or Developer Reject), and the new build is
submitted under the same Version, 1.0.0, together with both In-App Purchases.
Forum reports say that withdrawing an approved version has occasionally left
the record stuck until App Store Connect Support reset it.

So no one ever installs from the store before the Unlock, and nothing checks
when the app was first installed. TestFlight testers pay nothing in any case.
Had a free version been released first, the check would have had these
constraints, kept here in case that changes:

- **The value is the build number.** `AppTransaction.originalAppVersion` "contains
  the original value of the CFBundleShortVersionString for apps running in
  macOS, and the original value of the CFBundleVersion for apps running on all
  other platforms. In the sandbox testing environment, the originalAppVersion
  value is always `1.0`." On iOS that is the build number in brackets in
  `APP_VERSION`, by way of `app.config.ts`.
- **It runs only when `AppTransaction.environment` is `.production`.** App
  Review also got "1.0" in thread 823953. That app's sandbox check went by the
  receipt's file name, which was `receipt` in review rather than
  `sandboxReceipt`, so it unlocked the reviewer and was rejected.
- **Compare as integers.** Apple's sample compares the strings with `<`, and
  "10" < "8" as text.
- **`AppTransaction.shared` can fail.** It "throws an error if the
  AppTransaction isn't available or if the user isn't authenticated with the
  App Store. Getting an AppTransaction may require network connectivity." It
  needs a defined fallback.
- **It cannot be tested end to end before release.** Every non-production
  environment returns "1.0".

## Related

- ADR 0002 and ADR 0017 each gain a section dated 2026-10-09 pointing here.
- Issue #149: contributor terms. The App Store copy is safe under AGPL-3.0
  only while every commit is the author's. As of 2026-10-09, `git log` shows
  one author for all 619 commits.
