# Verify the three release copies (#324)

Use the shared [admission/readiness gate](../kit/ios-verification.md), an owned
simulator and attempt directory. Heavy prebuild/pod/build/install phases below
run inside one admitted phase, not as bare xcodebuild calls. Preserve failed
attempts and stop after the single permitted environment recovery. No phone,
Mac installation, upload, purchase on a real account or Apple group change is
part of this recipe.

## 1. Host bundle and native-resolution matrix

Read the role/number contract in
[ADR 0086](../../../docs/adr/0086-three-copies-for-three-recipients.md).
Use one source tree. Clear legacy switches and select
`EXPO_PUBLIC_OPENREADER_VARIANT=formal|free|debug` explicitly. Keep artifacts
outside git. For each role:

```sh
EXPO_PUBLIC_OPENREADER_VARIANT=ROLE CI=1 EXPO_NO_DOTENV=1 \
  npx expo export:embed --platform ios --dev false --bytecode --max-workers 2 \
  --bundle-output OUT/ROLE/main.jsbundle \
  --sourcemap-output OUT/ROLE/main.jsbundle.map
node --require tsx/cjs scripts/verify-bundle.ts \
  --bundle OUT/ROLE/main.jsbundle --variant ROLE
```

Run free → formal → Debug without resetting Metro's cache. Require one static
role marker, the current APP_VERSION, and the matching purchase source graph.
Free/Debug must contain no purchase controller/UI/native bridge, product IDs
or purchase-cache strings. Formal must retain them.

Generate each native tree with the same role and
`npx expo prebuild --platform ios --no-install`. SDK 57 recreates native
folders by default; `--no-clean` opts out. The parser still accepts hidden
`--clean`; its absence from help does not mean it is unsupported.
Inspect Info.plist's `OpenReaderBuildVariant` and derived Build Number, the
Podfile's `use_expo_modules!` exclusion, and autolinking's module provider.
Only formal may register `open-reader-store`/`OpenReaderStore`. This is native
configuration evidence, not a compiled-binary pass.

## 2. Compile and inspect all three native artifacts

Inside admission, use normal prebuild (with pod install) and a separate
DerivedData for each role. Keep the same role environment through prebuild,
build and embedding; silence the owned simulator before launch.

```sh
EXPO_PUBLIC_OPENREADER_VARIANT=ROLE EXPO_NO_DOTENV=1 npx expo prebuild --platform ios
EXPO_PUBLIC_OPENREADER_VARIANT=ROLE EXPO_NO_DOTENV=1 xcodebuild \
  -workspace ios/OpenReader.xcworkspace -scheme OpenReader -configuration Release \
  -sdk iphonesimulator -destination 'id=SIMULATOR_UDID' \
  -derivedDataPath OUT/ROLE ENABLE_USER_SCRIPT_SANDBOXING=NO \
  CODE_SIGNING_ALLOWED=NO -jobs 6 -quiet build
node --require tsx/cjs scripts/verify-build.ts \
  --app OUT/ROLE/Build/Products/Release-iphonesimulator/OpenReader.app --variant ROLE
```

Require exit 0 and nonempty JSON for every verifier. It checks native and
embedded identity, iPhone/iPad/full-screen/audio/export declarations, current
bundle Version, and every Mach-O (including framework symlinks and debug
dylibs). Formal needs the native Store module and JS products; the other two
must have neither. A successful prebuild, source inspection or binary from
another role cannot substitute for this evidence.

## 3. UI, access and replacement

Install over the same owned simulator app; never uninstall/erase its data.
Use Debug to stage a controlled local Provider, consent and fixture Document,
then record Library/settings/Reading Position/Offline Narration and purchase
record hashes. Keep real credentials out of artifacts.

For each installed role, run `SettingsVersionProbe` with `--mode formal`,
`--mode free` or `--mode debug`. It checks the exact derived label, Purchase
row presence, General/Providers/Sync round trips and light/dark appearances.
The old `--mode release` is an alias for formal; an omitted mode means Debug.
Capture the visible footer as well as its accessibility label.

For free and Debug, establish a working Provider/Voice control, then press
Play by real touch, observe the first controlled synthesis, and pause as soon
as that proves the gate is open. Check simulator silence immediately before
each play. Start a small Download, verify its requests, then stop it and play
the saved narration offline. No Trial, Unlock, Restore or native purchase
sheet may intervene; purchase records must remain unchanged.

For formal, inspect the actual StoreKit source. On an account-less simulator,
source verification may be unavailable: confirm a refused Play/Download sends
nothing, not a fabricated paid/trial state. Use a correctly activated local
StoreKit test configuration for actual purchase scenarios. The host source-
cache tests cover owned/expired/not-started → free → formal round trips; do
not relabel them as real Apple-account handoff evidence.

The cold-start and refusal controls are probes, so they work even when the AXe
session is dead (`pitfalls/mcp.md`): `ColdStartPlayProbe` cold-launches the app
and plays a saved chapter by real touch with the provider port closed — the
centre button's Play→Pause→Play is the observable check that disk narration
plays in a fresh process (`bash test/manual-test/kit/run-probe.sh
ColdStartPlayProbe UDID OUT -only-testing:testColdStartOfflinePlay`), and
`FormalRefusedPlayProbe` asserts the formal copy refuses the same touch with a
closed provider and captures the screen (`-only-testing:testRefusedPlay`).
A Library row's changed “Last read” line is supporting evidence only: cached
clips explain an unchanged provider log, so a same-process play never proves
fresh synthesis. `scripts/verify-build.ts` needs the embedded `main.jsbundle`,
so it applies to Release-configuration artifacts; a Metro-delivered Debug
build is verified by its Info.plist (`CFBundleVersion`,
`OpenReaderBuildVariant`, `RCTMetroPort`), the Debug Log launch line's
“Metro bundle”, Metro's own bundle record and the on-screen footer.

## 4. Final delivery and limits

Leave the latest Debug copy open with playback stopped. For a Metro delivery,
build Debug configuration with the Debug role, pin its own RCT_METRO_PORT and
leave that matching Metro running. Native/runtime role mismatch must show a
rebuild error, never silently fall back to free or paid behavior.

Report source revision, each role's build/verifier logs, actual UI actions,
Provider request evidence, data hashes, every failure and final delivery.
Simulator products do not prove device signing, TestFlight/App Store behavior,
real purchasing-account changes or public group assignment. Record no row in
`docs/versions.md`: nothing here uploads a build.
