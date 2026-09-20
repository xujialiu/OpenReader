# Install OpenReader on an iPhone

Use this guide to install a Release build on your own iPhone from a local Mac so
that it can run without being connected to the computer.
These steps are based on an actual installation performed on 2026-09-20. The
project includes custom native modules, so it requires a native app build and
cannot use Expo Go as a substitute.

## Results verified in this run

- Environment: Expo SDK 57, Xcode 27.0 (27A266); the project's minimum iOS version is 17.2.
- Physical device: `Xujia’s iPhone`, UDID `00008140-001651843E40801C`.
- Workspace: `ios/OpenReader.xcworkspace`; scheme: `OpenReader`.
- Bundle ID: `top.xujialiu.openreader`.
- Automatic signing used `Xujia Liu (Personal Team)`, with an Apple Development certificate.
- The `xcodebuild` command below returned 0; `devicectl` confirmed that the app was installed.
- Automatic launch returned a Security error containing “profile has not been explicitly trusted by the user”. The user was prompted to trust the developer on the phone; this record does not confirm launch, reading, or audio functionality after trust was granted.

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
unlocked.

### 1. Confirm the device and certificate

```bash
xcrun devicectl list devices
security find-identity -v -p codesigning
xcodebuild -version
```

You should see the physical iPhone and at least one valid Apple Development
identity. `0 valid identities found` means that signing in to the account alone
was not enough; create a certificate in Xcode. The device list also includes
simulators, so select the UDID of the physical device.

### 2. Build a standalone Release version

This is the command that succeeded for this project during the recorded run:

```bash
xcodebuild \
  -workspace ios/OpenReader.xcworkspace \
  -scheme OpenReader \
  -configuration Release \
  -destination 'id=00008140-001651843E40801C' \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  ENABLE_USER_SCRIPT_SANDBOXING=NO \
  -quiet build
```

Replace the destination UDID when using another phone. The first build compiles
native dependencies and takes significantly longer than later incremental
builds. Use exit code 0 as the success criterion; do not use warnings in the log
or the presence of an `.app` directory as the criterion.

- `-allowProvisioningUpdates`: allows Xcode to create or update signing profiles using the logged-in account.
- `-allowProvisioningDeviceRegistration`: allows automatic signing to register the target device.
- `ENABLE_USER_SCRIPT_SANDBOXING=NO`: the Xcode build setting required by this build so that the React Native bundling script can read the project and write the JavaScript bundle. It applies only to this command and does not modify the project configuration.
- Release bundles the JavaScript and resources into the app, so Metro and a computer connection are not required at runtime. Online speech services and other features still require a network connection.

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
  --device 00008140-001651843E40801C \
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
  --device 00008140-001651843E40801C \
  top.xujialiu.openreader
```

Record build, installation, and launch as separate checks. Once the app displays
normally, disconnect the computer and open it again to verify standalone
operation. A successful installation alone does not prove that launch or app
functionality works.

## Problems encountered: follow the matching branch

| Symptom | Conclusion and handling from this run |
| --- | --- |
| Expo reports `No code signing certificates are available to use` | `security find-identity` confirmed 0 identities. Creating an Apple Development certificate in Xcode resolved it. |
| Xcode shows `Communication with Apple failed`, specifically saying that the team has no devices, and also reports that no profile exists | Select the physical iPhone and use the automatic signing and device registration options above; this allowed compilation to proceed during the recorded run. The title alone is not enough to diagnose a network failure; read the detailed reason. |
| `npx expo run:ios --device … --configuration Release` reports `No profiles … found` and requests `-allowProvisioningUpdates` | The Expo command did not complete profile creation during this run. Switching to the `xcodebuild` command above succeeded. Do not repeatedly run the same Expo command expecting signing to recover automatically. |
| `Sandbox: node … deny(1) file-read-data` or a write to `main.jsbundle` is denied | This is the Xcode build script sandbox restriction. Adding `ENABLE_USER_SCRIPT_SANDBOXING=NO` made the recorded build return 0. |
| Installation succeeds, but launch reports `CoreDeviceError 10002` / `Security` | The error lists signing, entitlements, or an untrusted profile among its possible causes. First trust the developer on the phone, then retry. If it still fails after trust, inspect the actual signing and provisioning profile; do not attribute every Security error to an untrusted profile. |

Installation through a Personal Team is subject to provisioning profile expiry.
Release describes the build configuration and does not mean the signature is
permanent. Re-sign and reinstall after expiry. Do not uninstall the old app for
this purpose: uninstalling may delete the local library and settings.

## References

- [Expo SDK 57 documentation](https://docs.expo.dev/versions/v57.0.0/)
- [Expo local builds and device selection](https://docs.expo.dev/guides/local-app-development/)

Use the measured failures and successful commands above as the source of truth;
there is no need to rediscover the installation path each time.
