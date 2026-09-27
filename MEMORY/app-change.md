# Finishing an app change

In order: set the beta version, hand the tree to the tester, then leave the latest app running.

## Every app change carries a beta version

Settings shows `APP_VERSION` from `app-version.ts`, so the owner can read off
the device which build is running. Every app change — each one that ends with
the latest app in the simulator — sets it before the tree goes to the tester:
the next patch version plus `-beta1` after a release (`0.0.1` → `0.0.2-beta1`),
then `-beta2`, `-beta3`, … for each later change. Minor and major bumps are the
owner's call. `package.json` and `app.config.ts` keep the released version; the
comment on `version` in `app.config.ts` says why.

Worktrees that start from the same base can pick the same number. Before naming
one, read `app-version.ts` on `main` and in each worktree (`git worktree list`)
and take the next after the highest. The number narrows which build is running;
the change itself, seen in the running app, proves it is the latest.

## Delegate final iOS verification

After finishing app-code changes and local checks, the implementing agent must hand the final working tree to `ios-tester`. Its shared workflow is [.agents/ios-tester.md](../.agents/ios-tester.md); `.codex/agents/ios-tester.toml` and `.claude/agents/ios-tester.md` reference that one source and define their respective model settings. Use the declared model and maximum effort; report an unavailable model rather than silently substituting another.

Give the tester the issue/specification, changed interactions, verification already performed, simulator target and remaining risks. Keep app code stable during the run and follow the waiting rule in [delegation.md](delegation.md); do not duplicate its simulator work. After a failure, fix the reported defect and hand the updated tree back for verification. Completion requires the tester's result and the latest-app delivery below; the tester itself does not recursively delegate this step.

Accept a tester's verdict only after checking it against its raw logs:
- Check every XCTest run's `test.log` line `Executed … with N failures`, the retried runs included, and the raw lines behind each timing.
- A failure the tester puts down to the test's own gesture or timing stays open until a deterministic check shows where it comes from, such as the app's state read through the harness, or repeated runs with the gesture varied. On #71, two failures called flaky were app bugs.

## Finish with the latest app running in the simulator

After every app change, update and launch the app in the simulator from the
latest working-tree code, including uncommitted changes. Reload the current
bundle or rebuild and reinstall as needed; verify that the running app contains
the final change, then exercise the changed interaction. Leave that latest app
open for the owner to inspect, with playback stopped.

This is a completion requirement regardless of which agent made the change,
whether it runs tests, or whether it considers simulator testing necessary.
Type checks, lint and passing tests do not replace it. A stale installed build,
an unconnected Metro server, or an unavailable automation window is a problem
to resolve, not a reason to skip updating the simulator. If an external blocker
truly prevents completion, report the specific blocker and mark simulator
delivery incomplete; do not claim the work is finished.
