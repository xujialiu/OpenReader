# Evaluating in the app through `cdp.cjs`

## Evaluating in the app through `cdp.cjs`

- **`OPENREADER_METRO=http://localhost:PORT` closes with 1006 before any
  answer, even for `1+1`; `http://127.0.0.1:PORT` answers.** Measured
  2026-09-28 02:26 (#75–#77) against this tree's own Metro on 8091, one
  OpenReader target listed in `/json/list`: `localhost` gave `Debugger
  disconnected before completion: 1006` on every try, and the same probe with
  `127.0.0.1` returned `{"type":"number","value":2}` at once. `cdp.cjs` takes
  the WebSocket URL from `/json/list`, whose host follows the one asked, and
  its origin from that URL, so the whole exchange moves with it. Leave
  `OPENREADER_METRO` unset (its default is `127.0.0.1:8081`) or give it
  `127.0.0.1`; the unisolated 1006 of 2026-09-25 in
  [providers-and-audio.md](providers-and-audio.md) may have been this.
- **A loop's closures all see its last value.** What `--eval` sends is compiled
  by Hermes as written, with no Babel pass, and a `for (const x of list)` loop
  does not give each turn its own `x`. Measured 2026-09-23: three wrappers made
  in such a loop over `['a', 'b', 'c']` all called the third method, and three
  arrow functions over `[1, 2, 3]` all returned 3. Four counting wrappers put on
  the offline repository that way all ran `readClip`, the runtime stored its
  answer as a document's inventory, and `hasSavedVoice` said false for a book
  with 72 saved clips until the app was restarted. Loop with `list.forEach(x =>
  …)`, which gives each item a function of its own, and restart the app after
  any probe that replaced a method, before measuring anything else.
- **Each of the harness's `fetch` commands replaces whatever `fetch` was there.**
  `breakFetch`, `watchFetch` and `unbreakFetch` in `walkthrough-harness.ts` each
  set `globalThis.fetch` to a new wrapper around the `fetch` captured when the
  module loaded, never around the one installed now. So `breakfetch` after
  `watchfetch` drops the request log, and `unbreakfetch` leaves no wrapper at
  all: neither `watchfetch`'s nor one a probe installed through `--eval`.
  Measured 2026-09-23, twice, verifying #45: after a `breakfetch`/Play/
  `unbreakfetch` cycle, the retried Play's requests produced no `HX fetch …`
  line, and a probe's own request log went empty. Send `watchfetch`, or
  reinstall the probe's wrapper, straight after `unbreakfetch`.
- **A request `breakfetch` refuses still counts as contact for #26's warm-up.**
  `warm-connections.ts` counts any settled request as having reached its
  origin, a refusal included, because a real refusal did go over the
  connection. `breakfetch`'s refusals never touch the network, so after
  `unbreakfetch` the next request within 30 s is sent without a warm-up, over
  a connection that may have idled for minutes. On 2026-09-23 that retry
  failed for real, with the production wording `Error: fetch failed: … The
  network connection was lost …` rather than the harness's `TypeError: …`, and
  a second Play a minute later, preceded by a warm-up GET, went through. Wait
  30 s after `unbreakfetch`, or expect that one real failure.
- **zsh's `echo` turns a `\n` inside a probe into a real newline.** A probe
  written with `echo '(() => … join("\n") …)()' > probe.js` held a line break
  inside its string, and `cdp.cjs --eval probe.js` answered `Compiling JS
  failed: 1:86:non-terminated string`. Write probes with a quoted heredoc
  (`cat <<'EOF' … EOF`) or in an editor.
- **A fiber-walked "engine" ref reads as `undefined` right after a fresh
  `open`, even once `status().known` is already positive.** Measured
  2026-09-24 verifying #60/ADR 0047 (`pause-gap.cjs`): calling
  `engine().seek(N)` through the same `refs().find(v => v?.current?.snapshot
  && v.current.switchVoice)?.current` technique `voice-playback.cjs` uses threw
  `TypeError: Cannot read property 'seek' of undefined`, although the reader
  was fully laid out (`status().known` was already 6). Cause:
  `use-reading.ts`'s `engineRef` is built lazily, only inside the first
  `play()` call (`build()`), never on open — a dump of every `ReadingView` hook
  (`refs()` with no filter) showed every candidate `ref.current` as `null`
  before any Play, engine-shaped keys included. Fix: seek **before** the first
  Play through the file harness's own `{"do":"seek","utterance":N}`
  (`reading.seekTo`), which sets `atRef`/`status.utterance` synchronously with
  no engine at all — "the engine that gets built will be loaded there" is the
  comment on `seekTo` itself — then call `player().onPlay()` through CDP as
  usual. `engine().seek()` is only for a reader that has already played once
  this mount.
- **The `frame` of a `Menu`'s own item lands inside its answer, so ordering it
  is just reading `frame.origin.y`.** Verifying #60 (`PauseMenuProbe.swift`),
  ten items found by `app.descendants(matching: .any).matching(label ==)` and
  read in declared order gave a strictly increasing `frame.origin.y` at both
  the default and a larger Dynamic Type, which is what proves `menuOrder
  ('fixed')` held rather than SwiftUI reversing the list on an upward open. No
  video or screenshot needed for this one; the frame is enough.
- **`pause-gap.cjs` can time out on one of its first CDP calls, right after its
  own `open`.** Measured 2026-09-25 01:08: a run printed only `CDP timeout` and
  no `SAMPLE` line. The Metro log's last status line was `playing=false
  utterance=null known=0`: the reader was still opening, and nothing had played.
  The same command 30 s later ran normally. Cause not isolated beyond that
  timing. Fix: confirm the last `HX playing=` line says `playing=false`, `set`
  the simulator's volume again, and rerun.
- **A count assertion on a `Text`'s own label should expect the RN doubling
  documented above (`app.staticTexts["Folder"] matches twice`), not 1.**
  Verifying #60, `app.staticTexts.matching(label == 'Reading aloud').count`
  read `2` for a page with exactly one such header, not `1` — the same
  per-`Text` duplication, just counted instead of looked up. A regression that
  actually repeats a header would show `4`, not `2`.
