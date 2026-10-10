# GitHub workflow — issue first

Use `gh` for `xujialiu/OpenReader`. Features, bug fixes and substantial changes
start with an issue. Small, low-risk chores with a clear scope can proceed
directly: typo fixes, brief instruction updates, removing redundant files,
or moving local credentials and updating their documented paths. Use judgment
without asking the owner to approve the exception. For these chores, skip the
issue lookup, creation, comments and issue references in commits. If the work
grows into a feature, bug fix or substantial change, follow the issue workflow
before continuing with that expanded scope.

The owner's standing instruction authorizes creating issues and posting work
comments as part of the task; no separate permission is needed each time.
When an issue is required:

1. Read all existing issue titles, open and closed, before starting work
   (`gh issue list --state all --limit 1000`; paginate if needed). Read related
   issues with their comments and reuse the relevant issue when it already
   covers the request.
2. Create the issue before implementation. Its title and body describe only
   the problem, user impact, evidence and requested outcome. Keep proposed
   solutions and implementation plans in subsequent comments.
3. Post the solution as a separate comment before implementing it: the
   approach, affected files, ordered steps, verification and alternatives
   considered. A request only to create an issue ends with the issue; it does
   not authorize implementation.
4. Comment when findings change the plan. Before closing, add a completion
   comment describing what changed, how it was verified and any remaining
   limitations. Reference the issue in the finishing commit's subject
   (`docs: establish issue workflow (#1)`) and use `Closes #N` in its body
   when the work is complete. Close the issue with `gh issue close N` as
   soon as that commit is made, on any branch, rather than waiting for the
   merge: `Closes #N` acts only once the commit is pushed to `main`.

Write issues and comments in English. Keep each paragraph on one line;
separate blocks with blank lines, because GitHub renders single newlines.

## Labels — match Zotero-OpenReader

The GitHub label names, colors and descriptions mirror
`xujialiu/Zotero-OpenReader`. Inspect them with `gh label list`; when synchronizing,
use `gh label clone xujialiu/Zotero-OpenReader --repo xujialiu/OpenReader --force`.

For everyday work, choose one category:

- `bug`: existing behavior is broken.
- `enhancement`: a new feature or requested behavior.
- `chore`: documentation, wording, layout, refactoring or housekeeping that
  leaves app behavior unchanged.

Every `bug` also has exactly one severity label, chosen by user impact rather
than fix size and updated when the evidence changes:

- `severity: critical`: spends the user's money, loses unrecoverable data or
  makes the app unusable through a crash, hang or startup failure. Fix first
  and ship as a patch release.
- `severity: major`: a documented feature fails in an ordinary setup or a
  setting changes silently. Fix for the next release.
- `severity: minor`: cosmetic, an uncommon edge case or an incorrect
  diagnostic. Fix when convenient.

`enhancement` and `chore` have no severity label. Retain the other mirrored
labels for parity; routine issue classification uses the labels above, with
no milestones.

The agent-skill workflow labels (the triage labels in
`docs/agents/triage-labels.md` and `wayfinder:*`) are OpenReader's own
additions to the Zotero-OpenReader set; `gh label clone` leaves them in place.

## Outside contributions — the terms come first

OpenReader ships on the App Store, which AGPL-3.0 alone does not allow for
code the owner does not own (ADR 0076). So every line that enters the
repository is the owner's own, or given under the terms in `CONTRIBUTING.md`.

- **A pull request someone else opened**: merge it only when its author has
  ticked the "Contribution terms" box in its description. The description's
  edit history shows who ticked it. While the box is empty, ask for the tick in
  a comment and leave the pull request open.
- **Lines from a pull request without the tick** stay out of every commit, the
  owner's included. Fix the problem it points at in new code, written from the
  problem rather than from its diff.
- **Code copied in from Zotero-OpenReader** (ADR 0013): copy a file only when
  every change to it there is the owner's, by `git log --format='%an' -- <path>`
  and the pull requests that touched it, or was merged there under the same
  terms.
- **Code a contributor marks "Submitted on behalf of a third party"**: put it
  to the owner with its source and licence before merging.
