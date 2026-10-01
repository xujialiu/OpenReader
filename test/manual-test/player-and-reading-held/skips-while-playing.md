# Issue #86 on the simulator: no debounce on a tap or Skip while playing; a Contents row while playing

Verified 2026-09-29 on `iPhone 18 issue86` (`9F8F6EE8-90A7-411E-AF61-54700D1E12E5`,
iOS 27.0), tree `xujialiu/logic--ios-test` at 3c54209 (`0.0.2-beta56`), Metro on
8099, and a fake Kokoro provider (this folder's `fake-kokoro.cjs`) at
`127.0.0.1:8791`, chosen through the harness (`settings` patch
`provider=local`, `local.baseURL=http://127.0.0.1:8791`, then `{"do":"voice"}`).

The measured fact for "no 600 ms wait" is the **fake provider's request log**
(one line per synthesis, counter + UTC millisecond time + the text asked for,
which maps to one Utterance because every fixture sentence names itself), read
against the app's Debug Log `[reading] skip/seek` lines and the probe's own
press stamps. The Debug Log stamps at write time and flushes in order 2 s
later (`src/debug/debug-log.ts`), so file order is event order; lines ~100 ms
after a fetch usually belong to a clip boundary's own read-ahead, not the
press — attribute before quoting.

- `issue86-fixture.ts` (in `../fixtures/`) — five chapters, 40 Utterances, a
  text-less "Volume Two" page shaped like the owner's 仙逆 chapter56, an **NCX**
  contents (see the fixtures README for why an xhtml nav leaves every row
  unreachable). Chapter headings are Utterances: 0 = "The First Chapter".
- `fake-kokoro.cjs` — serves `GET /v1/audio/voices` and
  `POST /dev/captioned_speech` (2.5 s of silent PCM + word timestamps), logs
  every request to `$OPENREADER_FAKE_TTS_LOG` (default
  `/tmp/openreader-issue86/fake-tts.log`). Since #109 it also answers
  `GET /v1/models` and OpenAI's `POST /v1/audio/speech`, ends each synthesis
  line with `route=` and `auth=present|absent`, and waits
  `$OPENREADER_FAKE_TTS_DELAY_MS` before answering
  (`../voices-and-providers/consent.md`). The app plays silence at volume 0;
  the 2.5 s clips leave old audio that a debounced press would have let keep
  sounding.
- `Tap86Probe.swift` — the real touches: a page tap while playing and while
  paused, five quick Next-sentence presses, each of the other three Skips, and
  paused Skips. Params in `/tmp/openreader-tap86-params.txt` (`TAP_NX`,
  `TAP_NY` — the tap point's normalized coordinates). The tap point itself
  comes from a `{"do":"js"}` probe that walks to the section iframe and returns
  the target span's centre normalized by `window.innerWidth/innerHeight` (the
  WebView sits at the safe-area top inset; for s23 that was `0.5/0.4371` and
  the tap landed on exactly the utterance the probe predicted).

The run's measurements, with their times, are in
`notes/NOTES_2026-09-29.md`, the 20:28 entry.

## What was measured (all pass)

- **Tap while playing** (real touch, mid-clip): `seek to utterance N` the same
  instant as the press; the engine's window jumps to the new cursor at once
  (next-cursor fetches 63 ms after the seek line); the old queue's next
  Utterance never cues and the highlight never returns; pause lands on the
  reading that followed the tap.
- **Five quick presses of Next sentence** (real touches 330–500 ms apart, all
  inside one old 600 ms window): each `skip … from` line counts from the
  previous press's target; ends on start+5. Cache-hit seeks are immediate —
  no fetches, because earlier runs had cached the chapter.
- **Each of the four Skips while playing**: skip and seek lines share the same
  millisecond; the uncached target (Previous sentence) was fetched 134 ms
  after the app's own skip line; the cached three sought instantly. Presses
  ~2.6 s apart let clip boundaries move `atRef` between presses — read the
  `from` utterance rather than assuming.
- **A Contents row to a text-less page while playing** (fixture, real touch on
  the sheet row): `contents row 2 while playing: utterance 20` at the press,
  The Third Chapter's heading and first sentences fetched ~300 ms later, no
  cue of the old sentence (its boundary was 0.1 s away and never fired), page
  moved to The Third Chapter.
- **A Contents row to an unrendered chapter while playing** (the owner's real
  仙逆, handler probe `{"do":"section","section":58}` = 第二卷 修真血影, 2077
  spine items, 4 rendered): `wait for section 58` at the press, reported empty
  77 ms later → read past → `wait for section 59` → first fetch of 第55章
  夺基大法 323 ms after the press, **nothing fetched between press and then**,
  the old clip (2.1 s left) never cued, and the reading resumed at the next
  chapter's first sentence. The whole wait was ~300 ms — too fast to
  photograph the buffering spinner; the state trace (playing=true with an
  empty queue between press and first cue) is the evidence.
- **Paused**: a real page tap moves the highlight and starts nothing (no
  fetch, Play stays Play); two real Skip presses move the highlight and fetch
  nothing.

## What this recipe cannot prove

- The buffering spinner's look during a Contents wait: the real book's wait
  resolved in ~300 ms. A fixture whose next chapter renders slowly (a large
  file, or a breakFetch-style stall of the renderer) would hold the spinner
  visibly.
- A Contents chapter that never reports (spinner until the owner taps
  elsewhere), a voice switch during the wait, the lock screen's state during
  the wait: not probed.
- The "nothing after this point can be read aloud" note: `readingFromRow`'s
  `end` branch is unit-tested (`test/app/segment.test.ts`), not exercised on a
  device here.
