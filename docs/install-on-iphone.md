# Install OpenReader on the owner's iPhone

Use this guide to build a Release of the current checkout and install it on the
owner's iPhone, where it runs without the Mac. OpenReader has native modules of
its own, so it needs a native build; Expo Go cannot stand in for it.

This guide holds the steps and the facts they depend on. An install is routine
and is recorded nowhere: its build, installation and launch go in the reply
(MEMORY/documentation.md).

## Facts

- Workspace `ios/OpenReader.xcworkspace`, scheme `OpenReader`, bundle ID
  `top.xujialiu.openreader`.
- Team `UPR29WR8FC`, a paid Developer Team. It kept this ID when the Personal
  Team was upgraded. `app.config.ts` sets it as `ios.appleTeamId` (#108), so a
  prebuild writes `DEVELOPMENT_TEAM` itself.
  Xcode's cached team list (`defaults read com.apple.dt.Xcode
  IDEProvisioningTeamByIdentifier`) can still say `Personal Team`; it is not
  the membership's state.
- The development profile for the app expires 2027-09-30. Profiles and their
  expiry are below.
- The phone is written `IPHONE_UDID` in anything committed; `xcrun devicectl
  list devices` gives the real one. Once paired, `devicectl` reaches it over
  Wi-Fi as well as the cable: check before asking the owner to plug one in.

## First time on a Mac or a phone

1. Connect the iPhone to the Mac with a cable, unlock it, and choose “Trust This Computer”. On the phone, open “Settings → Privacy & Security → Developer Mode”, enable Developer Mode, and complete the restart and confirmation requested by the phone.
2. In Xcode, open Settings → Accounts and sign in with the Apple ID. Select the account, then use Manage Certificates → ＋ → Apple Development to create a certificate. Skip this if a valid certificate already exists.
3. Open the workspace from the repository root:

   ```bash
   open ios/OpenReader.xcworkspace
   ```

4. Press ⌘1 to show the project navigator, then click the blue OpenReader project on the far left. The narrow middle column contains PROJECT and TARGETS. Click **OpenReader under TARGETS**. The PROJECT entry and Pods are not the app's signing settings.
5. In the right pane, open Signing & Capabilities → All, check that Automatically manage signing is on and the team is `UPR29WR8FC`. Select the physical iPhone in the run destination at the top, rather than a simulator.

The repository's `ios/` directory is generated. If it does not exist, install the
project dependencies and run
`EXPO_PUBLIC_OPENREADER_VARIANT=debug npx expo prebuild --platform ios` first, then open
the workspace. There is no need to delete or clean the native directory for
routine installation.

## Each installation

Run the commands from the repository root. Keep the phone unlocked.

### 1. The phone, the certificate and Xcode

```bash
xcrun devicectl list devices
security find-identity -v -p codesigning
xcodebuild -version
```

You should see the physical iPhone and at least one valid Apple Development
identity. `0 valid identities found` means that signing in to the account alone
was not enough; create a certificate in Xcode. The device list also includes
simulators.

### 2. The checkout, before a native build

A native build takes minutes, and a missing piece is often found only near its
end, so check these first:

1. `npm ls --depth=0 --omit=dev` reports nothing missing or invalid. A package
   in the manifest and the lockfile can still be absent from `node_modules`; a
   missing one otherwise surfaces only when the JavaScript is bundled. The
   repair is in Troubleshooting.
2. `ios/` belongs to the Debug role: Info.plist's `OpenReaderBuildVariant`
   is `debug`, and `CFBundleVersion` is the formal base in `app-version.ts`
   plus two. For a missing/stale native tree or changed modules/configuration,
   run `EXPO_PUBLIC_OPENREADER_VARIANT=debug npx expo prebuild --platform ios`,
   which runs pod install. SDK 57 recreates native folders by default;
   `--no-clean` opts out. `--clean` remains an accepted hidden argument but is
   unnecessary; help does not list it.
3. `node_modules/expo-sqlite/ios/sqlite3.h` exists. Pods generate it and
   `npm ls` does not check it. If it is missing, `(cd ios && pod install)`.
4. **After an `npm ci` over an existing `ios/`**: `npm ci` also removes the
   FFmpeg xcframeworks that RNAudioAPI downloads. Run `pod install`, build once,
   and if the link fails on FFmpeg symbols, run `pod install` again and
   rebuild. A fresh prebuild after `npm ci` needs neither.
5. Other heavy Xcode builds: `pgrep -fl xcodebuild`. They slow this one down;
   leave them running, since they may be someone else's.

Run `pod install` or clear build products only for one of the reasons above:
regenerating the dependencies recompiles most of the native code.

### 3. Build

```bash
CHECKOUT=$(basename "$PWD")
EXPO_PUBLIC_OPENREADER_VARIANT=debug xcodebuild \
  -workspace ios/OpenReader.xcworkspace \
  -scheme OpenReader \
  -configuration Release \
  -destination 'id=IPHONE_UDID' \
  -derivedDataPath "/tmp/openreader-iphone-$CHECKOUT" \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  ENABLE_USER_SCRIPT_SANDBOXING=NO \
  CLANG_MODULE_CACHE_PATH="/tmp/openreader-iphone-module-cache-$CHECKOUT" \
  -quiet build > "/tmp/openreader-iphone-$CHECKOUT.log" 2>&1
echo "exit $?"
```

- `-derivedDataPath` and `CLANG_MODULE_CACHE_PATH`: one pair per checkout,
  named after it, reused by every build there. A build beside another one in
  the same workspace needs its own DerivedData, and Xcode's shared module cache
  has reproduced the ExpoSQLite failure in Troubleshooting. The first build in
  a new DerivedData compiles every native dependency, 1,149 s from scratch;
  later ones are incremental, a few minutes or less.
  `/tmp` is emptied when the Mac restarts.
- `-allowProvisioningUpdates`: allows Xcode to create or update signing profiles using the logged-in account.
- `-allowProvisioningDeviceRegistration`: allows automatic signing to register the target device.
- `ENABLE_USER_SCRIPT_SANDBOXING=NO`: lets the React Native bundling script read the project and write the JavaScript bundle. It applies only to this command and does not modify the project configuration.
- `EXPO_PUBLIC_OPENREADER_VARIANT=debug`: the diagnostic, no-purchase Debug copy ([ADR 0054](adr/0054-debug-mode-is-fixed-when-the-app-is-built.md)), always set for the owner's phone, so that a fault met away from the Mac leaves a Debug Log on the phone to be read back afterwards. Settings then shows the version ending in `-debug`. The Debug Log is in the app's container at `Library/Application Support/debug-log/`; copy it off with `python3 test/manual-test/kit/debug-log.py IPHONE_UDID OUT_DIR` (`test/manual-test/kit/README.md`, "Pull the Debug Log off the phone"); the whole diagnosis is [debug-on-iphone.md](debug-on-iphone.md).
- Release bundles the JavaScript and resources into the app, so Metro and a computer connection are not required at runtime. Online speech services and other features still require a network connection.

**Success is exit code 0**, not the log's wording and not the presence of an
`.app`. A build that returns 0 can still print
`error: the following command failed with exit code 0 but produced no further output`:
Xcode's wording for a command that printed only warnings. To find a real
failure, search the log for `BUILD FAILED` or an `error:` naming a file.

macOS has no `timeout` command. Give the tool call its own timeout, or run the
build in the background with its exit code written to a file and poll that. A
quiet log is not a hang: check whether compiler processes are still running
before restarting anything.

**Purchase behavior.** The owner's Debug copy has no purchase module, row,
listener or fake-store controls (#324). All features are available, without
writing an Unlock or changing legitimate purchase records. The free role is
also purchase-free but keeps no Debug Log. Use the formal role, selected at
both prebuild and bundling, for genuine StoreKit testing; a development-signed
formal copy uses Apple's sandbox. Such account/purchase tests require their
own explicit scope, not an install-only request.

Use the same explicit role on prebuild and build commands. The old
`EXPO_PUBLIC_OPENREADER_DEBUG_MODE=1` and `EXPO_PUBLIC_OPENREADER_UNLOCKED=1`
source-build commands still select Debug and free respectively; conflicting
selections fail. Keep role switches out of persistent shell/`.env*` and
`.xcode.env.local` configuration. Metro's role/cache selection and the native
identity guard prevent a stale shell from silently running another role.

### 4. Check and install

First keep the Debug Log the phone holds. A build with Debug Mode empties it at
its first launch when another version wrote it, and a build without Debug Mode
deletes it (ADR 0082), so the author's Debug Notes would go with it:

```bash
python3 test/manual-test/kit/debug-log.py IPHONE_UDID /tmp/or-debug-before-install
OLD="$(cat /tmp/or-debug-before-install/debug-log/version.txt 2>/dev/null || echo unrecorded)"
mv /tmp/or-debug-before-install "/tmp/or-debug-before-$OLD"
python3 test/manual-test/kit/debug-notes.py "/tmp/or-debug-before-$OLD/debug-log"
```

- Say in the reply where the copy is and how many Debug Notes it holds
  (`debug-notes.py` prints them and their count). It lasts until the Mac
  restarts: `/tmp` keeps files unread for weeks, but nothing from before the
  last restart.
- Exit 1 from `debug-log.py` means the phone holds no Debug Log, as after a
  build without Debug Mode: there is nothing to keep, so go on.
- `OLD` is the version that wrote the log, as in `1.0.0 (12)-beta3`; a log from
  before #305 has no `version.txt` and is kept as `unrecorded`. When the folder
  already exists, `mv` puts the new copy inside it, and both are kept.

Then check the build and install it:

```bash
APP="/tmp/openreader-iphone-$CHECKOUT/Build/Products/Release-iphoneos/OpenReader.app"
node --require tsx/cjs scripts/verify-build.ts --app "$APP" --variant debug
codesign --verify --deep --strict "$APP"
xcrun devicectl device install app --device IPHONE_UDID "$APP"
```

- The verifier inspects the embedded Hermes bundle and every native Mach-O,
  not a requested flag or the plain intermediate bundle. It requires the
  current Version, matching Debug role/number and no native or JS purchase
  capability. For these checks, use the final `.app` that will be installed.
- Successful installation prints `App installed` and
  `bundleID: top.xujialiu.openreader`.
- Install over the existing app. Never uninstall it first: uninstalling deletes
  the app's container, with the owner's Library and settings.

### 5. Launch

```bash
xcrun devicectl device process launch \
  --device IPHONE_UDID \
  top.xujialiu.openreader
```

On the first installation on a phone, the owner trusts the developer before the
app can launch: Settings → General → VPN & Device Management → the developer
entry → Trust. Only the owner can do this, on the phone.

Report build, installation and launch as separate results. Installation does
not prove launch, and a launch from the command line does not prove what is on
the screen: the screen, reading and playback are checked on the phone. To check
that the app runs on its own, disconnect the Mac and open it again.

## Profiles and expiry

- A profile Xcode makes for the paid team lasts a year. Release is a build
  configuration, not a permanent signature: when the profile expires, build and
  install again over the existing app.
- Xcode keeps using a cached profile until it expires, even after the team
  changes. To make it create a new one, move the old one out of
  `~/Library/Developer/Xcode/UserData/Provisioning Profiles/` before building.
- A new bundle ID, or a profile renewed, needs an Apple ID signed in to Xcode:
  `defaults read com.apple.dt.Xcode DVTDeveloperAccountManagerAppleIDLists`
  must not be an empty list. If it is, the owner signs in under Xcode →
  Settings → Accounts.
- To inspect a build's signature and profile, decode the profile with
  `security cms -D -i "$APP/embedded.mobileprovision"` and read the signature's
  entitlements with `codesign -d --entitlements :- "$APP"`. Compare the
  profile's expiry, whether `ProvisionedDevices` includes the phone, whether
  `application-identifier` matches the profile's, and whether the signature's
  team is in the profile's `TeamIdentifier`. Keep the decoded profile and the
  phone's real UDID out of the repository.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| `Signing for "OpenReader" requires a development team` | The `ios/` predates #108, whose prebuild writes the team. Prebuild again, or add `DEVELOPMENT_TEAM=UPR29WR8FC CODE_SIGN_STYLE=Automatic` to the build command; it changes only that build. The Team ID is the `OU` of the Apple Development certificate (`security find-certificate -c "Apple Development" -p \| openssl x509 -noout -subject`), not the ID in parentheses after the account's name. |
| Expo reports `No code signing certificates are available to use` | `security find-identity` finds 0 identities: create an Apple Development certificate in Xcode. |
| Xcode shows `Communication with Apple failed`, saying that the team has no devices and no profile exists | Choose the physical iPhone as the destination and keep `-allowProvisioningUpdates -allowProvisioningDeviceRegistration`. Read the detailed reason: the title alone does not mean a network failure. |
| `npx expo run:ios --device … --configuration Release` reports `No profiles … found` and asks for `-allowProvisioningUpdates` | Use the `xcodebuild` command above. Running the Expo command again does not create the profile. |
| `No Accounts: Add a new account in Accounts settings`, with `No profiles for '<bundle id>' were found` | No Apple ID is signed in to Xcode (Profiles and expiry above). The owner signs in. |
| `Sandbox: node … deny(1) file-read-data`, or a write to `main.jsbundle` is denied | The build script sandbox: `ENABLE_USER_SCRIPT_SANDBOXING=NO`, as in the command above. |
| ExpoSQLite fails with `cannot find 'exsqlite3_open' in scope` and other prefixed symbols | Check that `sqlite3.h` exists, and if not, `pod install`. If it exists and the error stays, the module cache keeps the failed compile: delete `/tmp/openreader-iphone-module-cache-$CHECKOUT` and build again. A stale cache is suspected, not proven; the SQLite sources and the signing are not at fault. |
| The link fails on undefined FFmpeg symbols, such as `_avformat_open_input` | `Pods-OpenReader.release.xcconfig` under `ios/Pods/Target Support Files/` was written while the downloaded FFmpeg xcframeworks were missing. Once they exist under RNAudioAPI, `pod install` registers `libavcodec`, `libavformat`, `libavutil` and `libswresample`; build again. |
| Bundling fails with `Unable to resolve module <package>`, although the manifest and lockfile declare it | The package is missing from `node_modules`. Restore that exact version: `npm pack <package>@<version> --pack-destination /tmp --json`, check its integrity against the lockfile, extract it into `node_modules/<package>`, and `pod install` if it has native code. `npm install --no-save --package-lock=false` is the wrong repair: it resolves newer peers (it took `react-test-renderer@19.3.0` against React 19.2.3). For a tree missing more than one package, `npm ci`, then step 2. |
| A wireless installation waits long before any transfer begins | The time is the native build, not Wi-Fi: transfer itself is brief. Do step 2 before building. |
| Installation succeeds, but launch fails with `CoreDeviceError 10002` / `Security`: "invalid code signature, inadequate entitlements or its profile has not been explicitly trusted by the user" | The message lists alternatives; it does not say which applies. Have the owner trust the developer on the phone (step 5) and launch again. If the developer is already trusted, inspect the signature and profile (Profiles and expiry), and capture the message the phone shows. |
| Launch fails with `BSErrorCodeDescription = Locked` | The phone is locked. The owner unlocks it and opens the app. |
| The Debug Log's first line says `system log missing (no native module)` | The `ios/` predates #82, whose Debug Log system-log line is a local native module. Run `pod install` in `ios/` (or prebuild) and build again. |

## References

- [Expo SDK 57 documentation](https://docs.expo.dev/versions/v57.0.0/)
- [Expo local builds and device selection](https://docs.expo.dev/guides/local-app-development/)
