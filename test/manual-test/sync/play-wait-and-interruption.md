# A press of Play made visible, and an interruption honoured (#304, #303)

Verifying b8325b9 (`1.0.0 (9)-beta11`) on the simulator, 2026-10-20. The app is
the worktree's own Debug build, connected to Metro on 8081, on the session's
iPhone 17 Pro (iOS 26.5, `19A488E2-455A-42C2-A17C-BF8AA851FC78`). Artifacts:
`/tmp/ios-check-b11/`.

## Phase 0 — admission, readiness, build

- `ios_guard.py run` admitted the phase (record `phase0.json`); the guarded
  script (`/tmp/ios-check-b11/verify-phase0.sh`, log `phase0.log`) silenced the
  simulator, ran `npx expo prebuild --platform ios` (the worktree has no
  committed `ios/`), built Debug with `xcodebuild` (rc=0), installed over the
  existing app and launched. Build 206 s wall.
- `ios_ready.py --metro` passed. The first run inside the phase script answered
  `BLOCKED: CDP failed` because it ran the instant `simctl launch` returned,
  before the app had bundled from Metro (`iOS Bundled 936ms index.ts (1614
  modules)` came seconds later); the immediate recheck passed with no recovery.
  See Pitfalls.
- Settings shows `Version 1.0.0 (9)-beta11-debug`
  (`phase0-version.png`, AX tree `StaticText | Version 1.0.0 (9)-beta11-debug`),
  and Metro serves the same string in `index.bundle`.
- Provider and voice: the kit's fake Kokoro (`fake-kokoro.cjs` on
  `127.0.0.1:8795`, log `/tmp/ios-check-b11/fake-tts.log`) with the app's
  carried-over settings — Provider `local`, voice `af_bella`,
  consent already kept for `provider:local@http://127.0.0.1:8795`.
- Consent preflight: after a real touch on Play there was **no alert**
  (`ax.py alert` → `NO ALERT`, exit 1); the kept consent above is the answer a
  previous session gave to the same recipient. The recipient was verified from
  the fake's own log: synthesis requests (`route=kokoro auth=absent`, no
  credentials) and nothing sent anywhere else.
- Working control: Play → `playing=true` (`reading.cjs state`), eight
  synthesis requests fetched in order, utterances advanced to the document's
  end, and the Reading stopped there by itself
  (`"That was the last of this document. The reading has stopped at the end of
  the book."`). The simulator's own volume was 0 for all of it.
