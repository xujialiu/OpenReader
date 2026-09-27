# Providers and audio

## Native drift investigation (#63)

- **A normalized waveform correlation exceeds 1 and reports a large isolated lead near silence** (2026-09-25). FFT roundoff divided by the almost-zero variance of a silent source window amplified numerical noise; prefix-sum subtraction also loses precision there. Reject candidate windows with negligible source variance before normalization, independently of the reported position/error. Recompute both baseline and prototype measurements with the same correction. Ordinary repeated-vowel ambiguity remains and must be reported separately.

- **A previously listed simulator suddenly reports `Invalid device`, and an install reports Mach error -308 / server died** (2026-09-25). The owner confirmed accidentally deleting the devices during this run. Re-list devices rather than reusing the captured identifier; create a replacement, wait for `bootstatus`, install and silence it. The deleted container's narration cannot be recovered by merely reusing its old path.
- **CDP opens and immediately closes with 1006, even for `1+1`** (2026-09-25). Reproduced on the dedicated issue63 simulator with both a copied Debug app and a fresh native build, using dedicated Metro 8092. Cause remains unisolated; a rebuild did not resolve it. The existing `Documents/harness.json` commands still work and were used to import the test Document. Do not count a failed debugger attachment as an app or playback result.
- **A standalone native audio probe cannot find `jsi/jsi.h`.** The library's `AudioArrayBuffer.hpp` has a supported host-test seam guarded by `RN_AUDIO_API_TEST`. Compile with `-DRN_AUDIO_API_TEST=1` as `native-queue-drift.sh` does; do not substitute fake PCM/DSP code.
- **Creating an RNAudioAPI patch fails with “Your changes involve creating symlinks”, even with a source-only `--include`.** Observed with the locally installed framework artifacts and patch-package 8.0.1. Generate a unified diff for only the intended C++ source files against the exact `npm pack react-native-audio-api@0.13.5` archive, then validate application against a clean extraction and with patch-package. Do not include framework artifacts or remove live dependency symlinks to make patch generation pass.

## Real touches on the player's head row, and Azure's own timing (#69, #70)

- **A Keychain "Save Password?" sheet outlives the screen it was typed on.**
  Symptom: after `AzureProviderProbe`'s `testAzureConnectionWordingsAndEnable`
  types the real key into the masked "API key" field and finishes, a system
  sheet ("Securely store your password so it's filled automatically the next
  time you need it.", "Not Now" / "Save") is still on screen in a later probe
  run or a plain `simctl io screenshot`, covering whatever is under it. iOS 27
  offers to save a secure text field's contents as a website password the same
  as a real login form, and the offer is not tied to the screen that triggered
  it. Fix: dismiss it before relying on a screenshot or a tap that lands where
  it sits — try `app.buttons["Not Now"]` (seen hosted in the app's own process)
  and, if that is not there, `XCUIApplication(bundleIdentifier:
  "com.apple.springboard").buttons["Not Now"]` (`PlayerTouchProbe.swift`'s
  `dismissSystemAlerts`). A plain `simctl terminate`/`launch` also clears it
  (settings and Keychain persist; re-`open` the Document by id afterwards).
- **A `Pressable`'s own `accessibilityLabel` is what XCTest reads, not its
  child `Text`.** The player's Voice button carries a fixed
  `accessibilityLabel="Choose a Voice"` (`player.tsx`) so the row is reachable
  by a stable name regardless of which Voice is chosen; asserting
  `voiceBtn.label == "Andrew"` after choosing Andrew fails with `("Choose a
  Voice") is not equal to ("Andrew")` — the label never changes, only the
  rendered text does. Read the visible name from `voiceBtn.staticTexts` (may
  not be exposed as a separate element once the container has its own label)
  or, better, confirm it independently through the harness's own
  `{"do":"say"}` (`voiceInUse`) before a method that depends on it.
- **Azure's first real clip can take longer than a short handler-probe window
  to arrive.** A `reading.cjs`-style `onPlay()` → wait → screenshot →
  `onPause()` probe (`play-shots.cjs`) given 4.5 s total showed the transport
  still spinning (buffering) at both a 2.0 s and a 3.5 s shot, with no
  highlight painted yet, on this Mac's network path to Azure's `eastasia`
  endpoint. A second run with 9 s total and shots at 6 s/8 s landed after
  audio had started. Give a real-provider handler-probe play at least 6–8 s
  before the first shot rather than assuming a fixed-provider fixture's
  timing (Fish's own fixtures in `voice-playback.cjs` reply in a couple of
  hundred milliseconds by design and do not predict this).
- **A paused Utterance stays marked, which is a cheaper way to catch a
  highlight than timing a shot mid-play.** Once `{"do":"say"}` shows
  `playing=false` at a `level=word` position, a plain `simctl io screenshot`
  taken any time afterwards — no more playback needed — still shows the same
  word and sentence `::highlight()` boxes, including across a live theme
  change (`{"do":"settings","patch":{"theme":…}}`) taken while paused there.
  Useful for comparing the two themes' highlight colours from one play: play
  once, pause on a word, screenshot, flip the theme, screenshot again.
- **The Library's own remembered Voice re-asserts itself over a bare
  `{"do":"settings","patch":{"voice":""}}`.** The harness's `settings` command
  patches the global `AppSettings`, but an open Document's player reads back
  through `voiceInList(...) ?? knownVoice(...)`, and the shelf keeps its own
  `voice=` per entry (visible in `{"do":"shelf"}`); the screen kept showing the
  previously-chosen Voice's name after the patch, unchanged. Reaching the
  "choose a Voice" empty state this way was not pursued further; it likely
  needs the per-document entry cleared too, not only the global setting.
- **No real Azure voice label is long enough to force the player's own
  ellipsis.** The longest `DisplayName` across all ~691 voices the account's
  key listed is `Xiaoshuang Dragon HD Flash Latest` (33 characters,
  `zh-CN-Xiaoshuang:DragonHDFlashLatestNeural`); centred in the player it
  still fits on one line (`player-centre.py`, below). Treat the truncation
  case as code-inspection-only (`numberOfLines={1}` in `player.tsx`) unless a
  fixture voice is fabricated for it.

## Fish Audio from the simulator

- **The first Fish request after a minute or so of quiet fails with "The
  network connection was lost", and the reading stops.** The reader's note is
  `Fish Audio s2.1-pro-free: cannot reach api.fish.audio (Error: fetch failed:
  UnexpectedException: The network connection was lost. (at
  ExpoModulesCore/Promise.swift:56))`, the same words `breakfetch` imitates, and
  here nothing had broken anything. Measured 2026-09-22 on the iPhone 17: a
  reading's first synthesis failed this way 206 s and again 80 s after the last
  request to the host, and succeeded 45 s and 10 s after one. Through the app's
  own `fetch` with `cdp.cjs`, no key and no playback: a GET answered 200 in
  2.9 s; after 104 s of quiet a POST failed this way about 6 s after it was
  sent; the next POST answered 401 in 0.6 s; after another 102 s a GET answered
  200, but in about 9 s.
  - Cause, established on 2026-09-22 (notes/NOTES_2026-09-22.md, 02:29, and
    #26): Fish's API is reached over HTTP/3, which is UDP, and this Mac's
    Clash Verge Rev (mihomo, TUN mode; `api.fish.audio` resolves to the fake
    address `198.18.0.126`) drops a UDP mapping about 60 s after its last
    packet. A connection reused after that stalls for about 7 s and fails with
    -1005. The system retries a GET on a new connection, so a GET only takes
    longer, and does not retry a POST, which every synthesis is. It happens
    with no key and with nothing else using the account. Whether a phone on
    another network does the same was not established.
  - Fix for a measurement: Play again. A failed Utterance is retried when Play
    is pressed on it, over a new connection. A run that met this is not a
    result about the change under test. Start a timed play within about 45 s of
    the app's last request to the host (a cold launch makes one: the start-up
    voice listing) if the first attempt must count.
  - A download meets it too, as a delay rather than a failure, since the
    scheduler retries a retriable failure: in a `download-away.cjs home` run
    of 2026-09-28 (#75) whose download had been `interrupted` for 62 s, the
    task read `downloading` 0.1 s after coming back and its first clip was saved
    10.3 s after. A first clip that late after a quiet minute is not a result
    about the scheduler.

- **A Fish Voice chosen through the harness is `locale/id`, not the model id.**
  `{"do":"voice","provider":"fish","voice":"<32 hex digits>"}` is accepted, and
  every Play then stops with "Unknown Fish Audio voice: …" (2026-09-26, #71).
  Send `{"do":"ask","provider":"fish"}`, then `{"do":"voicelist","provider":"fish"}`,
  and use the id as a `voice` line prints it, e.g. `en/e3cd384158934cc9a01029cd7d278634`
  ("Laura").

## Node probes against providers and books

- **Node's `WebSocket` sends no upgrade headers** (2026-09-24, #61). `createAzureProvider` passes its key as a third constructor argument, `{ headers }`, which React Native honours. Node 22's global `WebSocket` takes only `(url, protocols)`, so the key never reaches Azure. `context-probe.ts` wraps it in `QueryHeaderWebSocket`, which moves each header into the URL's query, where the desktop plugin puts the key for the same reason.
- **A silence threshold that suits one voice hides another's pauses** (2026-09-24, #61). At −40 dB below the loudest 10 ms window, Fish's "jjk narrator" measured almost no silence between sentences, because its breath and room noise sit near −37 dB. Its whole-paragraph median came out at 0.16 s where its own word timings said 0.32 s. At −30 dB the two agree, but Azure then reads about 70 ms long. Check a threshold against a provider's word timings (Azure's and Fish's leave the pause between words) before trusting it, and quote each provider at the threshold that agreed.
- **An EPUB's OPF is namespaced, and a cover page may not parse** (2026-09-24, #61). `@xmldom/xmldom`'s `getElementsByTagName('item')` found 0 items in every book in `~/Works/epub_books`; `getElementsByTagNameNS('*', 'item')` finds them. A cover page with an unclosed `<img>` throws `ParseError` even when parsed as `text/html`, so parse each spine item in a `try` and skip the one that fails.
