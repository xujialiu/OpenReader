# Unblock a first Play waiting for Consent

Use this when Play shows a spinner but no synthesis starts, or when an automation
read fails while a Consent question may be covering the reader. Waiting longer
cannot answer a question. This is test setup, not a reason to remove the app's
Consent gate.

## Identify the hold before measuring playback

1. After the first Play with a new Provider/address, inspect the native alert
   immediately. If playback has not begun within five seconds, capture the screen
   even when the Reading reports `playing=true` or no note.
2. Use `python3 test/manual-test/kit/ax.py UDID alert`. `NO ALERT` is a successful
   read with no alert; a timeout/error establishes nothing about the screen.
   Save a screenshot independently with `xcrun simctl io UDID screenshot OUT.png`.
3. Check the exact recipient. Allow only the service authorized for this test
   and the intended fixture/document; an unfamiliar endpoint needs the owner's
   decision. Do not seed Consent in settings to pretend the question was tested.

## If AXe or mobilebuildmcp cannot answer it

They can share the same failed remote automation path. If a read and one retry
fail with `Timed out creating the simulator remote automation session`, use
XCTest below instead of cycling between `snapshot_ui`, `describe-ui` and coordinate
taps. On a just-booted simulator the one retry may follow a 25-second readiness
wait. Bound the calls; no minute-by-minute screenshot or Play loop.

Reuse `library-and-reader/ReaderTouchProbe.swift`'s `testAnswerConsent`. It attaches
to the running app, verifies the exact title and answers through the native alert
query. It requires explicit title and answer; no button is approved by default.
For the authorized local fake, substitute its actual port:

```sh
bash test/manual-test/kit/silence.sh set SIMULATOR_UDID && \
TEST_RUNNER_OPENREADER_CONSENT_TITLE='Send text to the server at 127.0.0.1:PORT?' \
TEST_RUNNER_OPENREADER_CONSENT_ANSWER=Allow \
TEST_RUNNER_OPENREADER_CONSENT_PAUSE=1 \
bash test/manual-test/kit/run-probe.sh ReaderTouchProbe SIMULATOR_UDID OUT_DIR \
  -only-testing:testAnswerConsent -test-timeouts-enabled YES \
  -maximum-test-execution-time-allowance 45 -collect-test-diagnostics never
```

Run that command with a 180-second host timeout too: a per-test deadline does not
bound build/runner startup. Retain every failed run. If it cannot start, inspect
the exact owned process and report the setup blocker; do not repeatedly launch
another runner or reset shared simulator services.

## Completion

- The raw log says `Executed 1 test, with 0 failures`, and before/after attachments
  show the intended question gone.
- With `OPENREADER_CONSENT_PAUSE=1`, the native Play button is present at the end.
  A Pause issued while Consent was pending can already have cancelled the Play;
  recovery accepts that paused state and does not start it again.
- Confirm `playing=false` through `reading.cjs state` against the correct
  `OPENREADER_METRO`, or the harness/Debug Log. A timed-out pause is not confirmed.
- Then start the actual scenario afresh with its own silence check, and assert
  speech/text progression. Successful alert recovery is not a chapter-crossing
  or audio test. Keep any deliberately running interval bounded and stop it as
  soon as the fact is established.

If XCTest is unavailable too, use the computer-use skill only with a positively
identified simulator window and fresh controls. Stop at an accessibility/focus
permission blocker rather than sending blind clicks. Report the device, pending
question, last error and next required action to the parent.
