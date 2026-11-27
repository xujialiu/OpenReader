# Release OpenReader to the App Store

## Readiness gate

When the owner asks to increase the release version, for example
`发布版本+0.0.1`, apply the requested increment, upload the three-copy set and
submit its formal copy for App Store review. This request is the explicit
upload and submission decision; do not ask again which stage to reach. Keep
manual release and treat public testing as a separate decision.

Proceed only for an explicit owner upload or submission request, after current
source, Apple identities, signing and group routing pass the checks below. The
three-role pipeline has local native/UI acceptance; that is not permission
to upload or proof of App Store processing. ADR 0083's pair recipe is historical.

For already accepted app source, release identity preparation reuses the
existing functional acceptance. Version/Build Number edits, Beta removal and
selection of the existing roles use the source, configuration, signing,
artifact and Apple-state checks below. They do not start the app-change
installer/tester pipeline, new simulator delivery, StoreKit testing, Provider
setup or a live reading. Retain accepted metadata and screenshots, changing
only what the requested publication needs. If missing acceptance or a new
problem requires more verification, explain the gap and agree its scope
before starting it.

The requested upload/submission also authorizes its necessary identity
commit, `main`/tag pushes and release records. Complete those actions without
asking again whether to continue. Ask when a new owner decision changes the
scope; uploading alone still authorizes no submission, public testing or
App Store release. Keep the three-copy Upload Set and exact formal-build
selection rules below.

## Prepare and upload

1. **Fix the identities.** Read [ADR 0086](adr/0086-three-copies-for-three-recipients.md)
   for roles, numbering and the owner's next planned set. Check
   [confirmed uploads](versions.md) and live App Store Connect for used numbers
   and the Version's state. Only the owner changes the Version; if it is
   already released (ITMS-90186), stop and ask for the next one, recommending
   the next patch.
2. **Verify the source.** Confirm the accepted app source and reuse its passing
   unit, type, lint and functional evidence when app/dependency/native inputs
   are unchanged apart from the release identity. Drop the Beta, commit and
   push the upload identity on `main`;
   change package/lockfile Version only when the owner names it. Require a clean
   checkout equal to `origin/main`, then record `RELEASE_COMMIT=$(git rev-parse HEAD)`.
   All three archives come from that SHA. Use locked dependencies and check
   all three roles' release configuration before building.
3. **Know where the copies go.** Internal `owner` receives every copy as soon
   as Apple processes it; that setting cannot be turned off, and the owner
   installs the Debug copy from TestFlight by hand. External `public` receives
   a build only when one is added to it. For signing/API/group setup, read
   [App Store Connect reference](app-store-connect.md) before starting
   [the archive/upload branch](build-app-store-copies.md), whose export step
   uploads.
4. **Build, inspect and upload formal → free test → Debug.** Follow that branch
   with a fresh native tree and matching role at every step. Inspect actual
   native/embedded identity and purchase presence before exporting. Read each
   accepted build and its processing state from Apple, and label each one's
   What to Test with its role and permitted use. Public testing
   remains separately approved. On partial failure, stop, record/report below
   and ask the owner whether to retry or rebuild; preserve identities/roles.
5. **Tag the complete set.** After all three are verified and processed, check
   `git show "${RELEASE_COMMIT}:src/build/app-version.ts"` has the uploaded identity and no
   Beta. Annotate `X.Y.Z(N+2)` with all three identities, explicitly targeting
   `"$RELEASE_COMMIT"`, never defaulting to a later HEAD. Verify its resolved
   commit equals that SHA; recover the actual upload SHA rather than guessing.
   Earlier/pushed tags stay unchanged. Push the completed set's tag under the
   release request's authorization.

## Record and report — required after every attempt

6. **Update only confirmed uploads.** [versions.md](versions.md) contains only a
   table: add a row after Apple confirms that upload, including actual role,
   purchases, Debug Mode, distribution, processing state and source commit.
   Until its first confirmed entry, leave the empty template unchanged.
   Preserve confirmed rows even if later processing fails. Plans and failed
   uploads belong in the owner receipt and run notes, not this ledger.
7. **Send the owner an explicit table for every attempted copy**, successful or
   failed, containing:
   - exact `X.Y.Z (N)` and formal/free/Debug identity;
   - purchase presence, Debug Mode and permitted channel;
   - observed upload/processing state and TestFlight group/App Store review state;
   - source commit and any incomplete-set or artifact-mismatch warning.

   End by naming the **one exact formal build eligible for App Store review**
   and the free/Debug builds as **never for App Store review or release**.
   If verification is incomplete, say no build is cleared for submission.
   Completion requires the receipt and confirmed ledger rows to match the
   artifacts and Apple's answers; “all uploaded” or “choose the latest” fails
   that check. Uploading alone authorizes no public testing, submission or release.

## Publish only on the owner's explicit decision

- **Public testing:** use the free copy; TestFlight Beta App Review is separate
  from App Store version review. Keep Debug internal-only.
- **App Store submission:** read [metadata and review](app-store-connect.md#metadata-and-review)
  for fields, screenshots, the review key and reuse of review-flow evidence.
  Select the exact formal build from the confirmed ledger and recheck
  the Draft Submission. A newer free/Debug build is not a substitute.
- **Release:** preserve manual release; the owner decides when to publish.
- **Public link or README badges:** read [badge diagnostics](testflight-badge.md)
  when checking what testers can install or changing installation badges.
