# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

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
   when the work is complete.

Write issues and comments in English. Keep each paragraph on one line;
separate blocks with blank lines, because GitHub renders single newlines.

## Labels — match Zotero-TTS

The GitHub label names, colors and descriptions mirror
`xujialiu/Zotero-TTS`. Inspect them with `gh label list`; when synchronizing,
use `gh label clone xujialiu/Zotero-TTS --repo xujialiu/OpenReader --force`.

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

# What the interface is allowed to say

**The interface says a thing once, or not at all.** Prefer removing a line to
rewording it, and prefer showing nothing to showing a sentence the owner can
already see the answer to.

A line earns its place only if it says something the owner cannot read off the
screen without it. Three kinds fail that test and are removed on sight:

- **A caption on a symbol that already means it.** A check beside the word
  `Downloaded` says it twice; the check alone is the word.
- **A sentence that describes the state it sits next to.** The marked row in the
  contents does not need `The marked row is the one being read.` under it. The
  two sentences that say the mark is *approximate* stay, because that is the one
  thing the mark cannot show.
- **A standing notice repeated on every visit.** `Generating audio may incur
  speech service charges.` above every download is read once and then never
  again, so it costs space on every screen after the first and buys nothing.

What stays is what carries a fact: a count, a size, a name, a failure, a warning
the owner has not already been given. **A count is not a banner** — `2 chapters
downloaded` is a fact and stays; `Whole document downloaded` beside it is the
same fact in other words and goes.

This applies to the words *and* the space they take. On a phone every removed
line is a line of the list the owner came for.

# Where a thing gets written down

Four places. Putting something in the wrong one is how it stops being read.

|                | Who reads it                   | What it holds                                                        |
| -------------- | ------------------------------ | -------------------------------------------------------------------- |
| `docs/design/` | Someone who does not read code | The trade-off: what was chosen, what was given up, and who it is for |
| `docs/adr/`    | Someone who does               | The technical decision, and the measured facts behind it             |
| `notes/`       | The author, later              | What was measured, when                                              |
| `CONTEXT.md`   | Everyone                       | The glossary, and nothing else                                       |

## `docs/design/` — the product argument

A product manager must be able to read any file here end to end and understand
what was decided and what it costs, **without knowing what a WebView, a sample
rate or a config plugin is**.

Write the alternative that was turned down and why it lost, in the terms of
someone using the app: what they would have seen, what would have gone wrong,
what they would have had to do instead.

**Never here**: an API name, a file path, a type name, a library name, a version
number, a code fence, a stack trace. If a sentence stops making sense once those
are removed, it is not a design sentence — move it to `docs/adr/`.

## `docs/adr/` — the engineering record

What was actually done, and the facts that forced it. This is where a measured
detail lives, and measured details are the most valuable thing in this
repository: that a provider speaks `29.83` as words, that a library's own
default is the value its own guard rejects, that `user-select: none` silently
stops `::highlight()` from painting. **Never paraphrase one away.** A sentence
that looks like a pointless caveat is usually a scar.

An ADR keeps its `status:` front matter. A design file has none — the decision's
status is one thing, recorded once.

## The two are paired by number

`docs/design/0002-…` and `docs/adr/0002-…` are the same decision written for two
readers. Same number, same slug where it reads naturally.

Not every decision has both halves. A purely technical one (adopting a platform
life cycle, say) has an ADR and no design file. A purely product one has a
design file and no ADR. The number is still spent, so a number never means two
different decisions.

## `notes/` — dated, and timestamped inside

One file per day, `notes/NOTES_YYYY-MM-DD.md`, opening with
`# OpenReader — engineering log, YYYY-MM-DD`. Every entry is a heading carrying
**the time it was found**, to the minute:

```markdown
## user-select: none silently stops ::highlight() from painting (2026-09-19 18:04)
```

The same shape as the Zotero-TTS repository's log, deliberately: the two
projects share a provider layer and a sync format, and one day a reader will
have both logs open.

A note records a **measurement**. A decision is not a note, even when the
measurement is what forced it — the note says what was seen, the ADR says what
was then chosen.

## `CONTEXT.md` — the glossary

A term, what it means, and the words to avoid for it. **No implementation
details, no decisions, no scratch notes.** If a definition needs a sentence
about how something works, that sentence belongs in an ADR and the definition is
too long.

## When a term or a decision changes

Write it down at the moment it crystallises, in the file it belongs in, rather
than batching it. Documentation in this repository has been wrong four times in
one day — each time because reality moved and the file that described it did
not. Every one was fixed while the context was still in hand; none was left for
a later sweep.

# Waiting for delegated agents

Until a delegated agent returns, the main agent must wait patiently for its completion notification or use a long blocking wait. Do not repeatedly check agent status, turn short wait timeouts into a polling loop, or send repeated waiting-only updates. An ordinary timeout is not a reason to inspect status or interrupt the agent; continue waiting for its result. Resume dependent work only after the result arrives or the owner changes the task.

# Testing on the device

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

After finishing app-code changes and local checks, the implementing agent must hand the final working tree to `ios-tester`. Its shared workflow is [.agents/ios-tester.md](.agents/ios-tester.md); `.codex/agents/ios-tester.toml` and `.claude/agents/ios-tester.md` reference that one source and define their respective model settings. Use the declared model and maximum effort; report an unavailable model rather than silently substituting another.

Give the tester the issue/specification, changed interactions, verification already performed, simulator target and remaining risks. Keep app code stable during the run and follow the delegated-agent waiting rule above; do not duplicate its simulator work. After a failure, fix the reported defect and hand the updated tree back for verification. Completion requires the tester's result and the latest-app delivery below; the tester itself does not recursively delegate this step.

Before running or writing device/manual tests, read
[`test/manual-test/README.md`](test/manual-test/README.md) and reuse its scripts.
When `xcrun`, Metro, XCTest or a manual step goes wrong or misleads you, add it
to that README's **Pitfalls**, with its symptom, cause and fix, before you
finish. That includes problems you only worked around.

Prefer `xcrun` (especially `xcrun simctl`), `xcodebuild`, and the existing
XCTest/manual-test scripts for device and simulator work. Use Computer Use only
when a required action cannot be performed through those tools.

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

## Local credentials

For provider configuration or live-provider tests, first check
`~/.secrets/openreader/`. It contains the
owner's local credentials. Load only the credentials needed for the test; keep
their values out of logs, screenshots, documentation and commits. Its WebDAV
folder is a test folder, not where the owner's reading syncs: a sync test may
write positions there freely.

## Real books

When a device or manual test needs a real document — hundreds of sections,
chapters several screens tall, real navigation — take one from the owner's
library in `~/Works/epub_books` before generating a fixture. They are the
owner's personal copies: copy a part into the app and keep the originals
unchanged and outside this repository. Loading one is in
[`test/manual-test/README.md`](test/manual-test/README.md), **Real books**.

## Silence the simulator before playing anything

Turn the simulator's volume all the way down **before** the first `play`, not
after someone hears it. The simulator plays through the machine's own speakers,
and this work happens at every hour.

The simulator's volume, not the Mac's: `bash test/manual-test/silence.sh set
SIMULATOR_UDID` sets that one device to zero and reads it back. **Never mute the
machine.** The owner is listening to it while the test runs, and a machine that
is muted for a test stays muted afterwards. A boot puts the device back to 60, so
set it after every boot and before launching the app, and the kit's scripts check
it before every `play`.

## Play only while measuring, then stop

Stop playback the moment the thing being tested is established. Never leave a
reading running while writing up, taking screenshots or thinking.

The cost is not the audio, it is the transcript: a reading that keeps going keeps
producing clip fetches, position corrections and log lines, and an agent watching
the device reads all of them. That is the owner's tokens spent on nothing.

## The length of a test comes from what it establishes

**Derive the duration; do not pick a safe one.** Five seconds is enough to show
that the highlight follows a real voice, that a Provider's audio plays at all,
that the word lands on the right word. Running a minute to establish any of
those is fifty-five seconds of transcript bought for nothing.

Some things genuinely need the long run, and those get it without argument:
whether the highlight **drifts** cannot be seen in five seconds, and neither can
memory over a session or what happens when the app is backgrounded. Run those
for as long as they actually need.

So the question before every test is which of the two it is. Say in the report
how long it ran and why that long — a duration nobody can justify afterwards was
guessed.

# Installing on a physical iPhone

For installation on the owner's physical iPhone, device signing or provisioning
failures, or a standalone Release build for that iPhone, read
[docs/install-on-iphone.md](docs/install-on-iphone.md) before running build commands.

In anything committed, write that iPhone's UDID as `IPHONE_UDID`, and look up
the real one at run time with `xcrun devicectl list devices`.

# Installing in the iOS simulator

For simulator installation, updating the running app to the latest working-tree
code, Metro connection problems, or simulator build failures, read
[docs/install-on-simulator.md](docs/install-on-simulator.md) before updating or
building the simulator app.
