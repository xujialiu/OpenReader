# Clean up what the session started

Every session starts its own Metro on the next free port, often a dedicated
simulator, and sometimes a helper server (a fake TTS, a `tail -F` on a log).
All of them outlive the session, and removing a worktree does not stop them. On
2026-09-28 the 16 GB Mac held 18 Metros, 11 of them serving worktrees already
deleted: about 9.5 GB for nothing. A booted simulator costs about 4 GB more.

So keep a list, as you go, of every port, PID and simulator UDID the session
starts. When all the tasks are done and committed, ask the owner whether to
clean up, with keeping the delivery for inspection as one of the options:

- **What to stop**: the Metros (with their `npm exec` parent and `esbuild`
  child), helper servers and simulators on that list. The simulator that holds
  the latest app stays unless the owner says otherwise.
- **Orphans**: also name any Metro whose `lsof -a -p PID -d cwd` is a directory
  that no longer exists or lies under `.orca-worktree-trash`. Never stop a
  process that another live session may be using, or the `openreader-metro-*`
  launchd services.
- **The worktree**: if the branch is merged (`git merge-base --is-ancestor HEAD
  main`) and `./.worktrees/` is empty (AGENTS.md, "Sub-worktrees"), remind the
  owner that the worktree can be deleted. Do not delete it yourself.
