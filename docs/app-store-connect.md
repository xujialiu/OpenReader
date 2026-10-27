# App Store Connect reference

Read before changing store settings, metadata, screenshots or review
materials, or using the App Store Connect API. Follow
[the release workflow](release-to-app-store.md) for uploads and distribution;
verify live build/review states in Apple rather than inferring them from
saved reference values. Upload history belongs in notes and the confirmed
[upload ledger](versions.md).

## Identity and signing

- Team `UPR29WR8FC`, a paid team; the owner is Account Holder/Admin.
- Bundle ID `top.xujialiu.openreader`, display name OpenReader. The unrelated
  `top.xujialiu.openreader.systemvoices` ID is not this app.
- App Store record: OpenReader: Read Aloud, Apple ID `6817809106`, SKU
  `openreader`, iOS, primary language English (U.S.), Full Access. The store
  name OpenReader was taken; the Home Screen name remains OpenReader.
- Apple Development certificate expiry: 2027-09-20. Export with
  `-allowProvisioningUpdates` creates the cloud-managed distribution
  certificate and `iOS Team Store Provisioning Profile: top.xujialiu.openreader`
  (expiry 2027-09-30). General signing is in
  [install-on-iphone.md](install-on-iphone.md).
- Support: https://xujialiu.github.io/OpenReader/
- Privacy policy: https://xujialiu.github.io/OpenReader/privacy.html
- For Trial/Unlock identifiers, prices, localizations and Family Sharing,
  read [ADR 0075, Products](adr/0075-read-aloud-is-bought-once-after-a-trial.md#the-products)
  before changing purchase metadata. Both products have approved review
  screenshots but no product review notes. Their availability covers all
  storefronts except China mainland; the availability form initially ticks
  China mainland, so untick it.

## TestFlight and API access

- The public link is https://testflight.apple.com/join/vjC8QejW . Read its
  current build from Apple, not the last upload; use
  [the badge diagnostics](testflight-badge.md) when checking that link or badge.
- Read [ADR 0086](adr/0086-three-copies-for-three-recipients.md#routing-and-completion)
  before changing group assignments. Internal `owner` distributes
  automatically and cannot be switched to manual (neither its Settings tab
  nor the API allows it), so it receives every upload; the owner installs
  the Debug copy by hand. `public` receives only owner-selected free test copies.
- The Team key OpenReader README badge has the Developer role, which is
  read-only for TestFlight builds/external groups, not globally read-only.
  The key does not expire and its role cannot be edited.
- `~/.secrets/openreader/app-store-connect-api.env` names the Key ID, Issuer
  ID and adjacent `.p8`, which Apple allows to be downloaded once. GitHub's
  `github-pages` environment holds `ASC_KEY_ID`, `ASC_ISSUER_ID` and
  `ASC_PRIVATE_KEY`; only `main` may use it.
- If leaked, revoke the key under Users and Access → Integrations → App Store
  Connect API, generate another and replace the three secrets.
- `scripts/asc-api.mjs` makes one request with this key and prints the
  status, then the JSON; its header shows a read and a write. A release reads
  everything back through it: builds and their processing, the version and its
  fields, screenshot states, review submissions.
- To set What to Test, get its localization ID from
  `GET /v1/builds/{build}/betaBuildLocalizations`, then
  `PATCH /v1/betaBuildLocalizations/{id}` with `whatsNew`. The helper signs a
  write without a `scope`; a token scoped to the PATCH gets HTTP 405.

## Metadata and review

The decisions are the owner's. Items marked "draft" still need the owner's approval.

**Editing a field from a script**: a value written by script (the native value
setter plus `input`/`change` events) shows in the field but is not saved.
Select the field's text by script and type over it; that saves, and keeps a
secret such as the review key out of the agent's output.
`document.execCommand('insertText', false, text)` on the selected field also
saves. So a revision built in the page from the field's own value,
with the review key left where it was, never passes through the agent.
On the version page, What's New is `#whatsNew` and the review notes `#notes`.

**Working in the page**: use the Claude in Chrome browser whose `osPlatform`
is macOS; the names "Browser 1" and "Browser 2" swap between sessions. Its
App Store Connect sign-in lapses: a run can open on the login page (blank,
`authResult=FAILED`), and a session can end mid-run or right after Submit for
Review. Open the app's page before the first web step; on the login page, ask
the owner to sign in in that tab, and wait for the answer. A page that turns
blank, or whose buttons have no text, comes back when entered again from
Apps → OpenReader about ten seconds later; click a button once its label shows.
Read every web change back through `scripts/asc-api.mjs`, which needs no web
session: a submission whose click ends on the login page went through when
the version reads `WAITING_FOR_REVIEW` with the formal build, and
`/v1/reviewSubmissions?filter[app]=6817809106` lists it `WAITING_FOR_REVIEW`
with a `submittedDate`.

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
  - To take the app off the store, Remove App From Sale is at the bottom of the page. It leaves every storefront within 24 hours; people who downloaded it keep it and its updates, and can download it again from their purchase history.
  - Preserve the owner's enabled availability on Macs with Apple silicon. Mark compatibility as verified only after testing the uploaded app on Mac; iPad simulator results alone do not establish it. Apple Vision Pro remains off.
- **EU Digital Services Act:** trader, since the app sells the Unlock (ADR 0075). Business → Compliance shows it Active for 27 countries or regions: verified, so it no longer holds back the EU storefronts. Opening its row opens the trader or non-trader form; close it with Cancel.
- **Export compliance:** nothing to answer, because `ITSAppUsesNonExemptEncryption = NO` is in the build.
- **Content rights:** the owner answers. The app shows documents the person adds themselves, and ships none.
- **Category:** Books (saved).
- **Copyright:** 2026 Xujia Liu.
- **Release after approval:** manual.
- **A new version** (the + beside iOS App) copies the description, keywords, URLs, copyright and review notes from the last one, but not the review attachment. Its What's New starts empty. The notes' first line names the formal build under review (`Review notes for OpenReader 1.0.3 (16), …`); replace that build with the new formal one. Add Build as soon as the formal copy reads `VALID`, while the free and Debug copies are still uploading or processing: the picker then lists the formal build alone. Add for Review can warn "Newer Build Available" because free/Debug copies have higher numbers. Keep the exact formal build from [versions.md](versions.md) selected and recheck the Draft Submission before the owner authorizes Submit for Review. A newer or odd-numbered build is not evidence of the formal role.
- **Screenshots**
  - The uploaded sets and the script that makes them are in [`app-store-screenshots/`](../app-store-screenshots/README.md): reading with the spoken word highlighted, Word Lookup, the Download drawer and the Library, for iPhone and iPad.
  - Required slots: iPhone with Dynamic Island (medium display), 1206 × 2622 or 1179 × 2556; with iPad support (#319), iPad 13" display, 2064 × 2752 or 2048 × 2732. Recheck them in Media Manager against Apple's [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/); use captures of the actual iPad layout, not enlarged phone screenshots.
  - Show only public-domain books, for example from Project Gutenberg.
  - Show no API key and no Provider's prices (ADR 0017).
- **Review notes and demo key**
  - The owner keeps one review-only Fish Audio API key with a small prepaid balance, pasted only into App Store Connect.
  - It stays from one version to the next: every submission is reviewed, and a reviewer without a working key cannot test reading aloud (Guideline 2.1). Before each submission the owner checks that the key still works and that its balance covers a review.
  - It is never committed, logged or shown in a screenshot.
  - Before submitting, check every step of the template below on a fresh install. A fresh install's Provider is OpenAI, so the reviewer must choose a Fish Audio voice.
- **App Transport Security**: the build sets `NSAllowsArbitraryLoads` (ADR 0080), and Apple asks for a justification at review. The notes carry this sentence, or the answer to App Review's question does: `OpenReader connects to a speech server or WebDAV folder whose address the user enters, often a computer at home reached over plain HTTP by a local or VPN host name, so it allows HTTP connections (NSAllowsArbitraryLoads). The hosted speech services it supports are reached over HTTPS.`

### Review notes (template)

```text
OpenReader reads EPUB documents aloud with a speech service the user chooses,
using the user's own API key for that service. It has no account and no server
of its own. Reading aloud is free for 30 days, then a one-time In-App Purchase.

To test:
1. In Safari, download a public-domain EPUB, for example
   https://www.gutenberg.org/ebooks/1342.epub3.images (Pride and Prejudice).
   In the Files app, share it to OpenReader (or long-press > Share > OpenReader).
2. In OpenReader: Settings > Providers > Fish Audio. Keep "Enabled" off and paste
   this test key into "API key": <KEY>. Then turn "Enabled" on and confirm
   "Connection successful". Fields are locked while the provider is enabled.
3. Open the book, open the voice list in the player, and choose a Fish Audio voice.
4. Press Play. On the first use, choose Start Free Trial and complete Apple's
   purchase sheet for the free 30-day Trial. Then, when the app asks before sending
   the document's text to Fish Audio, choose Allow. Each word is highlighted as it
   is spoken.

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
  Free to download. Reading aloud is free for 30 days, then a one-time in-app purchase
  unlocks it for good. Reading, look-up and sync stay free.
  OpenReader is open source: github.com/xujialiu/OpenReader
  ```

- **Marketing URL:** `https://github.com/xujialiu/OpenReader`.
