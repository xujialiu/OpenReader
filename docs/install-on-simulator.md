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

Check the device list first and replace `SIMULATOR_UDID` in the commands
below with the target for this run. Be especially careful not to use `booted`
blindly when multiple simulators are running.
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

You can also build, install, and launch separately to identify which step fails:

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

A build or launch that fails is in Troubleshooting below.

## Final delivery verification

1. Open the page affected by the change and verify the visible result of the final code.
2. Operate the changed control and check its result. When needed, save a simulator screenshot:

   ```bash
   xcrun simctl io SIMULATOR_UDID screenshot /tmp/openreader-simulator-final.png
   ```

3. Report build, installation, launch, and interaction verification separately. Calling a control handler is not equivalent to testing a physical touch.
4. Stop playback and leave the latest app open on a convenient page for inspection. For a Debug delivery, also leave the correct Metro process running.

Purely visual checks do not require playback. When audio is needed, turn that
simulator's own volume all the way down first — never the Mac's:

```bash
bash test/manual-test/kit/silence.sh set SIMULATOR_UDID
```

The device must already be booted, and a boot resets it to 60, so set it after
the boot and before launching the app; an app that is already playing keeps the
volume it started with. Then derive the playback duration from the fact the test
needs to establish and stop playback immediately after that fact is established.
Read credentials from `~/.secrets/openreader/` only as needed; do not put
them in screenshots, logs, or documentation.

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

If DeviceHub is running but opening its bundle gives no window, start the
executable inside the bundle directly; the window and the simulator's
accessibility tree then appear (notes 2026-09-20 13:15):

```bash
/Applications/Xcode-27.0.0.app/Contents/Applications/DeviceHub.app/Contents/MacOS/DeviceHub \
  > /tmp/openreader-devicehub.log 2>&1
```

In that window, accessibility actions can work while coordinate input still
reports the window unfocused. Report a successful accessibility action as that,
not as a passed coordinate touch.

## Troubleshooting

More simulator failures, by tool, are in
[`test/manual-test/pitfalls/simulators.md`](../test/manual-test/pitfalls/simulators.md).

| Symptom | What to do | Notes |
| --- | --- | --- |
| The app shows `ConfigError: The expected package.json path … does not exist`, and `/json/list` is empty | Metro on that port runs from another directory. Stop that exact PID, start Metro in this repository, and restart the app (Routine update). The app and its library can stay. | 2026-09-20 12:33 |
| The Debug link fails on missing `facebook::react::Sealable` and `ShadowNode::getDebugName` | The installed React framework is the Release one: with `React-Core-prebuilt/.last_build_configuration` missing, `replace-rncore-version.js` takes an unmarked framework for Debug and skips the replacement. Check the framework's symbols with `nm`, set the generated marker to Release, then run the installed replacement script for Debug, which extracts the cached Debug archive. | 2026-09-20 12:00 |
| A Debug build links but crashes before JavaScript in `expo::ExpoViewProps` / `facebook::react::Props::Props` | Precompiled Expo modules built against another React configuration. Rebuild them from source with `cd ios && EXPO_USE_PRECOMPILED_MODULES=0 pod install`, then the Debug build above. | 2026-09-20 17:50 |
| Launch fails in dyld naming `/usr/lib/libSystem.B.dylib` and `no dyld cache` | Shut the simulator down and boot it again. The app and the simulator's data can stay. | 2026-09-20 17:50 |
| On the lock screen, Play is in the accessibility tree and works, but its icon is invisible in screenshots | A display problem of the iOS 27.0 simulator: the owner's phone shows the lock screen normally. Compare with a physical device first, and keep the app's media controls. The lock-screen screenshot, real-click and system-resource scripts in [`test/manual-test/README.md`](../test/manual-test/README.md) tell these apart; "XCTest passed" does not mean the icon is visible. | 2026-09-20 14:36, 14:47, 15:12 |
