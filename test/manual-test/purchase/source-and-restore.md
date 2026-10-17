# Purchase source and Restore checks (#162, #163, #164)

Use the shared [iOS admission and readiness gate](../kit/ios-verification.md).
Build the current native module: Metro alone cannot update the new `snapshot`
or verified-purchase result. Use a session-owned simulator, Debug Mode and the
[existing harness](README.md#driving-it-through-the-harness). Keep every fault
separate from the normal control, and stop speech immediately after measuring.

## Unavailable verification

1. Set the pretend store to `{"do":"store","state":"unlocked","verification":"available"}`.
   Confirm the settled report says `access={"kind":"unlocked"}` and `allows=true`.
2. Set `{"do":"store","verification":"unavailable"}`. Confirm
   `access={"kind":"unavailable"}` and `allows=false`, not Trial ended.
3. Open Settings → Purchase. It shows the verification explanation and Restore
   Purchase, not Start Free Trial or another Unlock offer. Verify both themes.
4. A Play or Download started in this state raises Purchases Unavailable with
   the verification explanation, sends no synthesis request and starts no audio.
5. Set `{"do":"store","verification":"available"}`. The same fake store
   still owns its Unlock. Confirm the state recovers without another purchase.

This drives the real controller/UI but doubles StoreKit. The source-bound file,
legacy-cache rebuild and return between sources are exercised by
`test/app/purchase-source.test.ts`; the fake store's fallback is memory-only.
Do not label these UI checks a real production/sandbox transition.

## Restore failure and cancellation

1. Set `{"do":"store","state":"ended","verification":"available","restoreOutcome":"failed"}`.
2. From Settings → Purchase, press Restore Purchase. The app shows Purchases
   Unavailable, not No Purchase Found. Dismiss it.
3. With a playable Document selected, press Play, then Restore Purchase in the
   ended-Trial alert. The same failure alert follows; nothing plays.
4. Repeat with `"restoreOutcome":"cancelled"`: no second alert, no playback,
   Trial still ended. Repeat with `"restoreOutcome":"restored"`: No Purchase
   Found, since this fake store owns no Unlock.

The actual Swift cancellation classifier can be exercised without an Apple
Account, a simulator or a network request:

```sh
xcrun swiftc modules/open-reader-store/ios/StoreRestore.swift \
  test/purchase/store-restore.swift -o /tmp/openreader-store-restore-test
/tmp/openreader-store-restore-test
```

Expected: `StoreRestore: 7 cases passed; no StoreKit request made`. This uses
the production classifier with real StoreKit error types; it does not prove
which error a live sign-in sheet emits on a particular device.

## Lock Screen while the ended alert is unanswered

1. Establish a working playback control, then pause with Now Playing present.
2. Set the fake store to `ended` with products and verification available.
3. Press Play in the Reader and leave the ended-Trial alert unanswered.
4. Lock the simulator. Check silence immediately before a remote Play, then
   use `kit/lock-device.sh SIMULATOR_UDID play-refused`. The button must return
   to Play, with no audio and no new Provider request, while the foreground
   alert remains unanswered. Retain the raw XCTest execution summary.
5. Unlock, dismiss the alert and restore the fake Unlock. Verify a short normal
   Play still reaches the controlled Provider, then pause.

Use `play-refused`, not the kit's `play` action, for a refused press. A system
button that turns to Pause immediately after tapping does not prove playback.

## StoreKit and account limits

A real `"use":"real"` check should confirm the rebuilt native snapshot can
be read without logging `appTransactionID`. Do not purchase on the owner's real
account or change their account for this run. No production app is available
before release, so a simulator is not an App Store-over-TestFlight test.
Apple documents `appTransactionID` as the app-download identity. Changing it in
a test establishes source isolation, not that switching the purchasing Apple
Account changes it. Report this separately rather than declaring account
handoff verified.

Finish with `"use":"fake"`, then
`{"do":"store","state":"unlocked","verification":"available","restoreOutcome":"restored","outcome":"purchased"}`,
clear the replayed harness command with `{"do":"noop"}`, and leave playback
stopped. Under finish-worktree, the parent releases the verified delivery.
