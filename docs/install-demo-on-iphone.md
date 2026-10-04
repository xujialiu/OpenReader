# Install a Demo App on the owner's iPhone

A **Demo App** (CONTEXT.md) is a second OpenReader on the owner's iPhone,
installed beside his own and starting empty, so that a recording for App Review
shows a fresh app without touching his documents, settings or keys. Signing,
provisioning and the Release build itself are as in
[install-on-iphone.md](install-on-iphone.md); this guide covers only what is
different.

## When it was needed

On 2026-10-04 App Review answered the 1.0.0 submission with **Guideline 2.1 -
Information Needed - New App Submission**, because the account "has a limited
App Review history". Its first item: "A screen recording captured on a physical
device, running the latest operating system, demonstrating the app's
functionality. The recording must begin with launching the app and show the
typical user flow." The other five items (purpose and audience, setup
instructions and sample files, external services, regional differences,
regulated or protected material) are text; the state is in
[release-to-app-store.md](release-to-app-store.md).

## The owner's decisions (2026-10-04)

- **Another bundle identifier**, `top.xujialiu.openreader.demo`, installed beside
  the owner's app. Not the same identifier with his data backed up and restored,
  and not a simulator: Apple asked for a physical device.
- **The Home Screen name stays `OpenReader`**, the same as the owner's app, so
  the recording opens on what the App Store will show. The two are told apart by
  Settings alone (below).
- **The version line ends in `-demo`**: `1.0.0 (5)-beta5-demo`.
- **No Debug Mode**: the Demo App behaves as a released build does, and no
  `-debug` appears in the recording.
- **The code**: the owner named it, `1.0.0 (5)-beta5` (`main` at `c12ff21`). It
  is not necessarily the build App Review is looking at; the newest upload was
  then 1.0.0 (4).
- **Built in a throwaway sub-worktree.** The two edits below are never
  committed to `main`, so `main` and its Beta do not move and no `ios-tester`
  run is owed (MEMORY/app-change.md).
- **Removed after Apple accepts the recording**, not straight after it, in case
  Apple asks for another: the Demo App from the phone, its App ID from the
  developer account, and the sub-worktree.
- The recording itself, the key and the book used in it, and the reply to Apple
  are the owner's.

## Why another identifier keeps the owner's app untouched

iOS keeps per app identifier everything the owner would not want touched:

- **The app's container**: the Library, the documents, the settings, the
  downloaded speech and the Debug Log.
- **The Keychain**, where the providers' API keys are (ADR 0002). The generated
  `ios/OpenReader/OpenReader.entitlements` is an empty dictionary, so the app
  has no shared access group: its items are in the default group,
  `UPR29WR8FC.<bundle identifier>`, which the other app cannot read.

With the same identifier there is no isolation. Installing over the owner's app
keeps his Library, and the recording would show it; uninstalling first deletes
it. A container backup does not reach the Keychain.

Nothing else is shared: there is no App Group and no iCloud container. **WebDAV
sync is the one way out**: do not give the Demo App the owner's WebDAV folder,
or it would exchange Reading Positions with his own devices.

## Why the identifier changes at prebuild

Do not override `PRODUCT_BUNDLE_IDENTIFIER` on the `xcodebuild` command line
instead. Downloads run under a continued processing task whose identifier comes
from the bundle identifier twice:

- `plugins/with-continued-processing.ts` writes
  `BGTaskSchedulerPermittedIdentifiers = [<ios.bundleIdentifier>.download.*]`
  into Info.plist at prebuild.
- `OpenReaderOfflineModule.swift` asks, at run time, for
  `<Bundle.main.bundleIdentifier>.download.<UUID>`.

An override at build time changes only the second, so the Demo App would ask
for an identifier its Info.plist does not permit. This is read from the code,
not measured.

Change `ios.bundleIdentifier` only, not `name`: `name` is `APP_NAME`, which the
Home Screen shows and which the generated Xcode project is named after.

## Steps

From the main checkout, with the owner's iPhone reachable (`IPHONE_UDID`, as in
install-on-iphone.md):

1. **Sub-worktree** (AGENTS.md, "Sub-worktrees"), from the commit the owner
   named:

   ```bash
   git worktree add -b main--demo .worktrees/demo <commit>
   cd .worktrees/demo && npm ci
   ```

2. **Two edits, never committed**:
   - `app.config.ts`: `bundleIdentifier: 'top.xujialiu.openreader.demo',`
   - `src/debug/mode.ts`, `shownVersion`:
     ``return `${debugMode ? `${version}-debug` : version}-demo`;``

   `APP_VERSION` stays as it is: `app.config.ts` stops the prebuild on any line
   that is not `x.y.z (n)` or `x.y.z (n)-betaN`.
3. **Prebuild**: `npx expo prebuild --platform ios`. Check that the project's
   `PRODUCT_BUNDLE_IDENTIFIER` is the demo one, that Info.plist's
   `BGTaskSchedulerPermittedIdentifiers` is
   `top.xujialiu.openreader.demo.download.*` and its `CFBundleDisplayName`
   `OpenReader`, that the entitlements file is still empty, and that
   `node_modules/expo-sqlite/ios/sqlite3.h` exists.
4. **Build** without `EXPO_PUBLIC_OPENREADER_DEBUG_MODE` anywhere (shell,
   `.env*`, `ios/.xcode.env.local`), with its own DerivedData and module cache,
   so that it neither waits on nor disturbs a build of the owner's app:

   ```bash
   xcodebuild -workspace ios/OpenReader.xcworkspace -scheme OpenReader \
     -configuration Release -destination 'id=IPHONE_UDID' \
     -derivedDataPath /tmp/openreader-demo-derived-YYYYMMDD \
     -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
     ENABLE_USER_SCRIPT_SANDBOXING=NO \
     CLANG_MODULE_CACHE_PATH=/tmp/openreader-iphone-module-cache-demo-YYYYMMDD \
     -quiet build
   ```

   `-allowProvisioningUpdates` lets Xcode make the signing profile. The app
   has no capabilities, so on 2026-10-04 Xcode signed it with a new wildcard
   profile, `iOS Team Provisioning Profile: *`, rather than one for an explicit
   App ID.
5. **Check** the product, `/tmp/openreader-demo-derived-YYYYMMDD/Build/Products/Release-iphoneos/`:
   `main.jsbundle` beside the app reads `var DEBUG_MODE = false;` and holds the
   `-demo` template; `codesign -d --entitlements :- OpenReader.app` shows
   `application-identifier` `UPR29WR8FC.top.xujialiu.openreader.demo`.
6. **Install and launch**:

   ```bash
   xcrun devicectl device install app --device IPHONE_UDID \
     /tmp/openreader-demo-derived-YYYYMMDD/Build/Products/Release-iphoneos/OpenReader.app
   xcrun devicectl device process launch --device IPHONE_UDID top.xujialiu.openreader.demo
   ```

   Then confirm both apps are installed:
   `xcrun devicectl device info apps --device IPHONE_UDID | rg top.xujialiu.openreader`.

## Telling the two apart

Both are called OpenReader and have the same icon. The Demo App is the one
installed last: iOS puts it on the first free place on the Home Screen, or only
in the App Library if the phone is set to keep new apps there. Only Settings
tells them apart for certain: the Demo App's line ends in `-demo`, and
the owner's in `-debug`. Check it before recording, and open the Demo App from
the place it was checked in.

## Removing it

After Apple accepts the recording:

1. `xcrun devicectl device uninstall app --device IPHONE_UDID top.xujialiu.openreader.demo`.
   This removes the Demo App's container only. Never pass the owner's
   identifier.
2. The owner checks developer.apple.com → Certificates, Identifiers & Profiles
   → Identifiers for `top.xujialiu.openreader.demo`, and removes it if it is
   there. On 2026-10-04 Xcode signed with the wildcard profile (step 4), so
   none may have been registered. The wildcard profile is the team's and can
   stay.
3. `git worktree remove --force .worktrees/demo` (it holds the two uncommitted
   edits) and `git branch -D main--demo`.

## Runs

- **2026-10-04**, `1.0.0 (5)-beta5-demo` from `c12ff21` (notes 2026-10-04
  11:30). `npm ci` 8 s; prebuild 0, with Pods; Release build 0 in 215 s from
  an empty DerivedData. Its three
  `error: the following command failed with exit code 0 but produced no further output`
  lines failed nothing. The bundle read `var DEBUG_MODE = false;` and held the
  `-demo` line; signed `UPR29WR8FC.top.xujialiu.openreader.demo` with the
  wildcard profile, expiring 2027-10-04. Install returned 0 and both apps were
  then listed. Launch returned 1 because the phone was locked
  (`BSErrorCodeDescription = Locked`); opening it was left to the owner.
