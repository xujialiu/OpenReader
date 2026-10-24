# Finishing an app change

In order: set the beta version, hand the tree to the tester, then leave the latest app running.

## Every app change carries a beta version

Settings shows the version derived from `APP_VERSION` in `app-version.ts`, so
the owner can identify the running copy. The accepted rule is
[ADR 0086](../docs/adr/0086-three-copies-for-three-recipients.md), replacing
ADR 0083's pairs. **The #324 build migration is not yet implemented or
verified; keep uploads blocked until it is.**

`APP_VERSION` is `x.y.z (n)-betaN`: the Version, formal base Build Number and
Beta of CONTEXT.md. An Upload Set derives formal `n`, free test `n + 1`, and
Debug `n + 2`. Settings adds no role suffix for formal, `-free` for free test,
and `-debug` for Debug. There is no odd/even constraint. Every app change sets
the Beta before the tree goes to the tester, meaning each change that ends
with the latest app in the simulator:

- **The first change after a complete Upload Set** raises the formal base by
  three and starts Beta 1. After base 13's copies 13/14/15, the next base is
  16: `1.0.2 (16)-beta1`, shown in Debug as `1.0.2 (18)-beta1-debug`.
- **Each later change** takes the next Beta at the same base.
- **An Upload Set** drops the Beta and uses three consecutive numbers from
  one commit. A partial failure does not authorize a new base, role change or
  submission; stop and ask the owner. Planned identities are in ADR 0086.
  [versions.md](../docs/versions.md) contains only a table of confirmed
  uploads: keep its empty template until an upload is confirmed, and never
  add planned or failed-attempt rows. The upload procedure and mandatory
  per-copy owner receipt are in
  [release-to-app-store.md](../docs/release-to-app-store.md).
- **The Version** (`x.y.z`) changes only when the owner says so. The owner has
  explicitly chosen `1.0.2` for the next set. Uploads, submissions and new
  features do not change it. When the owner names a new Version,
  `npm version <x.y.z> --no-git-tag-version` moves `package.json` with it.

Write it exactly like that: no `v`, and a space before the bracket. A tag is
an exception: one complete set uses its highest number without a space, such
as `1.0.2(15)`, and its message identifies all three copies. Earlier tags stay
unchanged. Every record naming a build uses the same version form, including
notes, test records, commit subjects and issue comments. Records written
before #127 stay as written. Configuration and tests must derive the native
numbers and Settings lines from the same formal base and selected role.

Worktrees that start from the same base can pick the same Beta. Before naming
one, read `app-version.ts` on `main` and in each worktree (`git worktree list`)
and take the next after the highest with the same Build Number. A Beta spent
on a branch that was never merged stays spent: Build 7's beta2 to beta9 went to
the Downloads manager turned down in #137, and beta9 is on the owner's phone, so
`main`'s next change in Build 7 is `1.0.0 (7)-beta10`. The number
narrows down which build is running. Seeing the change itself in the running app
is what proves it is the latest.

## Delegate final iOS verification

After finishing app-code changes and local checks, the implementing agent must hand the final working tree to `ios-tester`. Its shared workflow is [.agents/ios-tester.md](../.agents/ios-tester.md); `.codex/agents/ios-tester.toml`, `.claude/agents/ios-tester.md` and `.pi/agents/ios-tester.md` reference that one source and define their respective model settings. Use the declared model and maximum effort; report an unavailable model rather than silently substituting another.

Give the tester the issue/specification, changed interactions, verification already performed, simulator target and remaining risks. Keep app code stable during the run and follow the waiting rule in [delegation.md](delegation.md); do not duplicate its simulator work. After a failure, fix the reported defect and hand the updated tree back for verification. Completion requires the tester's result and the latest-app delivery below; the tester itself does not recursively delegate this step.

Accept a tester's verdict only after checking it against its raw logs:
- Check every XCTest run's `test.log` line `Executed … with N failures`, the retried runs included, and the raw lines behind each timing.
- A failure the tester puts down to the test's own gesture or timing stays open until a deterministic check shows where it comes from, such as the app's state read through the harness, or repeated runs with the gesture varied. On #71, two failures called flaky were app bugs.

## Finish with the latest app running in the simulator

After every app change, update and launch the app in the simulator from the
latest working-tree code, including uncommitted changes. Reload the current
bundle or rebuild and reinstall as needed; verify that the running app contains
the final change, then exercise the changed interaction. Leave that latest app
open for the owner to inspect, with playback stopped. Under
[finish worktree](finish-worktree.md), complete and verify this delivery first;
that workflow's final cleanup then releases the simulator and Metro.

This is a completion requirement regardless of which agent made the change,
whether it runs tests, or whether it considers simulator testing necessary.
Type checks, lint and passing tests do not replace it. A stale installed build,
an unconnected Metro server, or an unavailable automation window is a problem
to resolve, not a reason to skip updating the simulator. If an external blocker
truly prevents completion, report the specific blocker and mark simulator
delivery incomplete; do not claim the work is finished.
