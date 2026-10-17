# Verifying the source-bound cache, the restore seams and the refused remote Play (1.0.0 (8)-beta20, 2026-10-17)

Record of the iOS verification of the #162/#163/#164/#230 working tree, on the
session's iPhone 17 Pro (iOS 26.5, UDID `19A488E2-…`, the only iPhone the
machine had; iOS 27.0 runtimes had no phone), from its own Metro (port 8082)
after a guarded `expo prebuild` + full native rebuild (native `1.0.0 (8)`, the
new `snapshot`/`sync` seam in the binary; a Metro reload cannot update them).
The controlled provider was the kit's fake Kokoro on 127.0.0.1:8880; every play
was preceded by `silence.sh check` chained with `&&`, and stopped once the fact
was measured. Fake-store faults are the pretend App Store's controls, not live
StoreKit results.

- **The rebuilt native `snapshot` is callable and answers the documented shape
  with no identifiers.** With `{"do":"store","use":"real"}` (inspection only; no
  purchase attempted), `expo.modules.OpenReaderStore.snapshot([trial, unlock])`
  answered `{source: null, owned: [], revoked: []}` twice identically, and
  `environment()` answered `"unavailable"` (the simulator's StoreKit has no
  account and `simctl launch` uses no `.storekit` configuration). The probe
  recorded only booleans and product ids — never `appTransactionID`.
- **Verification unavailable is not an expired Trial.** `{"do":"store",
  "verification":"unavailable"}` with the price loaded (`$4.99`) reported
  `access={"kind":"unavailable"} allows=false`; the Settings row read
  `Purchase, Unavailable`; the Purchase page kept **Restore Purchase** and the
  footnote "Your purchase could not be verified. Try again or restore your
  purchase." with **no** Start Free Trial and **no** Unlock row, in both themes.
  A Play raised that same explanation, sent no synthesis (12 → 12 requests) and
  played nothing; `{"do":"store","verification":"available"}` recovered the same
  fake Unlock with no purchase.
- **The legacy unversioned record authorizes nothing.** With `use=real`, a
  relaunch against a hand-written `purchase.json` of the old shape
  (`{"unlocked":true,…}`) logged `owned: unlocked false, trial began never`,
  and the UI read `Purchase` → Start Free Trial (`not-started`), not Unlocked.
  The injected file was removed afterwards; no other app data was touched.
- **Restore distinguishes cancelled from restored at the app layer (#164).**
  From the Purchase page with `restoreOutcome=failed`: "Purchases Unavailable /
  The App Store can't be reached right now.", never "No Purchase Found". From
  the ended alert: the same failure alert and nothing played; `cancelled`: no
  second alert, nothing played, the row stayed `Trial ended`; `restored`: "No
  Purchase Found / There's no purchase to restore for this Apple Account." from
  the alert and the page. Synthesis stayed 12 → 12 across all of them. The
  production classifier itself: `xcrun swiftc modules/open-reader-store/ios/
  StoreRestore.swift test/purchase/store-restore.swift -o …` and the binary
  print `StoreRestore: 7 cases passed; no StoreKit request made`.
- **A remote Play is refused while the ended alert stands unanswered (#163).**
  Control first: consent answered for 127.0.0.1:8880, a real Play reached it
  (`text=` lines, `playing=true … level=word`), a real Pause left the Now
  Playing card paused. Then `state=ended`, Play in the Reader, the ended alert
  left unanswered, `lock-device.sh lock`, and (after `silence.sh check`)
  `play-refused`. The `lock` and this first `play-refused` attempt ran as
  bounded bare commands before the parent's steering; the steering then required
  the guard, and every later build/XCTest run (the rerun's `play-refused`,
  `unlock`, `LockScreenProbe`) went through `kit/ios_guard.py`. The first
  attempt **failed before any tap** — iOS 26.5's centre button has no
  `CenterButton` identifier (`Executed 1 test, with 2 failures in 6.493`, then
  the documented `simctl diagnose` hang, killed) — so it is evidence that the
  lookup failed, **not** evidence of a refusal: no remote command reached the
  app and no refusal line exists from that run. The refusal evidence is the
  guarded 19:58 rerun's alone: tap at 1792238286.98, `Pause` when the tap
  returned, **`Play` 2 s later**, `Executed 1 test, with 0 failures in 3.222`;
  `unlock` passed; `LockScreenProbe/testLockScreen` (supplementary) read the
  centre button `label: Play, enabled` centred on the card, `Executed 1 test,
  with 0 failures`. The Debug Log has `remote command=play playing=false`,
  `play while read-aloud is locked: asking (#148)`, `read-aloud still locked:
  nothing plays`, `playing=false app=background` throughout, and the fake
  server's count did not move (18 → 18). The alert was still up after the
  unlock. The unlocked control then reached the provider again (18 → 21) and
  was paused. The locator fix and the failed run are kept in
  `../pitfalls/lock-and-background.md`.
- **A Download start is denied with the Trial over (#163).** With `state=ended`
  and two chapters selected, `Download selected (2)` raised the ended alert and
  sent nothing (21 → 21).
- **A paused Download's denied Resume all and its explicit resume, observed
  (follow-up the same day, fake Kokoro restarted at
  `OPENREADER_FAKE_TTS_DELAY_MS=1500`, Kokoro's Sentences at once 1, saved
  audio deleted and a noop relaunch to clear memory clips).** The download ran
  against the delayed server (fresh-run count 44 → 67, requests ~1.6 s apart);
  a real-touch **Pause all** in the drawer left it paused with work remaining
  (First Chapter 5/10, Second untouched; count 67 → 68 → 68: the in-flight
  answer settled, then nothing). Under `state=ended`, real-touch **Resume all**
  raised the ended alert (49 → 49 → 49 around the press) and Not Now left it
  paused; under `state=unlocked,verification=unavailable` it raised the
  verification explanation (49 → 49 → 49); after
  `verification=available` nothing auto-resumed for 8 s (still `Resume all`,
  count 49). An explicit **Resume all** then sent new requests (49 → 53, and in
  a fresh single-invocation cycle 68 → 71, logged ~1.6 s apart), and a prompt
  second Pause all stopped it again (73 → 73 stable), leaving a genuinely
  unfinished paused task (1 chapter downloaded, the Second not started). Every
  press was a real coordinate touch with the drawer's link position measured
  from the same invocation's screenshot; every assertion pairs the request
  count with the drawer state (`attempt/shots/29–44` of the follow-up run).
- **The Fish Model list keeps its choices and clears a failed load on a new
  visit (#230).** With `breakfetch … "from":1` armed before the first visit, the
  page logged the refused request shape, showed "Additional Models could not be
  loaded. Reopen this page to try again.", and the Model menu held exactly
  `s2.1-pro-free — free`, `s2.1-pro — paid`, `drama-3 — paid`, `s2-pro — paid`.
  After `unbreakfetch` and a reopen: no stale error, and the menu appended
  `s1 — paid`. No Enable, no API key, GET-only — no provider charges. (The
  first attempt taught `breakfetch`'s `NaN` trap: `../pitfalls/cdp.md`.)

Limits: no real App Store-over-TestFlight transition exists before release, so
production-readiness of the source check is unverified on-device.
`appTransactionID` identifies the app download; nothing here shows that
switching the purchasing Apple Account changes it — account-switch coverage is
**unverified** (the fake store's fixed `pretend-store` source exercises source
isolation, not an identity swap). The live sign-in sheet's exact cancelled
error is covered by the compiled classifier, not by an Apple Account in this
run. Left behind: `use=fake`, unlocked, verification available, restoreOutcome
restored, outcome purchased, `noop` set, Reader open and paused.
