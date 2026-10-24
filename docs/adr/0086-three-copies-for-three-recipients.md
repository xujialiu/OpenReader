---
status: accepted
---

# Three role-bound copies replace paired uploads

The owner chose this on #324. The product argument is
[design 0086](../design/0086-three-copies-for-three-recipients.md). This ADR
holds the planned identities; [versions.md](../versions.md) is a table-only
ledger of confirmed uploads. Keep only an empty table template there until
an upload is confirmed; no plans, failed attempts or policy prose belong in
that file.
This supersedes ADR 0083's pair, odd/even and Debug-offset rules, and ADR
0075's use of the same purchasing binary for public testers and App Review.
The App Store copy's Trial, Unlock and purchase-source isolation remain.

The source implementation and host bundle/autolinking checks are in place;
**compiled-native and simulator acceptance are pending**. The release guide
keeps uploads blocked until those checks pass. No App Store Connect group
change or upload is implied.

## One Upload Set, three roles

An explicit upload request prepares three artifacts from one commit, in this
order. `APP_VERSION` holds the formal copy's base Build Number `N`; all copies
use its Version. Parity has no meaning.

| Role | Build Number | App purchases | Debug Mode | Settings role suffix | Distribution |
| --- | --- | --- | --- | --- | --- |
| Formal | `N` | Trial and Unlock | Off | None | App Review and App Store, by owner decision |
| Free test | `N + 1` | No purchase capability | Off | `-free` | Public TestFlight testing, by owner decision |
| Debug | `N + 2` | No purchase capability | On | `-debug` | Internal `owner` only; local install also allowed |

The owner explicitly chose this next set, which has not been uploaded by
this work:

| Planned Apple Version (Build Number) | Role |
| --- | --- |
| `1.0.2 (13)` | Formal |
| `1.0.2 (14)` | Free test |
| `1.0.2 (15)` | Debug |

These are plans in this ADR, not entries in the upload ledger. After a
complete set, the next base advances by three; Build Numbers rise across
Versions and are never reused.
The first app change after a complete set starts Beta 1 at that next base;
later app changes advance the Beta. Uploaded artifacts have no Beta. The
owner alone changes the Version. Role suffixes are not part of
`CFBundleShortVersionString` or `CFBundleVersion`.

Keep the existing one-annotated-tag-per-set convention, named by the highest
number on the common source commit, with all three identities in its message.
A partial set is not tagged as complete. Pushes still require owner approval.

## No purchase capability in the two free copies

The free and Debug copies expose all features without Trial or Unlock. They
exclude the project's native purchase module and transaction listener, the
purchase UI/routes, and Debug's simulated/real-store purchase controls. They
do not use or write purchase authorization records to grant free access.
Purchase testing uses an App Store-variant test configuration instead.

`EXPO_PUBLIC_OPENREADER_UNLOCKED=1` alone is insufficient: inspection at
`8f76fe7` found that `src/app/purchase-setup.ts` statically imports the StoreKit
adapter, and `modules/open-reader-store/expo-module.config.json` registers the
native module unconditionally. Its Swift `OnCreate` starts a transaction
listener. The existing switch bypasses the controller and hides Purchase;
it does not establish the native module's absence. Verification must inspect
the actual free/Debug artifacts, not merely the requested switches.

All copies retain `top.xujialiu.openreader` and replace one another. Preserve
Documents, settings, credentials, Reading Positions, Offline Narration and
legitimate purchase records. A free copy does not manufacture an Unlock, and
returning to the formal copy applies its real purchase rules. Do not delete
Apple's products or revoke purchases. The source-bound record and the legacy
buyer-protection exception in ADR 0075 remain the formal copy's responsibility.

## Routing and completion

The desired internal `owner` group receives Debug copies by default, not all
uploads. This protects the author's installation while the lower-numbered
formal and free copies upload first. Other copies are selected explicitly for
the author's testing. Verify and record the real group configuration before
an upload; this document does not claim the change has already been applied.

Public testing, App Review submission and App Store release remain separate
owner decisions. TestFlight's What to Test names each role and allowed use;
never choose the highest/newest upload as the App Store candidate. App
Review here means review of an App Store version; the free copy may separately
undergo TestFlight Beta App Review before public testing. That does not make
it eligible for App Store submission. Debug remains internal-only.

On a partial failure, stop, retain every attempted identity and actual state
in the run notes and owner receipt, and ask the owner whether to retry or
rebuild. Add only copies whose upload Apple has confirmed to the ledger;
failed or unuploaded attempts never get ledger rows. Do not renumber, change
roles or submit a partial set automatically. After every upload attempt,
the release guide requires an explicit owner-facing table and a statement
naming the sole formal candidate and the two copies never to submit. Ledger
updates alone do not satisfy that receipt.

## As implemented

`build-variant.ts` derives the complete identity; native configuration and
Metro use the same selector. Canonical `EXPO_PUBLIC_OPENREADER_VARIANT` accepts
formal/free/debug; old DEBUG_MODE=1 and UNLOCKED=1 commands select complete
Debug/free roles for compatibility. Missing switches default to formal and
conflicting selections fail. Xcode/Metro development optimization does not
choose a role.

`with-release-variant.ts` passes the local package name `open-reader-store`
to SDK 57's supported `use_expo_modules!` exclusion, affecting both Pods and
the generated provider. Only formal adds the local StoreKit test configuration.
Metro substitutes static identity modules and no-purchase startup/API/UI
seams before traversing the graph, and rejects other purchase imports in the
two free roles. The shell has no store command. Free access is `off`, never
a synthetic `unlocked` purchase; unsupported purchase actions answer false.

Info.plist records the role, exposed by the existing diagnostic native module.
Startup compares it to Metro's static role before running the app. The build
verifiers check actual bytecode/source inventories and native Mach-O contents,
including framework symlinks. They do not upload or read app data containers.
Use [the current verification recipe](../../test/manual-test/purchase/release-variants.md)
for scope and limits. SDK 57 prebuild recreates native folders by default;
`--no-clean` opts out, while the old `--clean` flag is not supported.

## Trade-off and policy boundary

Keeping one purchasing binary would also test the store experience, and
TestFlight purchases cost nothing. The owner instead chooses friction-free
feature testing and accepts that purchases need separate formal-variant
verification. The three artifacts are related by source, not byte-identical.

Apple's [DPLA section 7.4](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/)
limits external TestFlight distribution to testing/evaluation and prohibits
continuous demo distribution intended to circumvent the App Store. It does
not literally prohibit every separately unlocked testing binary; the genuine
testing purpose matters. The [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)
states that builds become unavailable after 90 days. The owner accepted a
free testing copy, not a promise of permanent stable free distribution.
Provider credentials and usage charges remain the user's own.
