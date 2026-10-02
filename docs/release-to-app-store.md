# Release OpenReader to the App Store

Use this guide to build a version for TestFlight or App Review, upload it, tag it,
and fill in App Store Connect. For signing and provisioning in general, see
[install-on-iphone.md](install-on-iphone.md).

## Rules

The owner set these on 2026-09-30.

- **Build only from a commit on `main`.**
  - The working tree must be clean, and HEAD must equal `origin/main`.
  - Start every build from `npx expo prebuild --platform ios --clean`, never from an `ios/` left over from earlier work.
  - A Debug Mode build (ADR 0054) is for the owner's phone only. Do not upload one.
- **Version.** `app.config.ts` derives `CFBundleShortVersionString` from
  `APP_VERSION` minus its `-beta<n>` (#108). A beta therefore uploads as the
  version it leads to, for example 1.0.0-beta3 as 1.0.0. The build you submit has
  `APP_VERSION` with no suffix. App Store Connect refuses uploads to a version
  that is already released (ITMS-90186).
- **Build number.** `ios.buildNumber` in `app.config.ts` goes up by one for every
  upload, across all versions, and a number is never reused. Commit the increase
  to `main` before archiving: the commit that raises it is the commit that
  build is made from.
- **Tags.**
  - Every uploaded build gets an annotated `build-N` on the commit it was built from.
  - The build you submit also gets `vX.Y.Z`.
  - Push `main` and tags only after the owner agrees. The repository is public.
- **The first release is 1.0.0.** It waits until #105 is merged into `main`.

## Current state

- **Team and signing**
  - Team `UPR29WR8FC`, a paid team since 2026-09-30. The owner is Account Holder/Admin.
  - The Apple Development certificate is valid until 2027-09-20.
  - Exporting with `-allowProvisioningUpdates` creates what distribution needs. On 2026-09-30 it created `iOS Team Store Provisioning Profile: top.xujialiu.openreader`, which expires 2027-09-30, and a cloud-managed distribution certificate.
- **App ID** `top.xujialiu.openreader` ("OpenReader"), registered in Certificates, Identifiers & Profiles on 2026-09-30, with no capabilities. The free team's App IDs made by Xcode had lapsed, and New App's Bundle ID menu listed only `top.xujialiu.openreader.systemvoices` until this one was registered. That other ID is unrelated: do not use it.
- **App Store Connect record**
  - "OpenReader: Read Aloud", Apple ID 6817809106, SKU `openreader`.
  - iOS only, primary language English (U.S.), Full Access.
  - "OpenReader" was already taken as an App Store name. The Home Screen name stays OpenReader, from `CFBundleDisplayName`.
- **Build 0.0.1 (1)**
  - Uploaded 2026-09-30 at 22:29 CST. Processing ended "Complete", with no ITMS error and no Missing Compliance.
  - It tested the pipeline only, before #109 and the version rule. Never submit it.
- **Build 1.0.0 (3)**
  - Uploaded 2026-10-03 at 00:42 CST from `main` commit `9cf0a86`, after the EPUB 3 Contents correction (#125).
  - Clean prebuild; archive/export each returned 0; pre-Hermes bundle verified `DEBUG_MODE = false`. All 2,325 tests, TypeScript and ESLint passed.
  - Independent simulator verification exercised three different section-start destinations in the unchanged Gutenberg sample on Release 1.0.0 (3). It did not cover playback or an established paused Reading Position; do not substitute it for the fresh-install review walkthrough below.
  - App Store Connect initially showed Processing. Build 2 remains attached to the version until build 3 is processed and selected. No review submission yet (#124).
  - Annotated `build-2` and `build-3` exist locally; neither has been pushed. No `v1.0.0` tag yet.
- **Store setup saved on 2026-10-03**
  - Free; 174 countries/regions, excluding China mainland. Apple says future territories are included automatically.
  - Apple silicon Mac and Apple Vision Pro availability disabled and checked after navigating back.
  - Privacy policy URL saved. Other User Content data type saved, but its setup is incomplete and the privacy label is **not published**.
- **Web pages**, from `site/` through `.github/workflows/pages.yml`:
  - Support URL: https://xujialiu.github.io/OpenReader/
  - Privacy Policy URL: https://xujialiu.github.io/OpenReader/privacy.html

## Build and upload

1. **Preflight**
   - Run `git fetch` and `git status`. The tree is clean and `git rev-parse HEAD` equals `git rev-parse origin/main`.
   - Run `npm ci`.
   - Run the unit tests, `npx tsc --noEmit` and `npx eslint .`.
   - Check for other heavy Xcode builds (`pgrep -fl xcodebuild`). A build in the same workspace at the same time needs its own `-derivedDataPath`, because two builds cannot share one DerivedData.
2. **Version and build number**, as a commit that reaches `main` through the usual merge:
   - Set `APP_VERSION` in `app-version.ts`: `1.0.0` for the submission, `1.0.0-betaN` for a TestFlight-only beta.
   - `npm version <X.Y.Z> --no-git-tag-version`, so that `package.json` and the lockfile match.
   - Raise `ios.buildNumber` by one.
   - `npx vitest run test/app-config.test.ts` checks that the three agree.
3. **Prebuild:** `npx expo prebuild --platform ios --clean`, then check that `node_modules/expo-sqlite/ios/sqlite3.h` exists.
4. **Archive**, without `EXPO_PUBLIC_OPENREADER_DEBUG_MODE` anywhere: not on the command line, not in the shell, not in `.env*`, and not in `ios/.xcode.env.local`.

   ```bash
   xcodebuild -workspace ios/OpenReader.xcworkspace -scheme OpenReader \
     -configuration Release -destination 'generic/platform=iOS' \
     -archivePath "$HOME/Library/Developer/Xcode/Archives/$(date +%F)/OpenReader X.Y.Z (N).xcarchive" \
     -allowProvisioningUpdates ENABLE_USER_SCRIPT_SANDBOXING=NO \
     CLANG_MODULE_CACHE_PATH=/tmp/openreader-module-cache-release \
     -quiet archive
   ```

   - Success is exit code 0. On 2026-09-30 this took 222 s, run at `nice 15` beside a simulator test.
   - The log's lines `error: the following command failed with exit code 0 but produced no further output` do not fail the build. There were seven.
   - Check the archive's `Products/Applications/OpenReader.app/Info.plist`:
     - the version and build are the intended ones;
     - `ITSAppUsesNonExemptEncryption` is false;
     - `UIDeviceFamily` is `[1]`;
     - `NSMicrophoneUsageDescription` is present;
     - `UIBackgroundModes` is `[audio]`.
   - Check the JavaScript bundle the archive used:

     ```bash
     grep -o 'var DEBUG_MODE = [a-z]*;' \
       ~/Library/Developer/Xcode/DerivedData/OpenReader-*/Build/Intermediates.noindex/ArchiveIntermediates/OpenReader/BuildProductsPath/Release-iphoneos/main.jsbundle
     ```

     It must print `false`. Take the newest file if there are several.
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

   - It ends with `Upload succeeded` and `** EXPORT SUCCEEDED **`. On 2026-09-30 it took 331 s.
   - Warnings about missing dSYMs are expected, and they fail nothing. They name React, ReactNativeDependencies, hermesvm, libavcodec, libavformat, libavutil and libswresample: prebuilt frameworks that ship no dSYMs.
   - `App record with bundle identifier … not found` means no App Store Connect record uses this bundle ID. That was the case before the record above existed.
6. **Processing.** App Store Connect → the app → TestFlight → Build Uploads shows Processing, then Complete. The first build took under 25 minutes. Apple emails any ITMS problem.
7. **Tags**, on the build's commit:
   - `git tag -a build-N -m "OpenReader X.Y.Z (N), uploaded YYYY-MM-DD"`
   - For the submitted build, also `git tag -a vX.Y.Z`.
   - Ask the owner before `git push origin main --tags`.

## App Store Connect: before submitting 1.0.0

The decisions are the owner's from 2026-09-30. Items marked "draft" still need the owner's approval.

- **App Privacy.** Declare **Other User Content**:
  - used for App Functionality;
  - not linked to the user's identity;
  - not used for tracking.

  **Reassessment required (#124, 2026-10-03): do not publish this earlier draft unchanged.**
  Apple's [definition of linked data](https://developer.apple.com/app-store/app-privacy-details/)
  includes linkage by third-party partners through an account, not just an
  OpenReader account. Requests authenticate with the user's own service key.
  [OpenAI's data controls](https://platform.openai.com/docs/guides/your-data)
  list 30-day abuse-monitoring retention for `/v1/audio/speech`; zero retention
  is not the default for every account. [Fish Audio's policy](https://fish.audio/privacy/)
  permits content retention; its [Customer Agreement §4.4](https://fish.audio/enterprise-terms/)
  describes optional, eligible Zero Data Retention, not a universal guarantee.
  Conversely, [Azure's real-time TTS policy](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/speech-service/text-to-speech/data-privacy-security)
  says it does not store synthesis text or output. Provider behavior differs.
  [Speechify's general policy](https://speechify.com/privacy/) covers stored user
  content and account association, but an API-specific no-retention commitment
  has not been verified. Do not apply website advertising/cookie provisions
  to API calls without evidence. Final linkage, data types and purposes need
  owner confirmation based on applicable API practices; “nothing else is
  collected” and “not linked” are not established by this investigation.
- **Age rating**, in the new questionnaire: answer None or No throughout, because the app supplies no content of its own. Expect 4+. The owner confirms.
- **Pricing and Availability**
  - Free.
  - Every country or region except China mainland, which requires an ICP filing and falls under the deep-synthesis rules.
  - Turn off availability on Mac with Apple silicon and on Apple Vision Pro; neither has been tested.
- **EU Digital Services Act:** non-trader. The owner sets it from the banner on the Apps page. Revisit it if the app ever charges money.
- **Export compliance:** nothing to answer, because `ITSAppUsesNonExemptEncryption = NO` is in the build.
- **Content rights:** the owner answers. The app shows documents the person adds themselves, and ships none.
- **Category:** Books (draft).
- **Copyright:** 2026 Xujia Liu.
- **Release after approval:** manual or automatic. The owner decides at submission.
- **Screenshots**
  - 6.9-inch, 1320 × 2868, from an iPhone 17 Pro Max simulator, 3 to 10 of them. iPhone only, so no iPad set.
  - Set the status bar with `xcrun simctl status_bar <udid> override --time 9:41`.
  - Show only public-domain books, for example from Project Gutenberg.
  - Show no API key and no Provider's prices (ADR 0017).
  - Suggested set: the Library, a page with the spoken word highlighted, the player, Word Lookup, Settings.
- **Review notes and demo key**
  - The owner creates a new Fish Audio API key with a small prepaid balance, pastes it only into App Store Connect, and deletes it after approval.
  - It is never committed, logged or shown in a screenshot.
  - Before submitting, check every step of the template below on a fresh install. A fresh install's Provider is OpenAI, so the reviewer must choose a Fish Audio voice.

### Review notes (template)

```text
OpenReader reads EPUB documents aloud with a speech service the user chooses,
using the user's own API key for that service. It has no account and no server
of its own, and it sells nothing.

To test:
1. In Safari, download a public-domain EPUB, for example
   https://www.gutenberg.org/ebooks/1342.epub3.images (Pride and Prejudice).
   In the Files app, share it to OpenReader (or long-press > Share > OpenReader).
2. In OpenReader: Settings > Providers > Fish Audio. Turn on "Enabled" and paste
   this test key into "API key": <KEY>
3. Open the book, open the voice list in the player, and choose a Fish Audio voice.
4. Press Play. The first time, the app asks before sending the document's text to
   Fish Audio: choose Allow. Each word is highlighted as it is spoken.

Text goes only to the service the user chooses, and only after the user allows it.
Word Lookup (long-press a word) asks the same way before it sends a selection to a
dictionary or translation service.
```

### Store listing (draft, for the owner to approve)

- **Subtitle** (30 max): `EPUBs in the voice you choose`
- **Promotional text** (170 max): `Listen to your EPUB books in natural voices from the speech service you choose, with every word highlighted as it is spoken.`
- **Keywords** (100 max; no other companies' names):
  `text to speech,tts,epub,ebook,audiobook,read along,listen,voice,highlight,offline,kokoro,narrator`
- **Description:**

  ```text
  OpenReader reads your EPUB books aloud and highlights each word as it is spoken,
  so you can listen, read along, or both.

  OpenReader uses your own account with a speech service. You need an API key
  from one of these: OpenAI, Fish Audio, Microsoft Azure Speech, Speechify, or a
  server you run yourself (OpenAI-compatible or Kokoro-FastAPI).

  • Word by word: the page follows the voice and marks each word as it is spoken.
  • Keeps reading with the screen locked, with controls on the Lock Screen.
  • Download chapters to listen without a connection.
  • Look up a word or translate a passage without leaving the page.
  • Pick up where you left off on another device, through WebDAV storage you own.
  • Your way: font, text size, margins, alignment, pauses between sentences and
    paragraphs, light and dark.

  No account, no subscription, no server of its own. Your documents stay on your
  iPhone, and text goes only to the service you choose, after you allow it.
  OpenReader is open source.
  ```
