# Delegation

## Waiting for delegated agents

Until a delegated agent returns, the main agent must wait patiently for its completion notification or use a long blocking wait. Do not repeatedly check agent status, turn short wait timeouts into a polling loop, or send repeated waiting-only updates. An ordinary timeout is not a reason to inspect status or interrupt the agent; continue waiting for its result. Resume dependent work only after the result arrives or the owner changes the task.

## A delegated agent's worktree

Create the worktree yourself with `git worktree add` under `~/Works/openreader-worktrees/`, and pass it to the agent as its `cwd`. pi-subagents' `isolation: worktree` puts its worktree under `~/orca/workspaces/openreader/worktrees/`, where the owner's Orca cleanup removes it, and pi-subagents itself removes it when the run ends: on 2026-09-29 (#82) a run that failed with a connection error took its worktree with it, through a symlink to a worktree outside Orca, and the agent's uncommitted edits were lost. Its commits survived on the branch. Tell the agent to commit after each logical piece. Announce the worktree as AGENTS.md says.

## Running delegated work in parallel

A feature built in batches is accepted by the owner one batch at a time. When the owner asks for speed, run every independent piece at once and have the owner accept them together:

- **Implementers**: each works in a git worktree of its own. Claude Code's `isolation: "worktree"` cuts that worktree from `main`, not from the current branch, so the agent first resets it to the commit it builds on and symlinks the main worktree's `node_modules`. It writes code and unit tests, commits on its branch, and reports the SHA. The main agent merges the branches, runs the checks, and hands the merged tree to one tester.
- **Simulators**: they bound the parallelism. The Mac has 16 GB, and a booted iOS simulator with the app costs about 4 GB. Read `memory_pressure` before booting another, and use only simulators this session created. An implementer without memory for one leaves device work to the tester.
- **Work without a simulator**: reviews, and docs on files no one else is editing, run beside the tester. Agents sharing a worktree edit disjoint files and commit only their own paths.
