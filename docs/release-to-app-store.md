# Release OpenReader to the App Store

Use this guide to build a version for TestFlight or App Review, upload it, tag it,
and fill in App Store Connect. For signing and provisioning in general, see
[install-on-iphone.md](install-on-iphone.md).

## Rules

The owner set these.

- **Build only from a commit on `main`.**
  - The working tree must be clean, and HEAD must equal `origin/main`.
  - Start every build from `npx expo prebuild --platform ios --clean`, never from an `ios/` left over from earlier work.
  - A Debug Mode build (ADR 0054) is for the owner's phone only. Do not upload one.
- **The version line.** `APP_VERSION` in `app-version.ts` is
  `x.y.z (n)-betaN`: the Version, Build Number and Beta of CONTEXT.md (#127,
  ADR 0070). `app.config.ts` reads `CFBundleShortVersionString` (`x.y.z`) and
  `CFBundleVersion` (`n`) from it. The beta changes before an upload
  already carry the number that upload will take: `1.0.0 (5)-beta3` uploads as
  1.0.0 (5). Every uploaded build, TestFlight-only or submitted, has
  `APP_VERSION` with no Beta, `1.0.0 (5)`.
- **Version.** Only the owner changes `x.y.z`; an upload or a submission does
  not. App Store Connect refuses uploads to a version that is already released
  (ITMS-90186). If the version is live on the App Store, stop before archiving
  and ask the owner for the next one, recommending the next patch.
- **Build number.** It goes up by one for every upload, across all versions, and
  a number is never reused. The first app change after an upload raises it
  (MEMORY/app-change.md). An upload with no change since the last one raises it
  itself. The commit that sets the upload's `APP_VERSION` is the commit that
  build is made from.
- **Tags.**
  - Every uploaded build gets an annotated `build-N` on the commit it was built from.
  - The build you submit also gets `vX.Y.Z`.
  - Push `main` and tags only after the owner agrees. The repository is public.

## Current state

Checked 2026-10-05; In-App Purchases 2026-10-09. When a fact here changes, change it here, and record what
happened in that day's `notes/` file.

- **Team and signing**
  - Team `UPR29WR8FC`, a paid team. The owner is Account Holder/Admin.
  - The Apple Development certificate is valid until 2027-09-20.
  - Exporting with `-allowProvisioningUpdates` creates what distribution needs: `iOS Team Store Provisioning Profile: top.xujialiu.openreader`, which expires 2027-09-30, and a cloud-managed distribution certificate.
- **App ID** `top.xujialiu.openreader` ("OpenReader"), with no capabilities. New App's Bundle ID menu also lists `top.xujialiu.openreader.systemvoices`. That other ID is unrelated: do not use it.
- **App Store Connect record**
  - "OpenReader: Read Aloud", Apple ID 6817809106, SKU `openreader`.
  - iOS only, primary language English (U.S.), Full Access.
  - "OpenReader" was already taken as an App Store name. The Home Screen name stays OpenReader, from `CFBundleDisplayName`.
- **Builds**
  - The last upload is **1.0.0 (6)**, from `5b02aed`. It is submitted and **Waiting for Review**, with manual release selected. That is not approval or public release. The next upload is build 7.
  - **Do not release 1.0.0 (6)** (author's decision, 2026-10-09; ADR 0075). The first public version sells the Unlock. Once approved, 1.0.0 (6) stays unreleased. When the build with the In-App Purchases is ready, withdraw 1.0.0 (6) with "Cancel this release" or Developer Reject, then submit the new build under 1.0.0 with both purchases.
  - 1.0.0 (5) was removed from review when build 6 replaced it.
  - 0.0.1 (1) tested the pipeline only. Never submit it.
- **TestFlight**
  - The public link is https://testflight.apple.com/join/vjC8QejW ("Join the OpenReader: Read Aloud beta"). Anyone with it can join while it accepts testers.
  - Apple approved **1.0.0 (5)** for external testing (reported by the owner on 2026-10-09). The link installs that build, and README.md's TestFlight badge names it.
- **Tags**: `build-5`, `build-6` and `v1.0.0` (on `5b02aed`, build 6) are pushed. `build-2`, `build-3` and `build-4` are local only.
- **App Review Information**: the notes are the Guideline 2.1 answer (3,950 characters), with the recording `OpenReader-Review-Demo.mp4` attached. The review key is saved only in App Store Connect.
- **Store**: free, in 174 countries or regions (every one except China mainland; Apple adds future territories automatically), not on Apple silicon Macs or Apple Vision Pro. Books, 4+, non-trader. The privacy label is published (below). Three 1320 × 2868 screenshots: Library, Contents, Settings; the 6.5-inch set uses them.
- **In-App Purchases** (ADR 0075, #148), both Non-Consumable and in Prepare for Submission. The first one must go to review with a new app version, and each still needs its review screenshot.
  - "30-day Trial": `top.xujialiu.openreader.trial`, Apple ID 6820864102, US$0.00. English (U.S.) display name "30-day Trial", description "Read aloud free for 30 days."
  - "Unlock": `top.xujialiu.openreader.unlock`, Apple ID 6820865303, US$4.99 with the United States as base. Apple's generated prices hold elsewhere (Australia A$7.99, for example). English (U.S.) display name "Unlock Read Aloud", description "Read aloud and offline narration, for good."
  - Both: 174 countries or regions (every one except China mainland), future territories added automatically, Family Sharing off, tax category matched to the app. An In-App Purchase's availability list starts with China mainland ticked, so untick it there. (notes 2026-10-09 14:20)
- **Web pages**, from `site/` through `.github/workflows/pages.yml`:
  - Support URL: https://xujialiu.github.io/OpenReader/
  - Privacy Policy URL: https://xujialiu.github.io/OpenReader/privacy.html

The uploads, submissions and App Review's answers are in the notes of their
days: `NOTES_2026-09-30.md` (0.0.1 (1)), `NOTES_2026-10-03.md` (builds 3 and 4,
store setup), `NOTES_2026-10-04.md` (Guideline 2.1, build 5) and
`NOTES_2026-10-05.md` (build 6).

## Build and upload

1. **Preflight**
   - Run `git fetch` and `git status`. The tree is clean and `git rev-parse HEAD` equals `git rev-parse origin/main`.
   - Run `npm ci`.
   - Run the unit tests, `npx tsc --noEmit` and `npx eslint .`.
   - Check for other heavy Xcode builds (`pgrep -fl xcodebuild`). A build in the same workspace at the same time needs its own `-derivedDataPath`, because two builds cannot share one DerivedData.
2. **Version and build number**, as a commit that reaches `main` through the usual merge:
   - Set `APP_VERSION` in `app-version.ts` to `X.Y.Z (N)`: drop the `-betaN`. `N` must be one more than the last uploaded build (the highest `build-*` tag). It is already, unless nothing has changed since that upload; then raise it.
   - Only if the owner named a new Version: `npm version <X.Y.Z> --no-git-tag-version`, so that `package.json` and the lockfile match.
   - `npx vitest run test/app-config.test.ts` checks that `APP_VERSION`, `app.config.ts` and `package.json` agree.
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

   - Success is exit code 0. Expect a few minutes.
   - The log's lines `error: the following command failed with exit code 0 but produced no further output` do not fail the build.
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

   - It ends with `Upload succeeded` and `** EXPORT SUCCEEDED **`. Expect a few minutes, the upload included.
   - Warnings about missing dSYMs are expected, and they fail nothing. They name React, ReactNativeDependencies, hermesvm, libavcodec, libavformat, libavutil and libswresample: prebuilt frameworks that ship no dSYMs.
   - `App record with bundle identifier … not found` means no App Store Connect record uses this bundle ID.
6. **Processing.** App Store Connect → the app → TestFlight → Build Uploads shows Processing, then Complete, within about 10 to 25 minutes. Apple emails any ITMS problem.
7. **Tags**, on the build's commit:
   - `git tag -a build-N -m "OpenReader X.Y.Z (N), uploaded YYYY-MM-DD"`
   - For the submitted build, also `git tag -a vX.Y.Z`.
   - Ask the owner before `git push origin main --tags`.

## The README follows Apple's answers

README.md says which build people can install (MEMORY/documentation.md,
"README.md"). Change it in the same commit as the fact here:

- **When Apple approves another build for external testing:**
  - Change the TestFlight badge in README.md to `X.Y.Z (N)`. In the image address that is `X.Y.Z%20%28N%29`.
  - Replace the old image address in `PAGES_MAY_NAME` in `test/app/no-outgoing-links.test.ts` with the new one.
  - Update **TestFlight** under Current state.
- **When a Version goes live on the App Store:**
  - Add Apple's "Download on the App Store" badge to README.md, linking to https://apps.apple.com/app/id6817809106. Add both addresses to `PAGES_MAY_NAME`.
  - Ask the owner whether the TestFlight badge stays.
- Run `bash scripts/readme-preview.sh` and give the owner `.docs/README.html` to look at before committing.

## App Store Connect

The decisions are the owner's. Items marked "draft" still need the owner's approval.

**Editing a field from a script**: a value written by script (the native value
setter plus `input`/`change` events) shows in the field but is not saved.
Select the field's text by script and type over it; that saves, and keeps a
secret such as the review key out of the agent's output (notes 2026-10-05,
build 6).

- **App Privacy.** Published:
  - **Other User Content**: App Functionality and Other Purposes;
  - **User ID**: App Functionality;
  - both linked to identity; neither used for tracking.

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
  to API calls without evidence. Account credentials justify the User ID
  disclosure; text and credentials are treated as linked rather than claiming
  anonymization. Content/model improvement permitted by provider terms is
  disclosed under Other Purposes. The app does not send ad identifiers or
  implement cross-app advertising tracking. The public policy distinguishes
  developer behavior from independent provider behavior; future changes to
  provider practices require reassessment.
- **Age rating**, in the new questionnaire: answer None or No throughout, because the app supplies no content of its own. Expect 4+. The owner confirms.
- **Pricing and Availability**
  - Free.
  - Every country or region except China mainland, which requires an ICP filing and falls under the deep-synthesis rules.
  - Turn off availability on Mac with Apple silicon and on Apple Vision Pro; neither has been tested.
- **EU Digital Services Act:** non-trader. The owner sets it from the banner on the Apps page. Revisit it if the app ever charges money.
- **Export compliance:** nothing to answer, because `ITSAppUsesNonExemptEncryption = NO` is in the build.
- **Content rights:** the owner answers. The app shows documents the person adds themselves, and ships none.
- **Category:** Books (saved).
- **Copyright:** 2026 Xujia Liu.
- **Release after approval:** manual.
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
2. In OpenReader: Settings > Providers > Fish Audio. Keep "Enabled" off and paste
   this test key into "API key": <KEY>. Then turn "Enabled" on and confirm
   "Connection successful". Fields are locked while the provider is enabled.
3. Open the book, open the voice list in the player, and choose a Fish Audio voice.
4. Press Play. The first time, the app asks before sending the document's text to
   Fish Audio: choose Allow. Each word is highlighted as it is spoken.

Text goes only to the service the user chooses, and only after the user allows it.
Word Lookup (long-press a word) asks the same way before it sends a selection to a
dictionary or translation service.
```

The notes saved in App Store Connect are the longer Guideline 2.1 answer,
close to the field's 4,000-character limit.

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
  OpenReader is free and open source: github.com/xujialiu/OpenReader
  ```

- **Marketing URL:** `https://github.com/xujialiu/OpenReader`.
