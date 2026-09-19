---
status: accepted
---

# A structural assertion names one line, and the suite refuses one that names two

Purely technical: there is no `docs/design/0024`. Nothing an owner can see changes
— what changes is whether the tests that guard the things they *can* see are able
to fail.

## The defect, which is in the shape and not in the authors

Half of `src/renderer/` runs inside Safari and the now-playing module is Swift, so
a set of one-line invariants can only be guarded by reading the source text.
`test/README.md` says why, and says a mock may not stand in for it. The shape that
grew out of that is

```ts
expect(code('highlighter.ts')).toContain('user-select: text !important');
```

**A marker that appears more than once in the text makes the assertion vacuous.**
The whole-file search is still answered by the other occurrence after the line it
guards is deleted, so the suite stays green over the deletion — and every one of
these rules exists precisely because the thing it guards fails silently, so
nothing else notices either.

Five authors have now hit this, each by accident and each in a different file. It
was reported four times as four coincidences. It is one defect.

## What the sweep found, mechanically

Every structural assertion in this suite ends in a substring or a regex search, so
the tests were run with `String.prototype.includes`, `String.prototype.indexOf`
and chai's own `toContain` and `toMatch` wrapped, recording for each search the
marker, the text it was searched in, and **how many times the marker occurs in
that text**. 1,080 tests, 806 distinct searches over source text, 39 with a count
above one.

Ten of those thirty-nine were real: the line the rule guards could be deleted with
the whole suite green. All ten are now closed and all ten mutations fail; the table
is in `notes/NOTES_2026-09-20.md` at 06:34. The worst of them was already confirmed
by hand:

| what could be deleted | why the assertion survived it |
| --- | --- |
| `user-select: text !important` in the stylesheet the highlighter installs | it is a **substring of** `-webkit-user-select: text !important` on the line above |
| the `covered` assignment in the `inset` branch | `covered = ` also matches `var covered = 0;` |
| the `onPositionChanged` handler — the only clock this app has | `dispose()` writes `node.onPositionChanged = null` |
| the clamp on a rate arriving from the stepper | `let rate = clampRate(…)` initialises it too |
| the installation `sweep()` | the Clip cue calls `sweep()` as well |
| `liveContents`'s `defaultView` gate | `attach` has its own |
| the frame loop's first `requestAnimationFrame` | `tick` reschedules with the same call |
| the **word** `Highlight`, its registration and its `::highlight()` rule | the **sentence** has one of each, spelled the same way |
| `settle`'s wait for a box that does not exist yet | it waits again once one does |

The `user-select` one is the most expensive defect this project has had, and its
guard could have been deleted with all 122 renderer assertions passing.

## The decision

`test/structural.ts` holds `pin(text, marker, where)`, and every source-text rule
that names one line goes through it. It refuses **both** ways:

- **absent** — the guarded line has gone, which is what the rule was for;
- **more than once** — the assertion cannot fail for the right reason, so it is
  not an assertion. The message names the count and the line numbers and says to
  narrow the marker or slice the text.

The second refusal is the whole point, and it has to throw rather than warn for the
same reason `plugins/with-ui-scene-lifecycle.ts` throws: a warning in a test run is
read by nobody, and the state it describes is indistinguishable from a passing
rule. `pinCount(text, marker, times, where)` is there for the rules where a count
above one is the property — the two `Highlight` objects, the two `user-select`
spellings — and it is deliberately more trouble to write, because passing a number
says the number was counted rather than tolerated.

**`pinCount` has no caller but its own test today**, and is there anyway: an author
who hits `pin`'s ambiguity refusal and cannot narrow the marker has to be given a
way to say "two, and I counted them", or they will go back to `toContain` and the
hole comes back. Every one of the ten above was narrowable, which is why nothing
needs it yet.

Both refusals are exercised in `test/structural.test.ts`. A guard nobody has
watched fire is a comment.

## What this does not do

It does not stop someone writing `expect(text).toContain(marker)` again. Making
that impossible needs either a lint rule of our own or an accessor that returns
something other than a string, and both were rejected here: the first is a rule
about test style enforced a long way from the tests, and the second means
rewriting every one of the 806 searches, which is churn in the only thing standing
between this app and a silent regression. What `pin` does is make the ambiguity
**visible at the moment the marker is written**, in the one place an author is
already looking — and the twenty-one call sites it now has are the pattern the next
one will be copied from.

The scoping stays local. `rules.test.ts` slices a `function` of the WebView
program, `module.test.ts` slices a `private func` of the Swift and
`player-rules.test.ts` slices from one line to another; those conventions differ
because the languages do, and each belongs beside the rules that need it.

## Consequences

Ten rules that could not fail now can. Two claims that rested on reasoning are
closed with Node tests as part of the same pass (`notes/NOTES.md`, the collected
list). The suite went from 1,080 tests in 55 files to 1,088 in 56.
