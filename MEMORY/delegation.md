# Delegation

## Waiting for delegated agents

Until a delegated agent returns, the main agent must wait patiently for its completion notification or use a long blocking wait. Outside the check-ins below, do not repeatedly check agent status, turn short wait timeouts into a polling loop, or send repeated waiting-only updates. An ordinary timeout is not a reason to inspect status or interrupt the agent; continue waiting for its result. Resume dependent work only after the result arrives or the owner changes the task.

**Check in every 50 minutes a delegated agent is still running**, with a short report to the owner. There are two reasons. The main agent's prompt cache expires after an hour, so a longer silence makes its next turn reread everything. And an agent that has died sends no notification, so without a check-in the main agent waits for nothing.

- **Arm it at dispatch.** In pi, call `bg_wait({ id: <the run or workflow id>, nonBlocking: true, timeoutMs: 3000000 })` straight after the `subagent` call; it wakes the session at 50 minutes. Other harnesses use their own timer.
- **At the wake, look once.** Take one `status` look at the run. Report in a few lines what it is working on, when it last acted, and whether it is alive. Then arm the next 50 minutes.
- **A dead or stuck run is a failed run.** Report its exact failure and its worktree's state before any retry.

## A delegated agent's worktree

Give the agent a sub-worktree (AGENTS.md, "Sub-worktrees") as its `cwd`, with `isolation: none`, and tell it to commit after each logical piece. pi-subagents' own `isolation: worktree` puts the worktree under `~/orca/workspaces/openreader/worktrees/` and removes it when the run ends: on 2026-09-29 (#82) a run that failed with a connection error took its worktree with it, and the agent's uncommitted edits were lost; its commits survived on the branch.

## Running delegated work in parallel

A feature built in batches is accepted by the owner one batch at a time. When the owner asks for speed, run every independent piece at once and have the owner accept them together:

- **Implementers**: each works in a sub-worktree of its own. It writes code and unit tests, commits on its branch, and reports the SHA. The main agent merges the branches, runs the checks, and hands the merged tree to one tester.
- **Simulators**: they bound the parallelism. The Mac has 16 GB, and a booted iOS simulator with the app costs about 4 GB. Read `memory_pressure` before booting another, and use only simulators this session created. An implementer without memory for one leaves device work to the tester.
- **Work without a simulator**: reviews, and docs on files no one else is editing, run beside the tester. Agents sharing a worktree edit disjoint files and commit only their own paths.
