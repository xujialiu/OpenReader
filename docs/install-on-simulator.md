# Update OpenReader on the iOS Simulator

Use this guide to run the current working-tree code on a local Mac simulator,
including uncommitted changes.
For physical-device signing, provisioning profiles, and developer trust, see
the [iPhone installation guide](install-on-iphone.md).
The simulator does not need those physical-device steps and cannot install a
build produced for `iphoneos`.

## Confirm the target and run mode

Run the following from the repository root:

```bash
pwd
xcode-select -p
xcrun simctl list devices available
xcrun simctl list devices booted
lsof -nP -iTCP:8081 -sTCP:LISTEN
```

The target recorded in this guide is an iPhone 17 with UDID
`13D669CF-ADBD-470C-9D6C-C3B03B9746E9`. Always check the device list first and
replace `SIMULATOR_UDID` in the commands below with the target for this run. Be
especially careful not to use `booted` blindly when multiple simulators are
running.
If the target is not already running:

```bash
xcrun simctl boot SIMULATOR_UDID
xcrun simctl bootstatus SIMULATOR_UDID -b
```

This project has custom native modules, so use the OpenReader app rather than
Expo Go. An installed Debug app whose native dependencies still match can load
the latest JavaScript from Metro directly. Changes to native modules, plugins,
dependencies, or native configuration require a new build and installation.
A Release build contains its JavaScript bundle, so restarting Metro does not
update it.

## Routine update: an existing Debug app with only app-code changes

First confirm that Metro belongs to this repository. A listening port only shows
that a service exists; it does not show that the service uses the right
directory. Use the PID from the previous step to inspect the process and its
working directory:

```bash
ps -p METRO_PID -o command=
lsof -a -p METRO_PID -d cwd
curl -s http://localhost:8081/status
```

If the process is a stale service from this project, stop that exact PID and
start Metro from the current repository:

```bash
kill METRO_PID
npx expo start --port 8081
```

If no service is running, only run the start command. If the existing service is
correct, keep it. If the port belongs to another project that is still in use,
choose an available port for this project and use the same port in its build and
run configuration. Keep the terminal running Metro open during development.

In another terminal, restart the app so that it requests the current bundle:

```bash
xcrun simctl terminate SIMULATOR_UDID top.xujialiu.openreader
xcrun simctl launch SIMULATOR_UDID top.xujialiu.openreader
curl -s http://localhost:8081/json/list
```

If the app was not running, a “process not found” result from `terminate` does
not prevent the later `launch` from working.
Check Metro for a bundling record from this run and confirm that the debug target
includes `top.xujialiu.openreader`.
You must also open the screen affected by the change and confirm that the final
change is actually visible; a successful connection alone does not prove that
the update is complete.

### Encountered: Metro pointed to the old directory

On 2026-09-20, the process on port 8081 was still running from the old
`Works/react_native` directory. Restarting the app showed
`ConfigError: The expected package.json path … does not exist`, and `/json/list`
was initially empty. Stopping that stale process, starting Metro in
`Works/openreader`, and restarting the app fixed the problem. The logs showed a
new bundle, the debug target appeared, and the reading page displayed the latest
same-row layout and speed buttons. No app deletion or library clearing was
needed.

## First installation or native changes: build a Debug simulator app

Read the [Expo SDK 57 documentation](https://docs.expo.dev/versions/v57.0.0/)
first.
Install the repository dependencies. Run the following only when the native
directory does not exist or the relevant configuration needs to be regenerated:

```bash
npx expo prebuild --platform ios
```

The usual build and launch entry point is:

```bash
npx expo run:ios --device SIMULATOR_UDID --port 8081
```

You can also build, install, and launch separately to identify which step fails.
The following shows the Debug simulator command shape; during the recorded run,
the JavaScript-only update was verified without rerunning this build command:

```bash
xcodebuild \
  -workspace ios/OpenReader.xcworkspace \
  -scheme OpenReader \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'id=SIMULATOR_UDID' \
  -derivedDataPath /tmp/openreader-simulator-build \
  ENABLE_USER_SCRIPT_SANDBOXING=NO \
  -quiet build > /tmp/openreader-simulator-build.log 2>&1
```

Wait for the command to exit with code 0 before installing. The existence of the
product directory does not prove that this build succeeded.

```bash
xcrun simctl install SIMULATOR_UDID \
  /tmp/openreader-simulator-build/Build/Products/Debug-iphonesimulator/OpenReader.app
xcrun simctl launch SIMULATOR_UDID top.xujialiu.openreader
```

Keep the existing app data by installing over the app. Do not uninstall the app
or erase the simulator as part of a routine update.
Then complete the Metro connection checks above and the interaction verification
below.

### Encountered: Debug linked the Release React framework

On 2026-09-20, the Debug link failed with missing symbols
`facebook::react::Sealable` and `ShadowNode::getDebugName`. When
`React-Core-prebuilt/.last_build_configuration` is missing,
`replace-rncore-version.js` treats an unmarked framework as Debug and skips the
replacement; the installed binary was actually the Release binary.

Only when you encounter the same symbol errors, inspect the current framework's
symbols, the generated configuration marker, and the local replacement script.
The previous fix set the generated marker to Release, then used the installed
script to switch to Debug and extract the Debug archive from the cache. `nm`
then found the Sealable constructor and the build passed.
This is not required for every build; the complete measurement is preserved in
the engineering log for that day.

## Final delivery verification

1. Open the page affected by the change and verify the visible result of the final code.
2. Operate the changed control and check its result. When needed, save a simulator screenshot:

   ```bash
   xcrun simctl io SIMULATOR_UDID screenshot /tmp/openreader-simulator-final.png
   ```

3. Report build, installation, launch, and interaction verification separately. Calling a control handler is not equivalent to testing a physical touch.
4. Stop playback and leave the latest app open on a convenient page for inspection. For a Debug delivery, also leave the correct Metro process running.

Purely visual checks do not require playback. When audio is needed, turn the
simulator volume all the way down first, then derive the playback duration from
the fact the test needs to establish and stop playback immediately after that
fact is established. Read credentials from the repository's `.secrets/` only as
needed; do not put them in screenshots, logs, or documentation.

### No usable simulator window

First check the simulator entry point provided by the local Xcode installation.
On this machine, Xcode 27 provides
`Xcode-27.0.0.app/Contents/Applications/DeviceHub.app`; do not repeatedly try
the nonexistent `Developer/Applications/Simulator.app`.
Starting the device, installing the app, and launching it can still be done with
`simctl`; an unavailable window does not mean those steps are impossible.

Screenshots and the actual runtime state can help locate a problem, but a
screenshot alone does not prove that an interaction succeeded.
If the automation window is still unavailable, continue checking the window,
permissions, and session state. If a debug handler is used to verify an
interaction, state its coverage, remove temporary debug code, and confirm again
that the final working-tree code is loaded.
Any real external blocker must be reported explicitly; incomplete simulator
delivery must not be reported as complete.

### Encountered: DeviceHub launcher did not open a window

On 2026-09-20, the desktop was unlocked and a DeviceHub process already existed,
but opening the app bundle still produced no discoverable window.
Launching the actual executable inside the bundle directly made the window and
the simulator's accessibility control tree appear:

```bash
/Applications/Xcode-27.0.0.app/Contents/Applications/DeviceHub.app/Contents/MacOS/DeviceHub \
  > /tmp/openreader-devicehub.log 2>&1
```

This run used accessibility controls to operate and read back the enabled switch,
read-only fields, and audio source; coordinate input still reported that the
window was not focused. Do not describe successful accessibility operations as a
passed coordinate-touch test.

### Lock-screen button is clickable, but its icon is invisible

On this machine, iOS 27.0 once showed an enabled Play button in the system
accessibility tree. Clicking it actually played or paused, but the icon was not
visible in the screenshot. First use the lock-screen screenshot, real-click, and
system-resource inspection scripts in
[`test/manual-test/README.md`](../test/manual-test/README.md) to distinguish these
facts; “XCTest passed” does not mean that the icon is visible.
The resource-loading failure recorded on 2026-09-20 and the iOS 26.5 comparison
are in that day's engineering log. The owner later reported that the lock-screen
displayed correctly on a physical device. For now, treat this as a display issue
in the tested simulator environment and keep the app's existing media-control
implementation. The physical device model and system version were not recorded,
so this does not establish that all devices have been verified.
When the same symptom occurs, compare with a physical device first; do not
replace the app's lock-screen interface solely to fix a simulator screenshot.
