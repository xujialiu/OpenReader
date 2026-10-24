# Release OpenReader to the App Store

## Readiness gate

**Uploads are blocked:** #324's three-copy build configuration, native purchase
exclusion and build procedure are not yet implemented or verified. Complete
that migration before archiving. The superseded pair recipe is historical
evidence in ADR 0083, not a fallback.

## Prepare and upload

1. **Fix the identities.** Read [ADR 0086](adr/0086-three-copies-for-three-recipients.md)
   for roles, numbering and the owner's next planned set. Check
   [confirmed uploads](versions.md) and live App Store Connect for used numbers
   and the Version's state. Only the owner changes the Version; if it is
   already released (ITMS-90186), stop and ask for the next one, recommending
   the next patch.
2. **Verify the source.** All three copies come from one clean commit on `main`,
   with HEAD equal to `origin/main`. Run `npm ci`, the unit tests, TypeScript,
   ESLint and configuration checks. Drop the Beta for uploads; change
   `package.json`/lockfile only when the owner names a new Version.
3. **Build and inspect each artifact.** Use the verified three-variant procedure
   required by the readiness gate, starting each archive with
   `npx expo prebuild --platform ios --clean`. Check for competing Xcode builds;
   use separate DerivedData for concurrent work. Verify native Version/Build
   Number, Settings suffix, Debug Mode and actual purchase-module inclusion
   against the role before exporting. An unlocked flag alone does not prove
   the purchase module is absent. For signing/setup, read
   [App Store Connect reference](app-store-connect.md#identity-and-signing).
4. **Upload formal → free test → Debug.** Verify internal `owner` delivers only
   Debug by default before the first upload. Check each accepted upload in
   Apple, its processing state, What to Test role label and group assignments.
   Only the free copy may go to `public`; Debug stays internal. On any partial
   failure, stop and do the record/receipt steps below, then ask the owner to
   choose retry or rebuild. Keep identities and roles unchanged.
5. **Tag the complete set.** Once all three are verified and processed, create
   one annotated `X.Y.Z(N+2)` tag on their common commit, naming all three in
   its message. Earlier tags stay unchanged. Ask before pushing `main` or tags.

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
