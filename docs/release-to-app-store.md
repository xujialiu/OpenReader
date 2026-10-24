# Release OpenReader to the App Store

## Readiness gate

**Uploads are blocked pending native/UI verification of #324.** The three-role
implementation and host bundle/native-resolution checks exist; compiled
artifact and simulator acceptance are still required. The superseded pair
recipe in ADR 0083 is historical evidence, not a fallback.

## Prepare and upload

1. **Fix the identities.** Read [ADR 0086](adr/0086-three-copies-for-three-recipients.md)
   for roles, numbering and the owner's next planned set. Check
   [confirmed uploads](versions.md) and live App Store Connect for used numbers
   and the Version's state. Only the owner changes the Version; if it is
   already released (ITMS-90186), stop and ask for the next one, recommending
   the next patch.
2. **Verify the source.** Drop the Beta and commit the upload identity on `main`;
   change package/lockfile Version only when the owner names it. Require a clean
   checkout equal to `origin/main`, then record `RELEASE_COMMIT=$(git rev-parse HEAD)`.
   All three archives come from that SHA. Run dependencies, unit, type, lint
   and configuration checks before building.
3. **Gate distribution before exporting.** Verify internal `owner` no longer
   automatically receives every upload; only Debug is delivered there by
   default. Resolve this before starting
   [the archive/upload branch](build-app-store-copies.md), whose export step
   uploads. For signing/API/group setup, read
   [App Store Connect reference](app-store-connect.md).
4. **Build, inspect and upload formal → free test → Debug.** Follow that branch
   with a fresh native tree and matching role at every step. Inspect actual
   native/embedded identity and purchase presence before exporting. Read each
   accepted build and its processing state from Apple; label What to Test,
   then assign the processed Debug copy to internal `owner`. Public testing
   remains separately approved. On partial failure, stop, record/report below
   and ask the owner whether to retry or rebuild; preserve identities/roles.
5. **Tag the complete set.** After all three are verified and processed, check
   `git show "${RELEASE_COMMIT}:app-version.ts"` has the uploaded identity and no
   Beta. Annotate `X.Y.Z(N+2)` with all three identities, explicitly targeting
   `"$RELEASE_COMMIT"`, never defaulting to a later HEAD. Verify its resolved
   commit equals that SHA; recover the actual upload SHA rather than guessing.
   Earlier/pushed tags stay unchanged. Ask before pushing `main` or tags.

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
  before preparing fields, screenshots, the review key and fresh-install review
  steps. Select the exact formal build from the confirmed ledger and recheck
  the Draft Submission. A newer free/Debug build is not a substitute.
- **Release:** preserve manual release; the owner decides when to publish.
- **Public link or README badges:** read [badge diagnostics](testflight-badge.md)
  when checking what testers can install or changing installation badges.
