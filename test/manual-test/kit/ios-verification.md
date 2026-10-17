# One bounded iOS verification phase

Use one heavy simulator/build/XCTest lane on the Mac, across worktrees. The
shared guard is cooperative: a direct MCP build or bare `xcodebuild` bypasses
it. Use the tool's CLI equivalent inside the guard instead. Before adopting
this entry in an ongoing session, inspect existing builds/probes; let an older,
unguarded run finish rather than starting beside it or killing its processes.
Ordinary host tests can run in parallel.

## Admission and ownership

```sh
python3 test/manual-test/kit/ios_guard.py run --wait 900 --timeout 1200 \
  --record /tmp/THIS-RUN/phase.json -- bash /tmp/THIS-RUN/verify-phase.sh
```

The command must be a foreground script for a whole phase, not one admission
per individual tool call. Put its build, readiness checks and measurements
inside it. Pick the deadline from that phase's work. Start persistent Metro or
fixture servers separately, record their PIDs/cwds/ports, and clean them at the
end of the session; the guard terminates leftover children even on success.

The default admission wait is zero (exit 75 when busy). A bounded wait prints
the holder once. The lock is per macOS user at
`~/Library/Caches/OpenReader/ios-verification.lock`, independent of the cwd.
Nested guards accept the inherited token only from a descendant of the holder;
copying the token to another terminal does not grant admission. The kernel
releases the lock when its owner exits. Keep the lock file itself: deleting its
inode while another caller waits could split the lock into two independent ones.

The guard creates and records the command's process group. On a deadline or
SIGINT/SIGTERM it snapshots descendants, including nested groups, sends TERM,
then KILL after a grace period, before releasing the slot. Normal completion
also removes leftover background children. This is not a daemon supervisor:
commands must not double-fork/detach themselves. SIGKILL or host failure cannot
run cleanup; inspect the recorded PIDs before restarting after either. The
records omit command arguments so credentials are not copied into them.

## Readiness before acceptance

Use a session-owned, already-booted simulator on a non-secret screen. A runtime
still being verified is not a healthy device. Let the system finish its work;
this tool neither installs runtimes nor changes Gatekeeper/quarantine settings.

```sh
python3 test/manual-test/kit/ios_ready.py SIMULATOR_UDID /tmp/THIS-RUN/readiness \
  --timeout 20 --metro http://127.0.0.1:METRO_PORT
```

This checks device availability/state, boot completion, a real PNG screenshot,
and, with `--metro`, a specific answer from the selected OpenReader Debug
connection. It selects that simulator's name, and the existing CDP tool refuses
ambiguous targets. Omit Metro only for native-only probes or before the app is
installed/launched; that does not establish app readiness. Each subprocess has
its own deadline and raw log/JSON record. A health check never plays audio.

An environment failure is **BLOCKED**, not a failed app assertion. If there is
a specific reason a single recovery would help, supply an owned-device script:

```sh
python3 test/manual-test/kit/ios_ready.py SIMULATOR_UDID /tmp/THIS-RUN/readiness \
  --metro http://127.0.0.1:METRO_PORT --recover-script /tmp/THIS-RUN/recover-once.sh
```

The script receives the UDID and attempt directory. It must act only on that
session's device, never erase it or alter another run. Recovery is recorded
**before** invocation, has a separate 120-second default budget, and is followed
by one health recheck. A failed or cancelled recovery still spends the attempt.
Reuse the same directory for the whole verification attempt; creating a fresh
one to reset the count is not another permitted recovery. If still unhealthy,
return BLOCKED with artifacts. An application assertion failure is not a reason
to reboot or increase waits without evidence.

## XCTest entry

`run-probe.sh` acquires the slot automatically and retains it through setup,
build, test, result export and failure cleanup. It checks native readiness and
silence first. For a Debug app phase also run the Metro readiness check above.

- `OPENREADER_PROBE_BUILD_SECONDS` defaults to 1200: a cold probe build has
  previously taken about 15 minutes. It bounds `build-for-testing`.
- `OPENREADER_PROBE_TEST_SECONDS` defaults to 180 for ordinary short probes.
  Long-running background/timing tests must explicitly declare their budget.
  It bounds `test-without-building`, including Xcode's diagnostic collection.
- `OPENREADER_IOS_WAIT_SECONDS` bounds admission, default 0.

Each phase has a log and JSON exit record. A test directory alone is not a
completed result: attachment export requires its `Info.plist` and a readable
`xcresulttool` test summary. Success also requires a Passed summary with actual
passed tests, zero failed tests, and matching zero-failure execution lines. Partial bundles/logs are kept.
On failure the runner makes a bounded attempt to terminate only the selected
target app, so a test cannot quietly leave it playing. Check the cleanup log;
reopen/reverify the final app before delivery if this path ran.

Exit codes: 0 passed; 2 usage/setup; 69 readiness/incomplete result; 75 busy;
124 deadline; 130/143 cancellation; other nonzero codes preserve the child
failure. Never interpret a deadline, an empty result or a screenshot alone as
passed. Stop playback as soon as a playback measurement establishes its fact.

Host-only regression tests run through `npm test` in `test/scripts/ios-guards.test.ts`.
They use isolated homes, real locks/processes and fake Apple tools. They cannot
prove runtime health or native UI behavior.
