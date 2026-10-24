# Build and upload the three App Store Connect copies

Read [the release workflow](release-to-app-store.md) first. Execute this branch
only with explicit upload authorization and its readiness gate cleared. This
is not the [simulator verification recipe](../test/manual-test/purchase/release-variants.md).

## Archive, inspect, upload — one role at a time

Start from the clean, approved commit on `main`, with matching `origin/main`,
dependencies/checks complete, and unused identities agreed under ADR 0086.
First verify the internal `owner` group no longer auto-receives all uploads;
this branch's export uploads before returning to the main workflow. If that
routing gate cannot be confirmed, stop before executing it.
Use a new absolute `OUT` directory. Keep one admitted build lane; these
commands belong inside a bounded phase under the shared iOS guard.

```sh
set -euo pipefail
: "${RELEASE_COMMIT:?record the exact approved Beta-less upload commit}"
test "$(git rev-parse HEAD)" = "$RELEASE_COMMIT"
git diff --quiet && git diff --cached --quiet
: "${OUT:?set a new absolute output directory}"
test ! -e "$OUT"
mkdir -p "$OUT"
node --require tsx/cjs -e "if (require('./app-version.ts').APP_VERSION.includes('-beta')) throw Error('Uploads require a Beta-less source commit')"
TEAM=$(env -u EXPO_PUBLIC_OPENREADER_DEBUG_MODE -u EXPO_PUBLIC_OPENREADER_UNLOCKED \
  EXPO_PUBLIC_OPENREADER_VARIANT=formal EXPO_NO_DOTENV=1 \
  node --require tsx/cjs -p "require('./app.config.ts').default.ios.appleTeamId")
python3 - "$OUT/UploadOptions.plist" "$TEAM" <<'PY'
import plistlib, sys
with open(sys.argv[1], 'wb') as output:
    plistlib.dump({'method': 'app-store-connect', 'destination': 'upload',
                  'teamID': sys.argv[2], 'signingStyle': 'automatic',
                  'uploadSymbols': True, 'manageAppVersionAndBuildNumber': False}, output)
PY
with_variant() {
  env -u EXPO_PUBLIC_OPENREADER_DEBUG_MODE -u EXPO_PUBLIC_OPENREADER_UNLOCKED \
    EXPO_PUBLIC_OPENREADER_VARIANT="$variant" EXPO_NO_DOTENV=1 "$@"
}
for variant in formal free debug; do
  # SDK 57 recreates native folders by default; --no-clean is the opt-out.
  with_variant npx expo prebuild --platform ios
  test -f node_modules/expo-sqlite/ios/sqlite3.h
  with_variant xcodebuild -workspace ios/OpenReader.xcworkspace -scheme OpenReader \
    -configuration Release -destination 'generic/platform=iOS' \
    -derivedDataPath "$OUT/derived-$variant" -archivePath "$OUT/$variant.xcarchive" \
    -allowProvisioningUpdates ENABLE_USER_SCRIPT_SANDBOXING=NO \
    CLANG_MODULE_CACHE_PATH="$OUT/module-cache-$variant" -jobs 6 -quiet archive \
    > "$OUT/$variant-archive.log" 2>&1
  node --require tsx/cjs scripts/verify-build.ts \
    --app "$OUT/$variant.xcarchive/Products/Applications/OpenReader.app" \
    --variant "$variant" > "$OUT/$variant-verification.json"
  with_variant xcodebuild -exportArchive -archivePath "$OUT/$variant.xcarchive" \
    -exportOptionsPlist "$OUT/UploadOptions.plist" -exportPath "$OUT/export-$variant" \
    -allowProvisioningUpdates > "$OUT/$variant-upload.log" 2>&1
done
```

The export step **uploads**, rather than only writing an IPA. On any failure,
stop: preserve all logs and completed identities and follow the main guide's
record/receipt step before asking the owner whether to retry or rebuild.
Never replace a failed role with another artifact or reuse an accepted number.

## Acceptance and measured caveats

- Each archive exits 0 and its artifact verifier returns nonempty JSON. The
  verifier checks native Version/Build/role, current embedded Version and one
  static JS role, device families, full-screen/audio/export declarations, and
  actual native/JS purchase presence or exclusion. A requested flag, a source
  file or a leftover `.app` is not acceptance evidence.
- `Upload succeeded` and `** EXPORT SUCCEEDED **` establish transport success,
  not processing or distribution. Read each build from Apple; processing has
  previously taken about 10–25 minutes and Apple emails ITMS failures. Require
  valid processing before treating the set as complete.
- The warning `error: the following command failed with exit code 0 but
  produced no further output` is not itself a failed build; use the exit code
  and real compiler diagnostics. Missing dSYMs for prebuilt React,
  ReactNativeDependencies, hermesvm, libavcodec, libavformat, libavutil and
  libswresample are known nonfatal warnings.
- `App record with bundle identifier … not found` means the selected identifier
  has no App Store Connect record. Check the intended app; do not create a
  second identity or change roles to make an upload pass.
- Expo writes CFBundleVersion at prebuild. A later Xcode setting cannot repair
  the wrong role/number. Prebuild and bundle with the same explicit variant;
  clear conflicting shell/`.env*`/`.xcode.env.local` switches rather than
  weakening the identity or purchase checks.

For Apple fields, What to Test API details and group setup, read
[App Store Connect reference](app-store-connect.md). Return to the main guide
for processing, ledger, tag, owner receipt and publication gates. This branch
does not authorize public testing, App Store submission or release.
