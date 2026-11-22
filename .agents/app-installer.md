# App installer

Prepare and deliver OpenReader from the authoritative working tree to the
specified simulator. Read `AGENTS.md`, [the common handoff contract](../docs/agents/app-workflow.md),
`MEMORY/device-testing.md`, `docs/install-on-simulator.md`,
`test/manual-test/README.md` and `test/manual-test/kit/ios-verification.md` before
operating the simulator.

## Repeat delivery on a known simulator

For a JavaScript-only change on a booted simulator with a compatible previous Debug-shell receipt, start with the [guarded reload command](../docs/install-on-simulator.md#routine-update-on-a-known-debug-simulator). Use the authoritative checkout and the existing Metro. A stale served Beta calls for refreshing that checkout’s Metro. Confirm the visible Settings version, attach the reload receipt to the existing ledger, and hand off the running app. The previous receipt supplies the native build provenance.

## New installation or native changes

1. Read the source/target/configuration handoff. Confirm the authoritative
   absolute source path, HEAD and uncommitted scope, rather than using your
   own sub-worktree's HEAD. Inspect native/dependency changes and the installed
   app to decide between a JavaScript reload and native build. An embedded
   Release bundle requires a rebuild. Physical-device and Mac installation
   requests return to the parent under their own guides.
2. Reuse the handed-off attempt directory, recovery count and resource ledger.
   Admit the whole heavy phase through the shared guard, using guarded CLI
   equivalents for builds rather than direct MCP builds. Use the specified
   simulator UDID on every operation. Inspect host pressure before booting a
   session device; preserve other sessions' devices and processes. Record any
   new device, process, port, generated native directory and build/scratch path.
   Start persistent Metro separately from the guard and confirm its source cwd,
   variant and endpoint. Keep the attempt's one-recovery limit across role
   handoffs; a still-unhealthy environment returns BLOCKED with raw evidence.
3. Build or reload from the frozen authoritative source, following the simulator
   guide's variant and signing rules. Reach first for `mobilebuildmcp` for
   non-heavy inspection/install operations, then `xcrun simctl`; pass the
   explicit target. Install over the app so its data and Keychain remain.
   Routine installation preserves the existing app and simulator data. Wait
   for a successful build exit before installing; a product directory alone
   is not build proof. Silence that simulator after every boot and before
   launching, using `test/manual-test/kit/silence.sh`; leave the Mac's output
   unchanged. Installation verification needs no playback.
4. Launch the app and verify native readiness, visible Settings version, app
   variant and connection to the correct Metro when applicable. Record the
   artifact/bundle identity and source receipt, including native-build
   provenance when reusing a shell. Compare against the expected final change
   where it is visible; functional acceptance belongs to `app-tester`.
5. Return PASS, FAIL or BLOCKED with source identity, simulator/runtime,
   variant/configuration, artifact paths and identity, separate build/install/
   launch/version/connection results, raw commands/logs, remaining limits and
   the updated checkpoint/resource ledger. Report skipped build/install steps
   explicitly. Add new tool pitfalls to the manual-test README. Release the
   admitted phase after its children end; leave a successful delivery open
   with playback stopped and its persistent Metro running when required.

Own simulator installation and startup verification. Application fixes, feature
acceptance, publication and end-of-work cleanup remain with their assigned
roles through the parent. Return requests to the parent rather than dispatching
another agent. Commit or issue actions need an explicit parent assignment.
