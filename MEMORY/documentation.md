# Where a thing gets written down

Six places. Putting something in the wrong one is how it stops being read.

|                | Who reads it                   | What it holds                                                        |
| -------------- | ------------------------------ | -------------------------------------------------------------------- |
| `docs/design/` | Someone who does not read code | The trade-off: what was chosen, what was given up, and who it is for |
| `docs/adr/`    | Someone who does               | The technical decision, and the measured facts behind it             |
| `docs/*.md`    | Whoever does the task next     | A guide: the steps as they are today, and the facts they need        |
| `notes/`       | The author, later              | What was measured, when                                              |
| `CONTEXT.md`   | Everyone                       | The glossary, and nothing else                                       |
| `README.md`    | A visitor to the GitHub page   | What the app does and how to install it                              |

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

## `docs/*.md` — guides

A guide (installing on the simulator or the iPhone, a Demo App, a release,
debugging on the phone) holds the steps as they are today, the facts they
depend on (a team ID, a bundle ID, a profile's expiry), and a short reason
where it stops someone taking a wrong turn. Write it in the present tense. A
date in a guide belongs to a fact, such as an expiry, never to a run.

A run of a guide goes to that day's `notes/`: what was built, how long it took,
what failed and what fixed it. The guide gains only what the run changed — a
step, a fact, a row of its troubleshooting table — ending with the note it came
from: `(notes 2026-10-02 14:01)`. A run that changed nothing in the guide
changes only the notes.

## `notes/` — dated, and timestamped inside

One file per day, `notes/NOTES_YYYY-MM-DD.md`, opening with
`# OpenReader — engineering log, YYYY-MM-DD`. Every entry is a heading carrying
**the time it was found**, to the minute:

```markdown
## user-select: none silently stops ::highlight() from painting (2026-09-19 18:04)
```

The same shape as the Zotero-OpenReader repository's log, deliberately: the two
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

## `README.md` — the front page

The GitHub page, one tap from the app's Settings (design 0072). It is laid out
like Zotero-OpenReader's: centred icon, name and tagline, badges, a GIF, then
what the app does and how to install it.

- **Every absolute address** in it is on `PAGES_MAY_NAME` in
  `test/app/no-outgoing-links.test.ts` (ADR 0017, #129), badge images included.
  Add a new one there once you have looked at it; a Provider's signup, pricing
  or key page never goes on.
- **The TestFlight badge** names the build the TestFlight Beta's public link
  installs. It reads that from the project's site, where a workflow publishes
  what App Store Connect answers (#150). Never write a build into the README;
  `docs/release-to-app-store.md` says how the badge follows.
- **The owner sees it before it is committed.** Once a change is ready, run
  `bash scripts/readme-preview.sh`: it renders the README with GitHub's own
  renderer into `.docs/README.html` (ignored by git) and opens it. Give the
  owner that path, and commit after he has looked.

## When a term or a decision changes

Write it down at the moment it crystallises, in the file it belongs in, rather
than batching it. Documentation in this repository has been wrong four times in
one day — each time because reality moved and the file that described it did
not. Every one was fixed while the context was still in hand; none was left for
a later sweep.
