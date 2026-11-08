# Mac M7: hold delivery of a real lookup response (#355)

**Preparation, not native PASS.** This channel runs in the app runtime of a
standalone Release with **Debug Mode**, without CDP/Hermes inspection. The
walkthrough `js` command still runs only in the reader WebView; do not use it
or `lookup-fetch-gate-*.js` to intercept the Mac app's lookup fetch. The existing
[Duo coordinator](duo-pending-lookup.cjs) remains CDP-only and is not a Mac
coordinator. No general app-runtime evaluator, listener, server or remote
endpoint has been added.

Read [Mac admission/M0–M7](platforms.md), [Mac installation rules](../../../MEMORY/mac-install.md),
[installation guide](../../../docs/install-on-mac.md), [device rules](../../../MEMORY/device-testing.md)
and the [manual-test kit](../README.md). Only the parent-admitted ios-tester
operates the one native lane. This recipe authorizes no installation, launch,
replacement, build, signing change, playback, purchase or Consent bypass. The
parent chooses the Beta and stable source and preserves the whole container
and old Debug Log again before the authorized replacement. A current Settings
Version and bundle/source receipt are required; an old standalone copy ignores
these new commands and is **BLOCKED**, not a failed app lookup.

## Exact command and status schema

The existing Debug-only 250 ms `Documents/harness.json` poll handles:

```json
{"seq":1794090813387150,"do":"lookupgate","action":"hold","run":"mac-m7-UNIQUE","service":"free-dictionary"}
{"seq":1794090813387151,"do":"lookupgate","action":"state","run":"mac-m7-UNIQUE"}
{"seq":1794090813387152,"do":"lookupgate","action":"release","run":"mac-m7-UNIQUE"}
{"seq":1794090813387153,"do":"lookupgate","action":"restore","run":"mac-m7-UNIQUE"}
```

**These sequence numbers illustrate the schema, not numbers to send.** The old
Mac consumed floor `1794090813387149` is historical. Establish the fresh highest
known consumed/persisted sequence before the later run. Use the sender below,
which takes the maximum of that floor, retained sender sequence, existing
harness sequence and `Date.now() * 1000`, then adds one within JavaScript's safe
integer range. Never reset a running app's seen sequence by deleting a file.

`run` is 1–64 ASCII letters/digits/underscore/hyphen. Only the five named fields
are accepted; `service` is required for hold and absent for other actions.
Multiple mounted pollers consume each gate sequence **once globally**; older
or repeated gate sequences are ignored. An active gate or another fetch hook
makes hold fail. Wrong run/action/service/fields and a release with no held
response fail truthfully. `breakfetch`/`watchfetch` refuse installation while a
gate is active. `unbreakfetch` cancels it and restores the original fetch.

The initial allowlist is only the actual credential-free **English → English
Free Dictionary API GET**, exact origin `https://api.dictionaryapi.dev` and
`/api/v2/entries/en/ONE_ENCODED_PATH_SEGMENT`, without user info/query/fragment.
Every matching request counts, including another word or a same-URL duplicate.
Other dictionaries (including Youdao), Text Translation, Providers, sync,
pronunciation and POSTs are **not observed or gated**. A Youdao control does
not qualify this M7 attempt; select the existing English → English direction
through legitimate settings and restore the original choice afterwards. Do
not change a Provider or manufacture Consent just to fit this channel.

Immediately after commands and request transitions, the app synchronously
writes one bounded `Documents/lookup-gate-status.json`, independent of the
Debug Log's two-second batch:

```text
version: 1
observedAt: app epoch milliseconds at this write
command: { seq, action, run, ok, error, released }
gate: null, or {
  run, service: "free-dictionary", installed, installedAt, expiresAt,
  count, pending, held, overflow, stoppedBy,
  requests: [{ id, query, state, startedAt, deadlineAt, heldAt, releasedAt, abortedAt }]
}
```

`query` is only a bounded ordinary English word (80 characters at most), or
null; non-word, long or malformed queries still count without retaining their
text. No URL, response text, body, headers, credentials, keys, surrounding
Document text or exception string enters this status. Metadata is bounded to
64 records; a 65th request increments count, marks overflow and cancels the
control. There is no history file or per-frame logging. The retained status
is test metadata, not a result/visibility probe. Formal/free roles never poll
this command, construct its files, start its timers or install its wrapper;
Debug Mode remains the compiled role, not a runtime setting or `__DEV__`.

Request states are `requested → held → released`, or
`aborted`/`deadline`/`cancelled`/`failed`. Hold does **not** delay starting the
network: `heldAt` is set only after the original fetch resolves with its real
Response. The gate does not consume, clone, replace or synthesize that Response
or its body. Release resolves that exact object and the ordinary adapter then
parses it. Caller-owned cancellation still reaches a streaming body after
release; restoring the gate does not cancel an already delivered body. Request
signal inheritance follows the installed fetch polyfill: undefined or null
`init.signal` inherits the Request's signal; an actual signal overrides it.

A pending caller abort cancels the whole control and restores fetch. Explicit
restore/unbreakfetch cancel pending/held delivery with the standard AbortError
rather than reporting a successful release. Real fetch failures retain their
real rejection to the caller but not in status. Every pending request has a
fixed **12 s delivery deadline from its own start**, with a wall-clock check
as well as a timer; failure cancels pending fetches and restores the original.
The app's actual **15 s Lookup timeout is unchanged**. The gate also expires
120 s after installation, even with no selection, and restores on final harness
unmount, overflow or status-write failure. Counts remain active after release
until restore/expiry, so a post-resize duplicate is not silently missed. A
replacement observer detected during a state/command read invalidates the
control as `observer-changed`; no stacking is accepted. Cleanup cancels owned
pending work but restores global fetch only while it is still this gate's
wrapper. A foreign replacement survives state, cleanup and a refused new hold;
an inactive old gate cannot erase a newer hook. Legacy `unbreakfetch` retains
its separate unconditional original-fetch restoration contract.

## Atomic monotone Mac sender (test files only)

`lookup-gate.cjs` reads/writes only the explicitly named harness/status and
private sender-sequence files. It uses atomic Node file replacement for sends,
retains spent sequence numbers even on failure, refuses concurrent senders for
the same Documents directory, checks fresh matching acknowledgements, and
leaves a new monotone **noop** after each command to prevent mount/launch replay.
Keep the private sequence file across commands and deleted harness files.

```sh
# Run only in the admitted Mac lane, against its verified authorized container.
DOCS="$HOME/Library/Containers/top.xujialiu.openreader/Data/Documents"
SEQ="$ATTEMPT/lookup-gate-sequence.json"  # private, outside Git; keep it
FLOOR=1794090813387149                  # REPLACE with fresh verified floor
RUN=mac-m7-UNIQUE                       # fresh safe token, at most 64 chars
GATE=test/manual-test/duo-verification/lookup-gate.cjs

node "$GATE" "$DOCS" "$SEQ" "$FLOOR" "$RUN" hold > "$ATTEMPT/gate-hold.json"
node "$GATE" "$DOCS" "$SEQ" "$FLOOR" "$RUN" wait-held > "$ATTEMPT/gate-held.json"
node "$GATE" "$DOCS" "$SEQ" "$FLOOR" "$RUN" state > "$ATTEMPT/gate-after-width.json"
node "$GATE" "$DOCS" "$SEQ" "$FLOOR" "$RUN" release > "$ATTEMPT/gate-release.json"
node "$GATE" "$DOCS" "$SEQ" "$FLOOR" "$RUN" restore > "$ATTEMPT/gate-restore.json"
```

These are the individual protocol calls, **not** a native test when pasted
back-to-back: the real selection and width input must occur between them as
below. `wait-held` reads unsolicited transition status without sending another
command or waiting for a Debug Log flush. It refuses a duplicate, abort, stopped
gate or first held response already ≥2.5 s old. Release refuses locally at
≥11 s to leave one poll/readback margin below the 12 s deadline; the app makes
the authoritative timely-release check. Each sent command has a 2 s fresh-ack
bound, not a mandatory 2 s sleep. A complete matching receipt with
`command.ok=false,error=null` is provisional: restore can publish its transition
before finalizing the command. The sender keeps polling within the same bound
until success or an explicit non-null error; explicit refusals fail immediately.
Exit 2 is **BLOCKED**, never native PASS.

Install a coordinator `finally`/EXIT cleanup **before** sending hold. It must
always send restore and require `installed=false,pending=0`; a failed cleanup
overrides any apparent pass as BLOCKED. Do not delete the retained sequence to
recover. The helper's noop is not restoration: the gate remains active across
commands by design. Its bounded fallback is not a substitute for acknowledged
cleanup. Remove only this run's test status/command after retaining receipts
and verifying ownership; keep the sequence/floor record. Preserve any failed
input or acknowledgement, not just the final successful attempt.

## Native M7 handoff: real response, real width, final visible definition

1. First requalify the working M6 normal request/visible-definition control on
   the final stable candidate. Use a public disposable fixture, the existing
   Word Lookup controls, legitimate Free Dictionary API Consent, and a real
   native selection. Establish the exact query/range/paint and successful
   definition; do not infer service success from a spinner or source review.
   Close/reset the lookup and selection through existing native controls.
   Stage the active/key app window, real width-drag coordinates and fast,
   PID/window-scoped native bounds measurements **before arming** the gate.
   No full capture, tool compilation, permissions prompt or calibration belongs
   in the timed pending-response loop. Keep the app paused; no pronunciation.
2. Send hold and require its fresh successful acknowledgement. Signal the
   already-prepared native selection driver, then immediately `wait-held`.
   Require `count=1,pending=1,held=1`, the expected service/query, and a real
   `startedAt <= heldAt`, all error/abort/release fields still clear. Native
   before evidence must show the same Lookup Drawer loading; a gate alone does
   not prove a visible pending lookup. If delivery/capture is too slow, stop
   BLOCKED and restore rather than modifying the app timeout or response.
3. Deliver **one real OS window width change**, not DOM/RN geometry mutation.
   Require actual changed target-window bounds, unchanged app/window identity,
   and independently settled page geometry/selection using the admitted native
   measurement route. Budget the fast native input/bounds/control observation
   to finish by **9 s from request start**, leaving state/readback/release
   margin. The existing M1 eight-second settle is a maximum, not time to spend
   in full here; full screenshot/AX tree calls can exhaust M7's whole deadline.
   If the selected driver cannot establish the pending real-width observation
   in that budget, M7 is BLOCKED. Dispatch success alone is not width evidence.
4. Send state, retain its fresh post-width receipt and require the same single
   request still held, no release/abort/duplicate/overflow. Send release
   immediately; require `command.ok=true,released=1` and
   `startedAt <= heldAt <= releasedAt < deadlineAt` for the same request. A gate
   deadline or an AbortError is an invalid control, not continuity acceptance.
5. Keep observing while the wrapper still counts. Through the admitted native
   UI read/capture route, assert the **same** Drawer/query and actual visible
   parsed definition from the real response, loading finished, and no error.
   Capture the selected passage/affordances and current real width. The Mac has
   no CDP `DuoAcceptanceLookupState` route: do not fabricate React/result state
   or insert response text into this privacy-bounded gate status. Use native
   visible definition/tree evidence and the existing read-only WebView range
   probe as supporting selection evidence, not proof of definition pixels.
   A spinner screenshot, unread Response, release count or returned HTTP status
   alone is insufficient. Take a fresh final state while still counting and
   require exactly one released request, no abort/duplicate, then restore in
   finally and require the restoration receipt.
6. Parent review links the source/Settings receipt, normal M6 control, actual
   request start/hold/release times, native width-change input and measurements,
   pending-state observations, final definition/selection images and final
   request count. Report timing and native assertions separately. Restore only
   admitted Lookup settings/fixture/Tap Lock changes and leave the authorized
   app current, open and paused. M7 completion does not establish audio,
   Following, arbitrary services, endpoint-extension semantics or other cases.

## Host validation and limits

```sh
npx vitest run test/app/walkthrough-lookup-gate.test.ts \
  test/manual-test/duo-verification/lookup-gate.test.ts
npm run typecheck
npx eslint src/app/walkthrough-harness.ts src/app/walkthrough-lookup-gate.ts \
  test/app/walkthrough-lookup-gate.test.ts \
  test/manual-test/duo-verification/lookup-gate.cjs \
  test/manual-test/duo-verification/lookup-gate.test.ts
```

The first test runs the real multi-poller harness, Lookup hook, Consent and
service parser over fake fetch/File/AppState/renderer input. It was red before
the command existed, then green for already-received delivery across a HOST
layout rerender, original Response/body parsing, duplicates, exclusions,
abort/deadline/failure/unbreak/unmount cleanup and formal/free role inactivity.
The second uses actual temporary HOST files with fake app acknowledgements,
not an installed app. Neither establishes native selection, width change,
visible definitions, Expo File propagation latency or Mac runtime acceptance.

Protocol pitfalls remain explicit: `File.write` status readback is not an
atomic storage guarantee, so readers retry missing/partial JSON and require the
fresh seq/run/action/time; they never accept an old status as recovery. Atomic
command replacement alone does not prove the standalone app consumed it. The
status bypass removes the Debug Log flush delay but its actual Mac latency and
the native timed choreography must still be measured by ios-tester. No native
call, build/install, owner container access or audio operation was performed
while preparing this addition. #355 stays open for parent acceptance.
