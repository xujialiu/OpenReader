# Delegation

## Waiting for delegated agents

Until a delegated agent returns, the main agent must wait patiently for its completion notification or use a long blocking wait. Outside the check-ins below, do not repeatedly check agent status, turn short wait timeouts into a polling loop, or send repeated waiting-only updates. An ordinary timeout is not a reason to inspect status or interrupt the agent; continue waiting for its result. Resume dependent work only after the result arrives or the owner changes the task.

**Check in every 50 minutes a delegated agent is still running**, with a short report to the owner. There are two reasons. The main agent's prompt cache expires after an hour, so a longer silence makes its next turn reread everything. And an agent that has died sends no notification, so without a check-in the main agent waits for nothing.

- **Arm it at dispatch.** In pi, call `bg_wait({ id: <the run or workflow id>, nonBlocking: true, timeoutMs: 3000000 })` straight after the `subagent` call; it wakes the session at 50 minutes. Other harnesses use their own timer.
- **At the wake, look once.** Take one `status` look at the run. Report in a few lines what it is working on, when it last acted, and whether it is alive. A completed result is read and acted on, not rerun. An attention wake may arrive before the timeout: handle its cause once; do not repeatedly re-arm a subscription that immediately fires on the same unchanged attention state. Native completion notification remains the completion path.
- **A dead or stuck run is a failed run.** Report its exact failure and its worktree's state before any retry.
- **A pi run has a time limit.** pi-subagents ends an async run after 30 minutes unless the call or the agent's frontmatter sets `timeoutMs`. `.pi/agents/ios-tester.md` sets 3 hours: on 2026-10-12 a simulator check was cut off halfway, after its build alone took about 15 minutes. Any other run that may outlast 30 minutes gets its own `timeoutMs` at dispatch.

## Verification checkpoints and steering

An iOS handoff names bounded phases and the evidence each must return. The
tester follows the shared admission/readiness/recovery gate in
[device-testing.md](device-testing.md). A phase that exhausts its environment
recovery returns BLOCKED with raw evidence and a resource ledger; it does not
spend the rest of the agent's time limit on more reboots. The parent resumes
only the missing checks after addressing the blocker, keeping completed evidence.

A queued `steer` is not delivered guidance. Check delivery at the next checkpoint
or meaningful attention event; repeating the same queued message is not a fix.
If urgent guidance remains undelivered, use the harness's supported
interrupt/resume path after preserving the worktree state, or report the routing
blocker. Never silently substitute a model or another execution protocol.

## A delegated agent's worktree

Give the agent a sub-worktree (AGENTS.md, "Sub-worktrees") as its `cwd`, with `isolation: none`, and tell it to commit after each logical piece. pi-subagents' own `isolation: worktree` puts the worktree under `~/orca/workspaces/openreader/worktrees/` and removes it when the run ends: on 2026-09-29 (#82) a run that failed with a connection error took its worktree with it, and the agent's uncommitted edits were lost; its commits survived on the branch.

## Running delegated work in parallel

A feature built in batches is accepted by the owner one batch at a time. When the owner asks for speed, run every independent piece at once and have the owner accept them together:

- **Implementers**: each works in a sub-worktree of its own. It writes code and unit tests, commits on its branch, and reports the SHA. The main agent merges the branches, runs the checks, and hands the merged tree to one tester.
- **Simulators**: heavy verification is one admitted lane on this Mac, not one per worktree ([device-testing.md](device-testing.md)). Read `memory_pressure` before booting a session-owned device; an implementer leaves device work to the tester rather than starting a competing run. Other sessions' devices and processes remain theirs.
- **Work without a simulator**: reviews, and docs on files no one else is editing, run beside the tester. Agents sharing a worktree edit disjoint files and commit only their own paths.
