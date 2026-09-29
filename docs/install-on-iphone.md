# Install OpenReader on an iPhone

Use this guide to install a Release build on your own iPhone from a local Mac so
that it can run without being connected to the computer.
These steps are based on an actual installation performed on 2026-09-20. The
project includes custom native modules, so it requires a native app build and
cannot use Expo Go as a substitute.

## Results verified in this run

- Environment: Expo SDK 57, Xcode 27.0 (27A266); the project's minimum iOS version is 17.2.
- Physical device: `Xujia’s iPhone`, written `IPHONE_UDID` in the commands below.
- Workspace: `ios/OpenReader.xcworkspace`; scheme: `OpenReader`.
- Bundle ID: `top.xujialiu.openreader`.
- Automatic signing used `Xujia Liu (Personal Team)`, with an Apple Development certificate.
- The `xcodebuild` command below returned 0; `devicectl` confirmed that the app was installed.
- Automatic launch returned a Security error containing “profile has not been explicitly trusted by the user”. The user was prompted to trust the developer on the phone; this record does not confirm launch, reading, or audio functionality after trust was granted.
- 2026-09-22 follow-up: on the same phone and account, a fresh Release build, install,
  and `devicectl device process launch` all succeeded, and the launch returned no
  Security/trust error — the developer trust granted earlier persisted across this
  reinstall. This run only confirms the command-line launch; it does not confirm
  on-screen behavior, reading, or audio, since it was not visually inspected on the
  device. It also used a different DerivedData path than the one recorded above
  (the hash in the path changes per checkout, as this guide already notes), so that
  recorded path is not reusable as-is.
- Later on 2026-09-22, the `0.0.2-beta5` Release build succeeded after the native dependency recovery below, and installation returned `App installed`. Launch then failed with `CoreDeviceError 10002` / `Security`. Local signature and profile checks passed, but device trust and successful launch remain unconfirmed. The earlier successful launch does not establish that this later installation can launch.

- On 2026-09-26, with no cable connected, the paired iPhone was discovered wirelessly. The current checkout's `0.0.2-beta32` Release build returned 0 after dependency recovery; `devicectl` then confirmed installation and launch. Screen behavior, reading and playback were not tested. This establishes wireless installation for this already-paired phone, not first-time wireless pairing.

- On 2026-09-27, `0.0.2-beta39` built and installed successfully after restoring the missing generated SQLite header with `pod install` and using `/tmp/openreader-iphone-module-cache-20260927-restored`. Automatic launch returned `CoreDeviceError 10002` / `Security`. Local signature verification passed; the profile expires at `2026-10-04 03:43:34 UTC`, includes the phone, and matches the signed application and team identifiers. The owner subsequently confirmed developer trust and that the app opens on the phone. Reading and playback were not tested in this installation run.

The device, account, and paths above are specific to this run. Look them up again
when changing computers or phones. If the user has since trusted the developer
and launched the app successfully, update the verification results.

## Initial setup

1. Connect the iPhone to the Mac with a cable, unlock it, and choose “Trust This Computer”. On the phone, open “Settings → Privacy & Security → Developer Mode”, enable Developer Mode, and complete the restart and confirmation requested by the phone.
2. In Xcode, open Settings → Accounts and sign in with the Apple ID. Select the account, then use Manage Certificates → ＋ → Apple Development to create a certificate. Skip this if a valid certificate already exists.
3. Open the workspace from the repository root:

   ```bash
   open ios/OpenReader.xcworkspace
   ```

4. Press ⌘1 to show the project navigator, then click the blue OpenReader project on the far left. The narrow middle column contains PROJECT and TARGETS. Click **OpenReader under TARGETS**. The PROJECT entry and Pods are not the app's signing settings.
5. In the right pane, open Signing & Capabilities → All, enable Automatically manage signing, and choose your team under Team. Select the physical device `Xujia’s iPhone` in the run destination at the top, rather than a simulator such as iPhone 18 Pro.

The repository's `ios/` directory is generated. If it does not exist, install the
project dependencies and run `npx expo prebuild --platform ios` first, then open
the workspace. After regenerating the native directory, review the signing team
again. There is no need to delete or clean the native directory for routine
installation.

## Subsequent installation: check, build, install, and launch

Run the following commands from the repository root. Keep the phone connected and
unlocked. A cable is not required when the previously paired phone is reachable
wirelessly: check `devicectl` before asking the owner to connect one.

### 1. Confirm the device and certificate

```bash
xcrun devicectl list devices
security find-identity -v -p codesigning
xcodebuild -version
```

You should see the physical iPhone and at least one valid Apple Development
identity. `0 valid identities found` means that signing in to the account alone
was not enough; create a certificate in Xcode. The device list also includes
simulators; the physical iPhone's UDID is `IPHONE_UDID` in the commands below.

### Before spending time on a native build

1. Check installed dependencies against the current checkout, for example with `npm ls --depth=0 --omit=dev`, and investigate missing or invalid runtime packages before building. A package's presence in the manifest and lockfile does not establish that it exists in `node_modules`. On 2026-09-26, missing `react-native-teleport` was discovered only at the late JavaScript bundling stage.
2. If a missing package has native code, restore it and run `pod install` in `ios/` **before** the Release build. Teleport needs this registration. Also check that `node_modules/expo-sqlite/ios/sqlite3.h` exists: Pods generates it, and a passing `npm ls` does not check it. On 2026-09-27 it was absent; Pods restoration followed by a fresh module cache made the failing SQLite Swift compiler command pass. Avoid reinstalling Pods or clearing build products on every routine installation: dependency regeneration can trigger broad recompilation.
3. Reuse this checkout's successful isolated module cache. The 2026-09-27 build passed with `CLANG_MODULE_CACHE_PATH=/tmp/openreader-iphone-module-cache-20260927-restored`; include that setting in the build command below while that cache remains available. The default shared cache reproduced the already documented ExpoSQLite failure. Create a new isolated cache only when necessary, and keep using the same one for retries.
4. Check for other active Xcode builds before starting an expensive rebuild. Another simulator build was running during this installation. Coordinate heavy builds where possible; do not stop someone else's build. Concurrent compilation can compete for resources, but its individual contribution to this run's delay was not measured.
5. Capture build output outside the repository, wait for the build's final exit code, and keep build, transfer and launch results separate. A quiet log is not evidence of a hang; check whether compiler processes are active before restarting. Do not present a library's link step as completion of the whole app.

### 2. Build a standalone Release version

This is the command that succeeded for this project during the recorded run,
with the Debug Mode switch added on 2026-09-29 (#82):

```bash
xcodebuild \
  -workspace ios/OpenReader.xcworkspace \
  -scheme OpenReader \
  -configuration Release \
  -destination 'id=IPHONE_UDID' \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  ENABLE_USER_SCRIPT_SANDBOXING=NO \
  EXPO_PUBLIC_OPENREADER_DEBUG_MODE=1 \
  -quiet build
```

The first build compiles native dependencies and takes significantly longer than
later incremental builds. Use exit code 0 as the success criterion; do not use
warnings in the log or the presence of an `.app` directory as the criterion.

- `-allowProvisioningUpdates`: allows Xcode to create or update signing profiles using the logged-in account.
- `-allowProvisioningDeviceRegistration`: allows automatic signing to register the target device.
- `ENABLE_USER_SCRIPT_SANDBOXING=NO`: the Xcode build setting required by this build so that the React Native bundling script can read the project and write the JavaScript bundle. It applies only to this command and does not modify the project configuration.
- `EXPO_PUBLIC_OPENREADER_DEBUG_MODE=1`: Debug Mode ([ADR 0054](adr/0054-debug-mode-is-fixed-when-the-app-is-built.md)), always set for the owner's phone, so that a fault met away from the Mac leaves a Debug Log on the phone to be read back afterwards. Settings then shows the version ending in `-debug`. The Debug Log is in the app's container at `Library/Application Support/debug-log/`; copy it off with `python3 test/manual-test/kit/debug-log.py IPHONE_UDID OUT_DIR` (`test/manual-test/kit/README.md`, "Pull the Debug Log off the phone").
- Release bundles the JavaScript and resources into the app, so Metro and a computer connection are not required at runtime. Online speech services and other features still require a network connection.

**A build without Debug Mode**, which is what a release is: the same command
without the `EXPO_PUBLIC_OPENREADER_DEBUG_MODE=1` line. Its Settings shows the
version with no `-debug`, and it keeps no Debug Log, never reads the
walkthrough harness's `Documents/harness.json`, and its reading page cannot be
opened in Safari's Web Inspector. Debug Mode is decided when the JavaScript is
bundled during the build and cannot be switched on afterwards.

Where the switch's value could go stale:

- **Metro's cache: guarded.** `metro.config.js` puts every `EXPO_PUBLIC_` value
  in Metro's cache key, so a build without the switch right after one with it
  (or the reverse) never reuses the other's cached answer. Measured on
  2026-09-29 (ADR 0054): three Release builds in a row, without, with and
  without again, came out off, on, off; and with the cache kept (`CI=1`, under
  which Expo skips the phase's cache reset), a build without the switch right
  after one with it came out on without that file and off with it. The two
  kinds can be built one after the other, in either order, with no clean.
- **The shell, `ios/.xcode.env.local` and `.env` files: not guarded.** The
  bundling phase inherits the shell's environment and sources
  `ios/.xcode.env.local`, and Expo loads `.env`, `.env.local`, `.env.production`
  and `.env.production.local` from the repository root when it bundles. A
  `EXPO_PUBLIC_OPENREADER_DEBUG_MODE=1` in any of them makes every build, a
  release included, one with Debug Mode. Pass the switch on the command line
  only, as above.
- **To check a build**, read the plain bundle the phase leaves beside the app:
  `grep -o 'var DEBUG_MODE = [a-z]*;' TARGET_BUILD_DIR/main.jsbundle` (the
  directory from step 3) prints `true` for a build with Debug Mode and `false`
  for one without. The copy inside the app is Hermes bytecode.

**Once after pulling #82**, run `pod install` in `ios/` (or a prebuild): the
Debug Log's system-log line is a new local native module, and an `ios/` from
before it builds without it. Such a build still starts and still writes the
Debug Log, and its first line says `system log missing (no native module)`.

### 3. Find and install the build product

The build product from this run was at:

```text
/Users/xujialiu/Library/Developer/Xcode/DerivedData/OpenReader-buxlmytdygazkfacxjuwdxvtamkb/Build/Products/Release-iphoneos/OpenReader.app
```

The verified command below can be used with the same checkout. After changing
computers, checkouts, or DerivedData settings, first query `TARGET_BUILD_DIR`
and `FULL_PRODUCT_NAME` through the build settings and combine the values for the
**OpenReader target** to form the app path:

```bash
xcodebuild -workspace ios/OpenReader.xcworkspace -scheme OpenReader \
  -configuration Release -sdk iphoneos -showBuildSettings \
  | rg 'Build settings for action|TARGET_BUILD_DIR =|FULL_PRODUCT_NAME ='
```

```bash
xcrun devicectl device install app \
  --device IPHONE_UDID \
  /Users/xujialiu/Library/Developer/Xcode/DerivedData/OpenReader-buxlmytdygazkfacxjuwdxvtamkb/Build/Products/Release-iphoneos/OpenReader.app
```

Successful output should contain `App installed` and
`bundleID: top.xujialiu.openreader`.

### 4. Trust the developer and launch

After the first installation, open “Settings → General → VPN & Device
Management” on the iPhone, find the developer entry for the Apple ID, tap
“Trust”, and complete the system prompts. The user must perform this action on
the phone.

Launch OpenReader from the Home Screen, or run:

```bash
xcrun devicectl device process launch \
  --device IPHONE_UDID \
  top.xujialiu.openreader
```

Record build, installation, and launch as separate checks. Once the app displays
normally, disconnect the computer and open it again to verify standalone
operation. A successful installation alone does not prove that launch or app
functionality works.

## Problems encountered: follow the matching branch

| Symptom | Conclusion and handling from this run |
| --- | --- |
| The Release build fails with `Signing for "OpenReader" requires a development team` (2026-09-29, a worktree whose `ios/` a prebuild had just made) | A prebuild writes no team, so the Xcode step in "Initial setup" has to be redone, or the team passed on the command line instead. Add `DEVELOPMENT_TEAM=TEAM_ID CODE_SIGN_STYLE=Automatic` to the `xcodebuild` command above; it changes only that build. `TEAM_ID` is the `OU` of the Apple Development certificate: `security find-certificate -c "Apple Development" -p \| openssl x509 -noout -subject`, not the ID in parentheses after the account's name. With it, 0.0.2-beta59 built in 3 min 17 s and returned 0. |
| Expo reports `No code signing certificates are available to use` | `security find-identity` confirmed 0 identities. Creating an Apple Development certificate in Xcode resolved it. |
| Xcode shows `Communication with Apple failed`, specifically saying that the team has no devices, and also reports that no profile exists | Select the physical iPhone and use the automatic signing and device registration options above; this allowed compilation to proceed during the recorded run. The title alone is not enough to diagnose a network failure; read the detailed reason. |
| `npx expo run:ios --device … --configuration Release` reports `No profiles … found` and requests `-allowProvisioningUpdates` | The Expo command did not complete profile creation during this run. Switching to the `xcodebuild` command above succeeded. Do not repeatedly run the same Expo command expecting signing to recover automatically. |
| `Sandbox: node … deny(1) file-read-data` or a write to `main.jsbundle` is denied | This is the Xcode build script sandbox restriction. Adding `ENABLE_USER_SCRIPT_SANDBOXING=NO` made the recorded build return 0. |
| Installation succeeds, but launch reports `CoreDeviceError 10002` / `Security` | The error lists signing, entitlements, or an untrusted profile among its possible causes. First trust the developer on the phone, then retry. If it still fails after trust, inspect the actual signing and provisioning profile; do not attribute every Security error to an untrusted profile. |

Installation through a Personal Team is subject to provisioning profile expiry.
Release describes the build configuration and does not mean the signature is
permanent. Re-sign and reinstall after expiry. Do not uninstall the old app for
this purpose: uninstalling may delete the local library and settings.

### Missing local dependencies during wireless installation (2026-09-26)

The first build failed on the known ExpoSQLite prefixed-symbol error. Retrying with an isolated module cache passed that stage, but bundling then failed with `Unable to resolve module react-native-teleport`. The manifest and lockfile declared 1.2.2; its installed directory was absent. Starting the native build before checking installed dependencies, and initially reusing the failing shared cache despite the recorded recovery, caused avoidable retries.

`npm install --no-save --package-lock=false` was not a useful repair: it attempted to resolve `react-test-renderer@19.3.0`, which requires React `^19.3.0`, against the project's React 19.2.3. Do not disable the lockfile or upgrade React to repair a missing installed package. For this one missing package, `npm pack react-native-teleport@1.2.2 --pack-destination /tmp --json` obtained the exact archive; its reported integrity matched the lockfile. Extracting it into `node_modules/react-native-teleport` and running `pod install` in `ios/` restored its native integration. This targeted recovery is not a replacement for synchronizing a generally incomplete dependency tree.

The subsequent Release build with the same isolated cache returned 0, and wireless installation and launch both returned 0. Most of the wait preceded transfer: native compilation was repeated after dependency repair, while another simulator build was active. Wireless transfer itself was brief. Do the preflight above first next time; do not attribute a long native build to Wi-Fi.

### Native dependency recovery measured on 2026-09-22 (#43)

A later Release build failed in ExpoSQLite with `cannot find 'exsqlite3_open' in scope` and other prefixed symbols. Both the installed package and Pod lock were 57.0.3, and the generated header contained the declarations. Repeating the build with a fresh module cache passed SQLite compilation; stale cache state is a hypothesis, not a proven root cause.

That build then failed at linking with undefined FFmpeg symbols, including `avformat_open_input`. The downloaded xcframeworks existed under RNAudioAPI, but the generated `Pods-OpenReader.release.xcconfig` lacked their framework paths. Running `pod install` from `ios/` registered all four frameworks: `libavcodec`, `libavformat`, `libavutil` and `libswresample`.

After confirming the downloaded frameworks exist, regenerate the Pods integration:

```bash
(cd ios && pod install)
```

Then repeat the Release build command above with a new, task-specific cache directory added as a build setting, for example:

```text
CLANG_MODULE_CACHE_PATH=/tmp/openreader-iphone-module-cache-20260922
```

Use the same isolated directory for subsequent attempts. This combined recovery returned build exit code 0, and `codesign --verify --deep --strict APP_PATH` passed for the resulting app. No app source was changed. The original cause of the missing generated FFmpeg integration was not established.

### Installation succeeds, but launch is denied (2026-09-22, #43)

The owner temporarily disconnected the phone while the build was repaired. After reconnection, `devicectl device install app` returned 0 and `App installed` for `top.xujialiu.openreader`. This was an installation over the existing app; the old app was not uninstalled.

The subsequent `devicectl device process launch` returned 1 with `com.apple.dt.CoreDeviceError 10002`, `FBSOpenApplicationServiceErrorDomain 1`, and `FBSOpenApplicationErrorDomain 3`. Its reason was `Security`: “invalid code signature, inadequate entitlements or its profile has not been explicitly trusted by the user”. This message lists possible causes; it does not identify which one applies.

Checks on the installed build's local source package established:

- `codesign --verify --deep --strict APP_PATH` returned 0.
- The embedded provisioning profile expires at `2026-09-27 03:12:56 UTC`; it was not expired at installation.
- `ProvisionedDevices` includes the connected phone, represented here as `IPHONE_UDID`.
- The signature's `application-identifier` matches the profile's, and the signature's team identifier belongs to the profile's `TeamIdentifier` list.

To repeat these checks, use `security cms -D -i APP_PATH/embedded.mobileprovision` to decode the profile and `codesign -d --entitlements :- APP_PATH` to inspect the signature's entitlements. Substitute the actual app path and quote paths containing spaces. Compare the fields above locally; do not commit the decoded profile or the phone's real UDID. These checks do not establish that iOS trusts the developer or that every entitlement is valid for launch.

The next on-device step is Settings → General → VPN & Device Management → the developer entry → Trust, completing any system prompts, then opening OpenReader again. If the entry already shows trust, capture the actual on-device launch message and investigate further rather than declaring trust to be the cause. No successful trust action or subsequent launch was observed in this run. Build and installation are verified; launch, standalone operation and reading/audio remain unverified.

## References

- [Expo SDK 57 documentation](https://docs.expo.dev/versions/v57.0.0/)
- [Expo local builds and device selection](https://docs.expo.dev/guides/local-app-development/)

Use the measured failures and successful commands above as the source of truth;
there is no need to rediscover the installation path each time.
