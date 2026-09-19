@AGENTS.md

# Where a thing gets written down

Four places. Putting something in the wrong one is how it stops being read.

| | Who reads it | What it holds |
| --- | --- | --- |
| `design/` | Someone who does not read code | The trade-off: what was chosen, what was given up, and who it is for |
| `docs/adr/` | Someone who does | The technical decision, and the measured facts behind it |
| `notes/` | The author, later | What was measured, when |
| `CONTEXT.md` | Everyone | The glossary, and nothing else |

## `design/` — the product argument

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

`design/0002-…` and `docs/adr/0002-…` are the same decision written for two
readers. Same number, same slug where it reads naturally.

Not every decision has both halves. A purely technical one (adopting a platform
life cycle, say) has an ADR and no design file. A purely product one has a
design file and no ADR. The number is still spent, so a number never means two
different decisions.

## `notes/` — dated, and timestamped inside

One file per day, `notes/NOTES_YYYY-MM-DD.md`, opening with
`# OwnReader — engineering log, YYYY-MM-DD`. Every entry is a heading carrying
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
