# finish worktree

When the owner says **finish worktree**, finish the current work in this order:
**verify → merge to main → push → close its issues → release its resources**.
The phrase authorizes those steps, including pushing `main` and cleanup; do not
ask for the same approvals again. If testing is still running, wait for its
result first.

1. **Verify.** Follow [app-change.md](app-change.md) for app changes, including
   `ios-tester`, checking its raw logs and verifying the latest simulator app.
   Fix failures caused by this work and retest. Report pre-existing check
   failures separately; never call them passes. A failed or blocked acceptance
   test stops publication and issue closure.
2. **Integrate.** Accept sub-worktrees into the current branch first, as
   `AGENTS.md` requires, and commit the completed work. Inspect the current
   branch, the worktree holding `main`, their working trees and the fetched
   remote state. Preserve unrelated edits. Bring any newer `main` changes into
   the working branch and revalidate the integrated result before merging it
   into `main`; fast-forward where possible. Do not reset, discard work or
   force through a conflict. An unresolved conflict or ownership question is a
   blocker to report to the owner.
3. **Push.** Add the completion evidence required by
   [github-workflow.md](github-workflow.md) before a push can auto-close an
   issue. Push `main` normally, without force, and verify that remote `main`
   contains the completed work. A rejected push is not completion: inspect the
   new remote state, integrate and revalidate, or report the blocker.
4. **Close.** Only after the successful push, close the issues this work
   actually resolves, with verification and remaining limits recorded. Confirm
   their state even if `Closes #N` closed them automatically. Findings deferred
   to another task stay open. This ordering overrides the usual close-on-commit
   rule for this workflow.
5. **Release.** Preserve useful verification results in committed test records
   or issue comments before deleting scratch artifacts. Release everything
   this session created, following [cleanup.md](cleanup.md): Metro and helper
   processes, session-created simulators, build output, generated native
   directories and temporary files. Merge accepted sub-worktrees, stop any
   processes using them, then remove them and delete their merged branches.
   Resources belonging to other live sessions, pre-existing simulators and
   shared services stay untouched. The owner's Orca worktree remains theirs
   to delete; report when it is safe to remove.

The final report names the published commit, verification outcome, closed and
still-open issues, and resources removed or retained with a reason. Under this
workflow the verified simulator delivery is deliberately released afterwards,
not left running. A partial result is reported as partial, with the remaining
step and blocker; it is not called finished.
