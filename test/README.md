# test

`vitest`, `environment: 'node'`, no `globals` — deliberately the same shape as
the Zotero-TTS plugin's suite, because about 3,200 lines of provider tests come
across from it (ADR 0013) and the point of matching is that they arrive
unchanged.

## The layout is the plugin's layout

Its tests import their subject by relative path — `test/core/providers/speechify.test.ts`
opens with `from '../../../src/core/providers/speechify'`. So the copied layer
lands at `src/core/providers/` under the same `test/core/providers/` as there, and
no import needs editing. The same holds for `test/core/align.test.ts`,
`test/core/wav.test.ts` and `test/core/webdav.test.ts`.

Verified rather than assumed: `vitest` 5.0.1, from this project's
`node_modules`, was run against that repository's suite —
`vitest run --root /Users/xujialiu/Works/Zotero-TTS test/core/providers` — and
all 381 tests in 20 files passed, with and without that repo's own
`test/setup.ts`.

## What is not tested here

**React Native code.** Nothing in `test/` renders a component or touches a native
module. That is not an omission to be filled in later with a different runner: the
platform-free half of OwnReader lives in `src/core/` precisely so that the tests
that matter need no simulator, and the half that is not platform-free is the half
whose failures are invisible on a desk anyway — notes/NOTES.md item 4 wants a
60–90 minute backgrounded session on a real device, which no test environment
substitutes for.

**The WebView.** ADR 0011 puts the renderer inside Safari's JavaScript, which no
Node test environment simulates.

## What is tested here, today

- `spike/hermes-support.test.ts` — the probes of notes/NOTES.md items 1 and 2.
  It does **not** answer them; it runs on V8. What it checks is that the probes
  assert the right cases and that a probe reports a crash instead of causing one.
- `core/providers/import-boundary.test.ts` — lints source text against the real
  `eslint.config.js` and fails if ADR 0013's import boundary stops being
  enforced. A rule nothing checks is found broken at the worst possible moment.
- `app-config.test.ts` — the four ADR decisions that live in `app.config.ts` and
  `package.json` rather than in code: the iOS 17.2 floor, background audio, the
  New Architecture not being switched off, and the absence of the two playback
  libraries ADR 0012 rejected.

## setup.ts

Loaded before every test file. The plugin's version installs its en-US Fluent
strings so a test asserts the sentence a user reads; OwnReader has no strings
yet, and when it does that belongs there too.

What it does now is refuse the network. Every provider takes `fetch` as an
injected dependency, so a test that forgets to pass one would otherwise fall
through to Node's global and quietly call a real provider — slow, flaky, and
under ADR 0002 spending the owner's own money. Philosophy rule 4 is "no silent
spending", and a test suite is not exempt.
