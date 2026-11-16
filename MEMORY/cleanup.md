# Clean up what the session started

Every session starts its own Metro on the next free port, often a dedicated
simulator, and sometimes a helper server (a fake TTS, a `tail -F` on a log).
All of them outlive the session, and removing a worktree does not stop them. On
2026-09-28 the 16 GB Mac held 18 Metros, 11 of them serving worktrees already
deleted: about 9.5 GB for nothing. A booted simulator costs about 4 GB more.

So keep a list, as you go, of every port, PID, simulator UDID and directory
the session starts. When all the tasks are done and committed, ask the owner
whether to clean up. The recommended option, first, is to release everything
on the list (the owner's default, 2026-10-08); keeping the delivery for
inspection is the alternative. When the owner invokes
[finish worktree](finish-worktree.md), release is already authorized: follow its
ordering without another cleanup question.

After authorization, the parent dispatches `resource-cleaner` with the ledger,
retained evidence paths and accepted/merged sub-worktrees, following the
[common handoff contract](../docs/agents/app-workflow.md). Its shared workflow
is [.agents/resource-cleaner.md](../.agents/resource-cleaner.md); the harness
definitions select its model and effort. Complete verification and stop active
resource consumers before release. Preserve screenshots, raw logs and reports
still needed for review, and persist useful accepted evidence in test records
or issue comments before deleting scratch copies. Unmerged work stays intact.

- **What release covers**: the Metros (with their `npm exec` parent and
  `esbuild` child) and helper servers, stopped; the simulators the session
  created, the one holding the latest app included, shut down and deleted;
  and the session's disposable build output and scratch files under `/tmp`,
  with any `ios/` its prebuild created in the worktree. Retained evidence stays
  available. Simulators that existed before the session stay as they were.
  Shared Xcode/iOS runtime packages, security
  settings, and the shared iOS admission lock file are not session resources;
  leave them in place. In particular, never unlink an admission lock that
  another run may be holding or waiting on.
- **Orphans**: also name any Metro whose `lsof -a -p PID -d cwd` is a directory
  that no longer exists or lies under `.orca-worktree-trash`; release stops
  them too. Never stop a process that another live session may be using, or
  the `openreader-metro-*` launchd services. An orphan's parent is PID 1 as a
  service's is, so tell them apart with `launchctl list | grep -i metro`.
- **The worktree**: if the branch is merged (`git merge-base --is-ancestor HEAD
  main`) and `./.worktrees/` is empty (AGENTS.md, "Sub-worktrees"), remind the
  owner that the worktree can be deleted. Do not delete it yourself.
- **The cleaner's workspace**: leave its active cwd until it returns. The
  parent retires that sub-worktree afterwards, under the usual merge,
  working-tree and resource checks, and includes it in the final resource
  report. Other active or unmerged sub-worktrees remain with a stated reason.
