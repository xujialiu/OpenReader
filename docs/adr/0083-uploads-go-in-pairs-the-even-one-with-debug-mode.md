---
status: superseded by ADR-0086
---

# Uploads go in pairs, and the even one has Debug Mode

[ADR 0086](0086-three-copies-for-three-recipients.md) replaces this pair,
parity and offset policy with three role-bound copies. This document retains
the earlier decision and its measured facts; it is not the current upload
rule. The three-copy implementation remains pending under #324.

_Issue #310. The owner's decisions of 2026-10-21 are in its body. The terms are
CONTEXT.md's **Build Number**, **Beta** and **Debug Mode**. This replaces
[ADR 0070](0070-the-version-line-names-the-upload-it-leads-to.md)'s rule that
each upload takes the next number, and keeps the rest of it. The steps are in
`docs/release-to-app-store.md`; the rule an agent follows after an app change is
in `MEMORY/app-change.md`. The App Store Connect readings are in
`notes/NOTES_2026-10-21.md`._

A build with Debug Mode (ADR 0054) reached the owner's iPhone only by cable from
the Mac, and the release guide forbade uploading one. Away from the Mac, the
only update was a TestFlight build without Debug Mode, and installing it
deleted the Debug Log the phone held (ADR 0082) and stopped the log until the
next cable install.

## The rule

- **Every upload is a pair from one commit.** The odd Build Number is the build
  without Debug Mode, for testers and App Review. The even number after it is
  the same code with Debug Mode, for the owner's phone. The first pair is
  1.0.0 (9) and 1.0.0 (10)-debug.
- **`APP_VERSION` holds the odd number.** A build with Debug Mode, uploaded or
  installed by cable, names the even number after it: `buildVersion` in
  `src/debug/mode.ts` raises the bracketed number by one, and `shownVersion`
  adds `-debug`. So `1.0.0 (9)` shows `1.0.0 (10)-debug`, and the next change,
  `1.0.0 (11)-beta1`, shows `1.0.0 (12)-beta1-debug` on the phone and in the
  simulator. The Debug Log's launch line and its `version.txt` use the same
  number.
- **`app.config.ts` refuses an even `n`**, and writes `n + 1` as
  `CFBundleVersion` when the prebuild runs with
  `EXPO_PUBLIC_OPENREADER_DEBUG_MODE=1`, exactly `1`, the same test as
  `DEBUG_MODE`.
- **The first change after a pair raises `n` by two.** A pair re-uploaded with
  nothing changed does the same.
- **One annotated tag per pair**, named by the higher number, `1.0.0(10)`, on
  the commit both builds came from. Its message names both builds.
- **The Debug Mode build goes to the internal group only.** Its TestFlight
  "What to Test" says so. The owner alone adds a build to the external group or
  submits one for review.

## Why the Debug Mode build takes the higher number

The owner's Apple account is a tester in both groups: the internal `owner`
group, which gets every build, and the external `public` group, which gets a
build when the owner adds it. TestFlight offers a tester the newest build of
every group the tester is in. With the Debug Mode build on the odd number, the
build without it would be the newer one as soon as it reached `public`, and
TestFlight would offer to replace the phone's Debug Mode build with it, which
deletes the Debug Log. On the higher number, the Debug Mode build stays the
newest on the owner's phone, and neither group needs changing.

## Why the prebuild decides the native number

Expo writes `CFBundleVersion` into `Info.plist` as a literal when it prebuilds:
`@expo/config-plugins` 57's `ios/Version.js` sets it to `ios.buildNumber`, and
the generated `Info.plist` holds `<string>9</string>`, not a build setting. So
an `xcodebuild` setting cannot give the second archive a different number; the
second archive needs its own prebuild. The guide already starts every archive
from `npx expo prebuild --platform ios --clean`, so the Debug Mode one runs it
with the switch, and its archive is checked for both `DEBUG_MODE = true` in the
bundle and the even number in `Info.plist`. One switch, passed to both
commands, decides both.

A build installed by cable or from Metro is not prebuilt for each change (ADR
0070), so its native number can lag behind what Settings shows; the launch
line's `native` pair shows it, as before.

## Why one commit and one literal

- **The two builds are the same code.** One commit, two archives, with only
  Debug Mode's switch between them, so a fault seen in the Debug Mode build is a
  fault of the build testers and App Review get.
- **`APP_VERSION` stays one literal in git**, the odd number. Every other number
  is derived from it and tested: `test/app-config.test.ts` prebuilds both ways,
  `test/debug/mode.test.ts` holds `buildVersion` and `shownVersion`.
- **One tag names both.** The tag carries the higher number because that is the
  last upload of the pair; its message names the odd one.

## Turned down

- **The Debug Mode build on the odd number** (the owner's first proposal,
  1.0.0 (9)-debug and 1.0.0 (10)). TestFlight would replace it on the owner's
  phone with the newer build without Debug Mode, as above. Keeping it would have
  meant taking the owner's account out of `public` and giving `owner` only odd
  builds, so the owner could no longer install what testers get, or turning off
  TestFlight's updates and choosing a build by hand each time.
- **Two commits per pair**, each with its own literal. No code change, but the
  two builds would not provably be the same code, and one tag would not name
  both.
- **`APP_VERSION` holding the even number**, with the build without Debug Mode
  one lower. It would have left the Debug Mode line exactly `APP_VERSION` plus
  `-debug`, and only the archive without Debug Mode derived. The owner chose the
  odd number.
- **Only one Debug Mode upload, with no rule.** The owner's phone is away from
  the Mac often; without a rule, each such upload would be argued again.

## Not verified here

- Whether `devicectl device copy from --domain-type appDataContainer`, which
  `test/manual-test/kit/debug-log.py` uses, can copy a TestFlight build's
  container. Apple's forum answers suggest container access needs a build signed
  for development, which a TestFlight build is not; if so, the Debug Log of a
  TestFlight install can be read only through the system log (`debug-log.py
  --syslog`), and the walkthrough harness cannot be driven on it.
- How TestFlight chooses the build it offers when two are uploaded minutes apart
  in the order odd, then even. The rule relies on the even one being both the
  higher number and the later upload.

## Historical pair procedure

These commands are retained from the superseded release guide as historical
evidence, including its exact archive/export checks and measured caveats.
They use the old Debug offset and keep purchases in both copies. **They are
not valid for ADR 0086's three-copy set.** Follow the current
[release entry guide](../release-to-app-store.md) and its readiness gate.

1. **Preflight**
   - Run `git fetch` and `git status`. The tree is clean and `git rev-parse HEAD` equals `git rev-parse origin/main`.
   - Run `npm ci`.
   - Run the unit tests, `npx tsc --noEmit` and `npx eslint .`.
   - Check for other heavy Xcode builds (`pgrep -fl xcodebuild`). A build in the same workspace at the same time needs its own `-derivedDataPath`, because two builds cannot share one DerivedData.
2. **Version and build number**, as a commit that reaches `main` through the usual merge:
   - Set `APP_VERSION` in `app-version.ts` to `X.Y.Z (N)`: drop the `-betaN`. `N` must be one more than the last uploaded build (the highest `X.Y.Z(N)` tag), and odd. It is already, unless nothing has changed since that pair; then raise it by two.
   - Only if the owner named a new Version: `npm version <X.Y.Z> --no-git-tag-version`, so that `package.json` and the lockfile match.
   - `npx vitest run test/app-config.test.ts` checks that `APP_VERSION`, `app.config.ts` and `package.json` agree, and that `N` is odd.

Steps 3 to 5 make and upload the build without Debug Mode, `N`. Step 6 makes
and uploads the build with Debug Mode, `N + 1`, from the same commit.

3. **Prebuild:** `npx expo prebuild --platform ios --clean`, then check that `node_modules/expo-sqlite/ios/sqlite3.h` exists.
4. **Archive**, without `EXPO_PUBLIC_OPENREADER_DEBUG_MODE` or `EXPO_PUBLIC_OPENREADER_UNLOCKED` anywhere: not on the command line, not in the shell, not in `.env*`, and not in `ios/.xcode.env.local`. The first would ship Debug Mode; the second would ship the app with no Trial and no Unlock (ADR 0075).

   ```bash
   xcodebuild -workspace ios/OpenReader.xcworkspace -scheme OpenReader \
     -configuration Release -destination 'generic/platform=iOS' \
     -archivePath "$HOME/Library/Developer/Xcode/Archives/$(date +%F)/OpenReader X.Y.Z (N).xcarchive" \
     -allowProvisioningUpdates ENABLE_USER_SCRIPT_SANDBOXING=NO \
     CLANG_MODULE_CACHE_PATH=/tmp/openreader-module-cache-release \
     -quiet archive
   ```

   - Success is exit code 0. Expect a few minutes.
   - The log's lines `error: the following command failed with exit code 0 but produced no further output` do not fail the build.
   - Check the archive's `Products/Applications/OpenReader.app/Info.plist`:
     - the version and build are the intended ones;
     - `ITSAppUsesNonExemptEncryption` is false;
     - `UIDeviceFamily` is `[1, 2]` (#319);
     - `UIRequiresFullScreen` is false; the base orientations remain portrait and upside-down portrait, and `UISupportedInterfaceOrientations~ipad` includes both landscape orientations too;
     - `NSMicrophoneUsageDescription` is present;
     - `UIBackgroundModes` is `[audio]`.
   - Check the JavaScript bundle the archive used:

     ```bash
     grep -o 'var DEBUG_MODE = [a-z]*;' \
       ~/Library/Developer/Xcode/DerivedData/OpenReader-*/Build/Intermediates.noindex/ArchiveIntermediates/OpenReader/BuildProductsPath/Release-iphoneos/main.jsbundle
     ```

     It must print `false`. Take the newest file if there are several. In the same file,

     ```bash
     grep -o 'var PURCHASE_LOCK = [a-z]*;' \
       ~/Library/Developer/Xcode/DerivedData/OpenReader-*/Build/Intermediates.noindex/ArchiveIntermediates/OpenReader/BuildProductsPath/Release-iphoneos/main.jsbundle
     ```

     must print `true`: the build sells read-aloud. `false` means `EXPO_PUBLIC_OPENREADER_UNLOCKED=1` reached the bundle; find where, and archive again (notes 2026-10-09 15:22).
   - The archive is signed for development. The export re-signs it.
5. **Export and upload.** `ExportOptions.plist`:

   ```xml
   <dict>
     <key>method</key><string>app-store-connect</string>
     <key>destination</key><string>upload</string>
     <key>teamID</key><string>UPR29WR8FC</string>
     <key>signingStyle</key><string>automatic</string>
     <key>uploadSymbols</key><true/>
     <key>manageAppVersionAndBuildNumber</key><false/>
   </dict>
   ```

   ```bash
   xcodebuild -exportArchive -archivePath "<archive>" \
     -exportOptionsPlist ExportOptions.plist -exportPath "<out dir>" \
     -allowProvisioningUpdates
   ```

   - It ends with `Upload succeeded` and `** EXPORT SUCCEEDED **`. Expect a few minutes, the upload included.
   - Warnings about missing dSYMs are expected, and they fail nothing. They name React, ReactNativeDependencies, hermesvm, libavcodec, libavformat, libavutil and libswresample: prebuilt frameworks that ship no dSYMs.
   - `App record with bundle identifier … not found` means no App Store Connect record uses this bundle ID.
6. **The build with Debug Mode**, `N + 1`, from the same commit, after build `N`'s export has succeeded. Steps 3 to 5 again, with these differences:
   - Prebuild with the switch on the command line: `EXPO_PUBLIC_OPENREADER_DEBUG_MODE=1 npx expo prebuild --platform ios --clean`. Expo writes `CFBundleVersion` into `Info.plist` at prebuild, so this is what gives the archive `N + 1`; nothing passed to `xcodebuild` can.
   - Archive with `EXPO_PUBLIC_OPENREADER_DEBUG_MODE=1` on the `xcodebuild` command line, beside `ENABLE_USER_SCRIPT_SANDBOXING=NO`, and with the archive named `OpenReader X.Y.Z (N+1)-debug.xcarchive`. Still not in the shell, `.env*` or `ios/.xcode.env.local`, and still no `EXPO_PUBLIC_OPENREADER_UNLOCKED`.
   - Check `Info.plist` as before, but with the build `N + 1`. In the bundle, `var DEBUG_MODE = true;` and `var PURCHASE_LOCK = true;`. Check the bundle straight after this archive: it replaces the first archive's in the same DerivedData folder.
   - Export with the same `ExportOptions.plist`.
7. **Processing.** App Store Connect → the app → TestFlight → Build Uploads shows Processing, then Complete, within about 10 to 25 minutes. Apple emails any ITMS problem. Then, on build `N + 1` (TestFlight → the build → Test Details), set "What to Test" to:

   ```text
   Debug Mode build for the owner's phone only. Never add it to an external group, and never submit it for review.
   ```

   The localization API's scope/HTTP 405 caveat is retained in
   [App Store Connect API access](../app-store-connect.md#testflight-and-api-access).

8. **Tag**, on the pair's commit:
   - `git tag -a "X.Y.Z(N+1)" -m "OpenReader X.Y.Z (N) and X.Y.Z (N+1)-debug, uploaded YYYY-MM-DD"`, such as `1.0.0(10)`.
   - Ask the owner before `git push origin main --tags`.
