# test

`vitest`, `environment: 'node'`, no `globals` — deliberately the same shape as
the Zotero-TTS plugin's suite, because about 3,200 lines of provider tests come
across from it (ADR 0013) and the point of matching is that they arrive
unchanged.

## The layout is the plugin's layout

Its tests import their subject by relative path — `test/core/providers/speechify.test.ts`
opens with `from '../../../src/core/providers/speechify'`. So the copied layer
lands at `src/core/providers/` under the same `test/core/providers/` as there, and
**no import path needs editing**. That is what matching the layout buys, and it is
narrower than "the tests arrive unchanged".

Measured on the first files to actually come across, 2026-09-19:
`test/core/timeout.test.ts`, `single-flight.test.ts` and `headers.test.ts` landed
verbatim; `align.test.ts` needed two wording edits for `CONTEXT.md`'s avoid-list
(`segment` → Utterance) and nothing else; `wav.test.ts` needed real edits, because
one case imported `core/silence` — a file nobody has ported — and the rest asserted
on a `Blob` that `pcm16ToWav` no longer returns (ADR 0013). `speech-text.ts` had no
test here at all: its coverage lived in the plugin's `test/read-aloud/`, above the
platform-free tree, and only the cases that touch nothing but `speech-text` could
follow.

Verified rather than assumed: `vitest` 5.0.1, from this project's
`node_modules`, was run against that repository's suite —
`vitest run --root /Users/xujialiu/Works/Zotero-TTS test/core/providers` — and
all 381 tests in 20 files passed, with and without that repo's own
`test/setup.ts`.

## What is not tested here

**React Native views.** The Vitest suite renders no native view and touches no native
module. Device scripts and the separate XCTest harness live in
[`manual-test/README.md`](manual-test/README.md); they are run explicitly against
an installed app, outside Vitest. `app/voice-lifetime.test.ts` mounts the real voice-list hook with a null
React component to reproduce loss across unmount/remount; native storage and the
Provider response are test doubles. This is a hook-lifetime check, not visual QA. That is not an omission to be filled in later with a different runner: the
platform-free half of OpenReader lives in `src/core/` precisely so that the tests
that matter need no simulator, and the half that is not platform-free is the half
whose failures are invisible on a desk anyway — notes/NOTES.md item 4 wants a
60–90 minute backgrounded session on a real device, which no test environment
substitutes for.

**The WebView.** ADR 0011 puts the renderer inside Safari's JavaScript, which no
Node test environment simulates.

## What is tested here, today

- `app-config.test.ts` — the ADR decisions that live in `app.config.ts` and
  `package.json` rather than in code, where nothing would notice them being
  undone. The UIScene plugin of ADR 0018 is one of them: deleting its line
  breaks the app at launch, on a native build, far from the line.
- `core/providers/import-boundary.test.ts` — lints source text against the real
  `eslint.config.js` and fails if ADR 0013's import boundary stops being
  enforced. A rule nothing checks is found broken at the worst possible moment.
- `app-config.test.ts` — the four ADR decisions that live in `app.config.ts` and
  `package.json` rather than in code: the iOS 17.2 floor, background audio, the
  New Architecture not being switched off, and the absence of the two playback
  libraries ADR 0012 rejected.
- `app/document-types.test.ts` — the config plugin of ADR 0019, run as a function
  against a plain Info.plist. It is the only thing in this suite that reaches a
  prebuild, and the symptom of getting it wrong is the app being **absent** from
  Files' "Open in" and from every share sheet, which nothing logs. Both refusals
  are tested as well as both writes: a guard nobody has watched fire is a comment.
- `now-playing/module.test.ts` — ADR 0016's rules, read out of the Swift and out
  of the podspec, the same tool `playback/footguns.test.ts` uses on the playback
  library. The module cannot run here; a fake `MPNowPlayingInfoCenter` would
  prove the fake was called. Every rule in it fails as nothing at all — a lock
  screen that says "paused" while the book reads, a headphone tap that does
  nothing, a pod that autolinking skipped with a warning.
- `app/no-outgoing-links.test.ts` — ADR 0017's ban on a tappable route to a
  Provider's signup, as a grep over `src/`. It used to be checkable by eye —
  `controls.tsx` could say "nothing here imports `Linking`" — and stopped being
  so when ADR 0019 let another app hand this one a Document to **open**. The
  property it now states is that nothing in `src/` **opens** a URL.

## structural.ts — the one rule about reading source text

Several of the files above guard a one-line invariant by reading the source and
asserting a marker is there. They have to: `::highlight()` and the Swift are on
the other side of a boundary no Node test crosses, and a mock would prove the
mock was called.

`expect(code(file)).toContain(marker)` has a defect that caught five authors in
five different files, one of them at the cost of the most expensive bug this
project has had: **a marker that occurs twice makes the assertion vacuous**, because
the whole-file search still matches the other occurrence after the guarded line is
deleted. A mechanical sweep of all 1,080 tests found ten real instances (ADR 0024).

So a rule that names one line calls `pin(text, marker, where)`, which throws when
the marker is absent **and** when it occurs more than once, naming the lines that
made it ambiguous. `pinCount` is for the rules where a count above one is the
property. Where the marker has to be narrowed to one line, the scoping is the
caller's: this file's own helpers slice a `function` of the WebView program, a
`private func` of the Swift, or one line to another, because those conventions
differ by language and belong beside the rules that use them.

`test/structural.test.ts` watches both refusals fire.

## setup.ts

Loaded before every test file. The plugin's version installs its en-US Fluent
strings so a test asserts the sentence a user reads; OpenReader has no strings
yet, and when it does that belongs there too.

What it does now is refuse the network. Every provider takes `fetch` as an
injected dependency, so a test that forgets to pass one would otherwise fall
through to Node's global and quietly call a real provider — slow, flaky, and
under ADR 0002 spending the owner's own money. Philosophy rule 4 is "no silent
spending", and a test suite is not exempt.
