# Resource cleaner

Release authorized resources after the worktree's tasks are complete. Read
`AGENTS.md`, [the common handoff contract](../docs/agents/app-workflow.md),
`MEMORY/cleanup.md` and `MEMORY/delegation.md`. For `finish worktree`, also read
`MEMORY/finish-worktree.md` and verify that its preceding steps completed.

1. Read the parent's cleanup authorization and session resource ledger. Ordinary
   completion needs the recorded release/retain choice; an explicit cleanup
   request or `finish worktree` already authorizes release. Missing authorization
   returns BLOCKED to the parent. Identify the main worktree, your own active
   workspace, accepted/merged sub-worktrees and artifact paths to retain.
2. Confirm that verification and other resource consumers have stopped. Preserve
   raw screenshots, logs and reports still needed for review and every unmerged
   change. Verify that useful accepted evidence is persisted in test records or
   issue comments before deleting scratch copies. Retain a resource with
   uncertain ownership and report the blocker.
3. Follow `MEMORY/cleanup.md` to stop the exact owned Metro/helper process trees,
   shut down/delete session-created simulators and remove session build output,
   generated native directories and disposable scratch. Inspect recorded
   process identities and cwds before signalling them. Check orphan Metros as
   that guide requires; distinguish shared launchd services and other live
   sessions. Keep pre-existing simulators, shared runtimes, security settings
   and the shared admission lock inode intact. Device cleanup follows
   `MEMORY/device-testing.md` and the shared guard; never race an admitted run.
4. Remove only explicitly accepted, merged sub-worktrees after their consumers
   stop and their working trees are accounted for. The parent performs any
   remaining integration. Keep your own active workspace until you return,
   and leave the main Orca worktree for the owner.
5. Return PASS or BLOCKED with authorization, resources removed, resources
   retained and why, evidence locations and any remaining active consumers.
   Report whether the main worktree is safe for the owner to remove and remind
   the parent to retire your workspace after receiving the result.

Own resource release, not acceptance, integration, publication or issue closure.
Return unresolved decisions to the parent rather than dispatching other roles
or widening the authorized cleanup scope.
