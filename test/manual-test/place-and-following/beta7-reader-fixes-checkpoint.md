# The reader fixes #96/#195/#196 (1.0.0 (9)-beta7) — checkpoint, device verification not yet run

Revision `bb43c22` on `xujialiu/fix3--ios-check` (scope `0665d55..bb43c22`:
`use-reading.ts`, `reading-view.tsx`, `reader-bridge.ts`, `highlighter.ts`,
`app-version.ts` → `1.0.0 (9)-beta7`). Host-side, the parent ran the full
Vitest suite (209 files/2946 tests), `tsc` and ESLint green, with the
regression tests for these fixes red before and green after. What is missing
is the **on-device** verification. The first attempt was stopped before its
build by the shared iOS lane: the slot was held the whole time by another
session's main-worktree physical-phone install, the bounded admission wait
(900 s) ran out, and the attempt closed as BLOCKED per the shared gate — no
build, install, launch, playback or device check happened. This record is the
checkpoint and the runbook to resume.

Prepared and left behind by the stopped attempt (all paths under `/tmp`, none
of them touched by another session):

- Simulator `openreader-fix3-ioscheck`, UDID `D066DF98-E7A9-4AE4-AB0A-898900AE4AD9`
  (iPhone 17 Pro, iOS 27.0), created, **booted**, app **not installed**.
- `npx expo prebuild --platform ios` completed in the worktree (`ios/` exists,
  gitignored); the guarded build phase never started.
- Metro on port **8085** from this worktree (log
  `/tmp/fix3-ioscheck-01/logs/metro-8085.log`), bundle never requested.
- `provider-fault-server.cjs` on **8811** (log `logs/fault-server-8811.log`),
  speech `ok-pcm`, voices `ok` — the controlled local TTS for every Play.
- `cacheable-dav.cjs` on **8790** with
  `OPENREADER_FIX2_DAV_STATE=/tmp/fix3-ioscheck-01/davstate` (log
  `logs/dav-8790.log`) — the controlled WebDAV for the #96 remote-adoption
  check. Its state is untouched (`served: null`).
- Attempt directory `/tmp/fix3-ioscheck-01/` (logs, `build-phase.json` exit
  record, `owned.txt` resource ledger).

New kit pieces written for this verification (committed with this record):

- [`scrollby-probe.js`](scrollby-probe.js) — the #196 page harness. Wraps
  `rendition.manager.scrollBy` (the call the drift's `nudge` makes) and samples
  `scrollTop` per drawn frame; each call after the first answers one JSON
  window: scrollBy call count, pixels requested vs actually moved, failed
  calls by direction, frame rate, and the container geometry (`atTop`,
  `atBottom`). At an unreachable boundary before the #196 fix the call rate is
  the frame rate with zero movement; after it the rate collapses to a few per
  second (one per cue) and stays flat. It reads the page's own production
  path — not a stationary screenshot.
- [`entry-place.cjs`](entry-place.cjs) — the #96 persisted-state reader:
  prints one Document's position (`cfi`, `anchor.exact`, `stamp.at`,
  `stamp.device`) straight out of the container's `Documents/library.json`,
  the file `writeLibrary` writes and the next launch reads.

## The runbook, from the checkpoint

1. Admission: one `ios_guard.py run` phase that builds
   (`xcodebuild -workspace ios/OpenReader.xcworkspace -scheme OpenReader
   -configuration Debug -sdk iphonesimulator -destination id=<UDID>
   -derivedDataPath /tmp/fix3-ioscheck-01/dd`), installs on
   `D066DF98-…`, `silence.sh set`, launches with
   `-RCT_jsLocation localhost:8085`, waits for the app on Metro's
   `/json/list`, then `ios_ready.py --metro http://127.0.0.1:8085`. The
   interrupted attempt's phase script is preserved at
   `/tmp/fix3-ioscheck-01/build-phase.sh`.
2. Setup: copy `~/Works/epub_books/Shadow Slave/Shadow Slave 1-250.epub` into
   the app's `Documents/Inbox`, add it with the harness (`{"do":"add"}`), open
   by Document Id. Patch the Provider through the harness
   (`provider: 'compatible'`, `compatible: { baseURL: 'http://127.0.0.1:8811/v1',
   model: 'fixture-tts' }`, `voice: 'fixture-willow'`), answer the Consent
   alert for `127.0.0.1:8811` once (`ax.py alert` / `alert-touch Allow`),
   and establish the control: a 5 s Play with a real synthesis request in the
   fault server's `/__log` and an advancing utterance — not a spinner.
3. #96, with `library.json` (via `entry-place.cjs`) read before and after
   every step: a real touch on a word while paused, then leave and reopen —
   the persisted position/Stamp must not move; the same for all four
   `{"do":"skip","target":…}` values and a paused Contents choice; a Play
   held by `speech=stall` (request visible in `/__log`, nothing played) must
   save no unheard text; a real Play from the selected cursor must save and
   advance; a tapped-but-never-played leave must persist no position at all.
   Remote adoption through the DAV stub keeps the served Stamp and uploads
   the same Positions-File shape.
4. #195 with [`webcontent-killed.sh`](../library-and-reader/webcontent-killed.sh)
   (UDID-scoped to `D066DF98-…`'s own `launchd_sim`): playing, browse a
   distant chapter (`{"do":"section","section":N}`), kill, and the new page
   must come back on the **reading's** chapter with the highlight painted —
   not the pre-kill browsing target — with no "The highlight could not be
   drawn" note; then a skip works off the reported sections, and a second
   browse proves Browsing is not stolen.
5. #196: `following: { scrolling: 'continuous' }`, arm
   `scrollby-probe.js`, and measure at the true bottom of the last section
   and the true top of the first: failed whole-pixel calls with `atBottom`/
   `atTop` true, then the call rate collapsing (the rest), a mid-chapter
   control that actually moves, and a wake when the cursor is seeked away.

## What it cannot prove

Nothing on this record was measured on a simulator: the admission never came.
Everything above is prepared tooling and a reading of the diff. The host suite
the parent ran remains the only executed check of these fixes so far.
