# App verification, installation and resource cleanup

Use this pipeline for app changes and requested installation/verification.
Release identity-only work on accepted source follows
[the release workflow](../release-to-app-store.md), reusing functional
acceptance rather than dispatching installer/tester roles or creating a
simulator delivery solely for publication.

The parent serially dispatches three roles. Each role has one shared workflow
under `.agents/`; the definitions under `.codex/agents/`, `.claude/agents/` and
`.pi/agents/` select the harness's model and effort and point to that workflow.
Start with those settings. For a GLM quota error, follow the [subagent model fallback](../../.agents/README.md#glm-quota-fallback). Report other model availability failures.

| Role | Responsibility | Completion evidence |
| --- | --- | --- |
| [app-installer](../../.agents/app-installer.md) | Prepare, build, install and launch OpenReader on the specified simulator | Source identity, build/install/launch results, visible version and runtime connection |
| [app-tester](../../.agents/app-tester.md) | Verify the changed behavior on the relevant iPhone, iPad and Mac targets | PASS, FAIL or BLOCKED, with raw assertions and coverage limits |
| [resource-cleaner](../../.agents/resource-cleaner.md) | Release authorized session resources after the work is complete | Resources removed or retained, ownership evidence and blockers |

When the owner asks for direct installation, the parent takes over the installer role. Stop any active installer worker and continue from its attempt, ledger and receipts. The same verification and delivery requirements apply.

The parent owns source changes, acceptance of results, issue/commit/publication
actions and dispatch of the next role. Workers return requests to the parent
rather than dispatching one another.

## Hand off the authoritative source

A worker's assigned sub-worktree is its workspace, following
[delegation.md](../../MEMORY/delegation.md). Its HEAD alone does not identify
the app: a new sub-worktree omits the parent's uncommitted changes.

Before installation or testing, the parent hands off:

- The absolute authoritative source path, HEAD, relevant diff and fingerprints
  of uncommitted changes, including relevant untracked source files. Keep
  credentials out of these records.
- The issue/specification, changed interactions, completed checks, remaining
  risks and required platform coverage.
- Explicit target identities, app variant, Debug/Release configuration and
  Metro endpoint when used; include the installation receipt for the tester.
- The attempt directory, completed evidence, spent recovery count and session
  resource ledger from [cleanup.md](../../MEMORY/cleanup.md).

The parent freezes that source through installation and verification. Workers
target it explicitly, including uncommitted changes, rather than substituting
their own checkout. Build/setup output is recorded in the resource ledger;
application edits remain the parent's responsibility. A changed source identity
requires a new installation decision and rechecking any invalidated evidence.
Test-script changes made in a worker's branch return to the parent for
integration before verification claims depend on them.

## Install, then verify

For an app change, follow [app-change.md](../../MEMORY/app-change.md): set the
Beta and complete local checks, freeze the source, dispatch `app-installer`,
then hand its receipt to `app-tester`. Installer PASS establishes installation
and launch; tester PASS establishes only the behavior actually exercised.

Simulator OpenReader builds, installation, reinstallation and source-changing
bundle reloads belong to `app-installer`. A tester needing one returns BLOCKED
with the requested configuration, completed checks and checkpoint. The parent
dispatches the installer and then resumes the missing or invalidated checks.
Compiling/installing an XCTest runner belongs to testing; a test wrapper that
also rebuilds or replaces OpenReader needs the installer handoff first.

Every heavy simulator/build/XCTest phase follows
[the shared guard](../../test/manual-test/kit/ios-verification.md). End and
release the current admitted phase before another role starts; a sibling
cannot inherit admission by copying its token. Carry the same attempt directory
and spent recovery count across handoffs. Changing roles grants no extra
recovery. Persistent Metro/fixture processes start outside the guard and stay
in the ledger.

The tester selects relevant platforms from the changed behavior and records
the selection and omissions. Physical-device checks require an explicit
request. Mac coverage retains [Mac installation rules](../../MEMORY/mac-install.md):
testing does not itself authorize replacing the owner's copy or its data.
Installation outside a simulator returns to the parent under the applicable
device guide; it is outside `app-installer`'s scope.

The parent checks raw test results and fixes failures before accepting them.
If a test changes the installed variant or leaves delivery incomplete, the
parent sends the final frozen source back to `app-installer`, then resumes any
checks invalidated by that restoration. Report delivery separately from test
acceptance. Ordinary delivery leaves the latest app open with playback stopped
and its Metro running when needed.

## Release after acceptance and authorization

At ordinary completed-and-committed task completion, the parent offers release
versus retaining the inspection environment through the harness's question
tool. An explicit cleanup request or `finish worktree` already authorizes
release. Follow [cleanup.md](../../MEMORY/cleanup.md) and the
[finish-worktree ordering](../../MEMORY/finish-worktree.md).

Before dispatching `resource-cleaner`, record verification results in test
records or issue comments, keep [raw evidence](../../MEMORY/documentation.md#evidence)
for review, and pass the authorization, ledger, retained
artifact paths and accepted/merged sub-worktrees. Raw screenshots, logs and
reports still needed for review stay available; unmerged work stays intact.
Stop resource consumers before removing their directories. The cleaner reports
uncertain ownership or an active consumer as a blocker rather than forcing
release.

The cleaner keeps its own active workspace until it returns. The parent then
retires that workspace under the sub-worktree rules and reports all resources
removed or retained. The owner controls deletion of the main Orca worktree.
