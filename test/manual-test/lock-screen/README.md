# The lock screen and the playback icon

## Lock-screen screenshot and button inspection

Prerequisites: macOS, Xcode selected by `xcode-select`, a booted iOS simulator,
Ruby with the `xcodeproj` gem (also used by CocoaPods), and the latest app installed.
Get the device ID with `xcrun simctl list devices booted`.

Open a Document, briefly play, then pause before running this inspection. It
captures the existing card and does not start an OpenReader reading. Use a fresh
output directory for each run:

```sh
bash test/manual-test/kit/run-probe.sh LockScreenProbe SIMULATOR_UDID /tmp/openreader-lock-screen-01 --expect-player
```

`kit/run-probe.sh` generates a disposable XCTest project; `LockScreenProbe` activates OpenReader, swipes
from the **top left** to open Notification Centre's lock-screen surface, records
its accessibility tree, center-button geometry and screenshot, then returns to
the app. Right-side swipes open Control Centre instead. This verifies the card
surface; it does not establish behaviour under actual device locking.

A missing center button fails the default XCTest assertion. **An accessible button
can still be invisible**: review the attached screenshot as well. Enabled state,
a screenshot and an actual press establish different facts; none substitutes for
the others. Artifacts live in `result-STAMP.xcresult`, `attachments-STAMP/` and `test-STAMP.log`.
The script exits nonzero when the build or XCTest fails. To capture a surface
where no player is expected, leave out `--expect-player` and pass `--bundle BUNDLE_ID`.

The owner reported normal lock-screen display on a physical iPhone after the
simulator's invisible-icon reproduction. Treat that reproduction as a simulator
display issue unless new device evidence contradicts it; the existing app
integration remains unchanged. See the dated engineering log for measurements
and the limits of the owner-reported device check.

## The lock screen's playing state on a physical iPhone

```sh
PYMOBILEDEVICE3=DIR/bin/pymobiledevice3 bash test/manual-test/lock-screen/lock-screen-state.sh IPHONE_UDID SEQ [SECONDS_AFTER_PAUSE]
```

Prerequisites: the iPhone connected and unlocked, OpenReader in front with a
Document open whose Voice is ready (saved offline narration costs nothing), and
`pymobiledevice3` (see **Physical iPhone logs and the lock screen's state** under
Pitfalls). `SEQ` is the first of two new harness sequence numbers.

It streams `mediaremoted`, sends Play through the harness, waits for
`isPlaying changed to true`, lets two seconds play, sends Pause, and waits for
`isPlaying changed to false`. Exit 0 is GREEN, 1 RED (still playing after the
pause), 2 when Play was never seen. About 15 s, two of them audible on the
phone. It prints the state, rate and `inferred playback state` lines, which are
what the lock screen's centre button follows on the device.

Measured 2026-09-25 (#66), iPhone 16 Pro, iOS 27.0: the `0.0.1` build went RED
on every run (the state stayed Playing at least 50 s after a pause); `0.0.2-beta29`
went GREEN four times in a row, the last three on one engine without a relaunch.
It establishes what the system believes, not the drawn icon, and it does not
press the lock screen. Whether the lock screen's own Play resumes a paused app
iOS has since suspended needs a person, or an XCUITest run on the device: on
beta29 the owner paused, locked the phone, waited over a minute and pressed the
lock screen's Play, and the reading went on (2026-09-25).

## Inspect the simulator's playback icon resource

```sh
bash test/manual-test/lock-screen/check-media-resources.sh SIMULATOR_UDID /tmp/openreader-media-resources
```

This read-only diagnostic resolves the selected simulator's runtime root, checks
the `PlayPauseStop.ca` index references, then asks that simulator's Core Animation
to load the package. It also queries MediaControls' actual asset factory when
available, to distinguish its lookup from the direct package probe. Exit 0 means
the direct probe loaded a root layer; exit 1 means it did not;
exit 2 means the private inspection API is unavailable. It does not modify the
runtime. Private API usage stays in this external diagnostic, never in the app.
A missing root layer does not by itself test app transport; pair it with the
lock-screen screenshot and enabled-button observation.

### Tap the actual lock-screen transport

After `silence.sh set SIMULATOR_UDID`, with the reading already paused:

```sh
bash test/manual-test/kit/run-probe.sh LockScreenProbe SIMULATOR_UDID /tmp/openreader-transport-01 --expect-player --mode tap
```

This takes the paused screenshot, taps the system's Play button, waits up to
three seconds for its label to become Pause, then immediately taps Pause and
checks for Play again. Failure paths also attempt to pause in the app. It refuses
a simulator whose own volume is not zero. Read the test log to
report the actual interval between the two taps. This exercises real simulator
touches; it still needs screenshot inspection to establish icon visibility.

For the dark lock-screen card's invisible-icon reproduction, the exported
`center-button` JSON carries the actual button rectangle. Run:

```sh
swift test/manual-test/lock-screen/center-icon.swift SCREENSHOT_PNG CENTER_BUTTON_JSON
```

The check requires more than ten pixels in that rectangle whose minimum RGB
component exceeds `195/255`. It failed with **zero** on the original screenshot.
This is deliberately a narrow dark-card regression signal, not an icon detector:
a light wallpaper can cause a false positive. Use the attachment manifest to pair
the screenshot and geometry, and visually confirm any pass.

### The in-app Play/Pause button through a suspend and resume (#66)

With the fixture Document open and a Provider configured, silenced:

```sh
bash test/manual-test/kit/run-probe.sh PauseSuspendProbe SIMULATOR_UDID /tmp/openreader-pause-suspend-01 -only-testing:testPauseResumeOrderingAndSkip
```

Real XCTest touches only, on the reader's own transport, never the lock
screen's. Checks the Settings version line first (so a JavaScript-only change
is proven current, the same reasoning as `SettingsVersionProbe`), then: Play,
Pause, Play, Pause (each Play must resume and keep playing, not just flip the
button); a Pause immediately followed by Play, measured (`driving`'s ordering
queue, ADR 0012); two taps of Next sentence while paused followed by Play
(plays from the skipped-to sentence, not the old one). After every phase it
checks the player's own notes and the LogBox banner for anything naming
`suspend`, `resume` or `audio context`. It never touches the lock screen —
pair it with `LockScreenProbe`'s `tap` mode above for the remote-transport half
of #66. Measured 2026-09-25: a full run (four Play/Pause cycles, a measured
quick toggle, and a skip) passed with 0 failures in 49.9 s, and Metro's own
`HX` log independently corroborated continuous `utterance` progress —
including across a chapter boundary — through every pause and resume, never a
reset. It does not prove the lock screen's own icon or inferred state, which
only a physical device can (`lock-screen-state.sh`).

The script runs `testPauseResumeOrderingAndSkip` only. `testQuickToggleTight`
taps Pause and then Play with no wait between them; run it by building the
project the same way and passing
`-only-testing:LockScreenProbe/PauseSuspendProbe/testQuickToggleTight`, on a
fresh launch seeked back to the first sentence. It passed twice at 0.69 s
between the taps on 2026-09-25; one earlier run at 0.82 s failed on a LogBox
banner (Pitfalls, "A LogBox banner can appear with no `WARN`/`ERROR` line").

### The Now Playing artwork on the card: a Cover whole on a square, and what fills its sides (#119, 2026-10-01)

Prerequisites: two Documents — one with a Cover, one without (the owner's
`~/Works/epub_books`: *Reverend Insanity 1-250* has a 300×400 Cover;
*My Vampire System 1-250* has none) — and a Provider that answers at once: the
fake Kokoro, `../player-and-reading-held/fake-kokoro.cjs PORT`, its log pointed
somewhere session-local. The books go in through the harness the usual way
(`Inbox` + `add`, above under **Real books**), then the Provider is two harness
commands while the Reader is open — **both** are needed:

```sh
node test/manual-test/kit/hx.cjs UDID '{"do":"settings","patch":{"provider":"local","enabledProviders":["local"],"local":{"engine":"kokoro","baseURL":"http://127.0.0.1:PORT"},"voice":"af_bella","consent":["provider:local@http://127.0.0.1:PORT"]}}'
node test/manual-test/kit/hx.cjs UDID '{"do":"voice","provider":"local","voice":"af_bella"}'
```

The `settings` patch alone is not enough: the reader reads the **Document's**
voice (`settingsForDocument`), and without the `voice` command the next
`{"do":"play"}` is refused in silence — the Debug Log's
`[reading] play at utterance none, local ` names it: the voice after
`local` is empty (see `../pitfalls/verification-runs.md`). `consent` holds the
provider's recipient key (`provider:local@http://127.0.0.1:PORT`), which
answers the first-send question without the alert.

Then: `play`, press Home (`test/manual-test/kit/lock-device.sh UDID home`) so the app is
backgrounded and playing, and capture the card:

```sh
bash test/manual-test/kit/silence.sh set UDID >/dev/null && bash test/manual-test/kit/silence.sh check UDID && \
bash test/manual-test/kit/run-probe.sh LockScreenProbe UDID /tmp/openreader-artwork-01 --expect-player
python3 artwork-sides.py /tmp/openreader-artwork-01/attachments-*/lock-screen_0_*.png
```

(`run-probe.sh` exports attachments under timestamped names; `manifest.json` in
the same folder maps them. Reusing one output directory across runs is fine for
the same probe and saves the rebuild.)

Measured 2026-10-01 (iPhone 17 Pro player_top-119, iOS 27.0, 1.0.0-beta7,
12a0694): the Cover book's card draws the 300×400 cover **whole**, centred on a
1120 px (373 pt) square — strip aspect measured 0.7518 against the source's
0.75, so nothing is cropped or stretched — and the side bands read a flat
neutral **(238, 238, 238)** while the wallpaper beside the card is (69, 84, 99):
the bands are the system's artwork material, not the wallpaper, not white, not
black. Pausing keeps the picture; on a fresh start from the lock screen the
card arrives already carrying the Cover (a 25 s `simctl io recordVideo` of the
locked screen, frames at 4/s: no card → card with the Cover, nothing between).
`artwork-sides.py` prints the square, the strip and the band colours, and
says so in `reading:`; it needs a tall Cover (a square one has no bands), and
it measures the card only.

**The Dynamic Island cannot be verified on this simulator**: `simctl io
screenshot`'s framebuffer on iOS 27.0 carries no island — no compact Now
Playing while a reading verifiably plays in the background, and not even the
sensor housing on the Home Screen (it appears on the locked screen). Control
Centre opened with no tiles at all, no Now Playing widget. The card is the one
observable surface; it and the island are filled by the same
`MPMediaItemPropertyArtwork` key (ADR 0016), so they cannot differ. See
`../pitfalls/simulators.md`.

The cover-less book's expected icon could not be shown at all on this build:
its first `show` throws —
`UIImage(named:in:compatibleWith:)` of the app's own icon asset raises
`*** Assertion failure in -[_UIImageCGImageContent initWithCGImageSource:CGImage:scale:], _UIImageContent.m:742`
on iOS 27.0, the Expo boundary turns it into
`Exception in HostFunction: <unknown>` at `src/now-playing/index.ts`'s
`lockScreen().show(...)`, and the reader dies on a **Render Error** (RedBox),
the document closes, and the lock screen is left with no card. Reproduced from
a fresh launch, and again in dark mode; the native frames and the assertion are
in the #119 report.

### The icon after the fix, dark mode, switching, and pausing (#119b, 2026-10-01)

Re-verified on `7ec9f52`: the Swift no longer reads the app icon set; the
config plugin copies `assets/icon/icon.png` into the catalog as the image set
`NowPlayingIcon` (check the delivered app with `xcrun assetutil --info
APP/Assets.car | grep -A8 NowPlayingIcon` — one 1024×1024 rendition, scale 1).
The same invocation as above, with the cover-less book playing:

```sh
bash test/manual-test/kit/run-probe.sh LockScreenProbe UDID /tmp/openreader-artwork-02 --expect-player
python3 artwork-sides.py /tmp/openreader-artwork-02/attachments-*/lock-screen_0_*.png
```

For a square artwork the script no longer stops at the missing strip: it
checks the square's edge columns (one corner radius in — inside the rounded
corners they read the wallpaper) and, when they are light on every row, reports
`square artwork fills the square …: no side bands` with the four corners'
colours, and exits 0. A row that keeps a dark edge column still fails honestly.

Measured (iPhone 17 Pro player_top-119, iOS 27.0, 1.0.0-beta7, Debug over
Metro 8119, the fake Kokoro on 8811): the cover-less book's card draws the
icon — white background, blue headphones, orange wave — **sharp, filling the
1120 px (373 pt) square edge to edge, no side bands** (edge columns light on
504/504 rows); corners (235, 235, 235) at the top and (209, 209, 209) at the
bottom — the icon's white over the card material's own vertical gradient, R=G=B
throughout; ~23 % of the square's samples are the headphones' blue, ~5 % the
wave's orange. **In dark appearance the card still shows the white default
icon** — same square, same corners, 22.8 %/5.1 % — `UIImage(named:)` without a
collection loads the Any/light rendition, as the issue chose. The Cover book in
dark mode reads side bands of **(238, 238, 238) — the same light artwork
material as light mode** — over a dark wallpaper beside the card (56, 59, 71):
iOS does not darken the artwork's transparent sides; the card surface below
darkens, the artwork material does not. Switching books in one app session (no
relaunch), Reverend Insanity → My Vampire System → back, each Document's first
`play` moves the card to its picture (icon ↔ Cover, strip aspect 0.7518 both
times the Cover shows), and after a pause the card keeps the Cover with the
centre button's label `Play` — pausing does not blank or swap the picture.

Take each run's attachments from **its own** `attachments-STAMP` directory —
`ls -td OUTPUT/attachments-* | head -1` after confirming the run's stamp in the
probe output — not `ls -t` across the whole output directory: a run the runner
refused (sim volume, below) leaves the previous run's files the newest, and an
unexamined `ls -t` copy then documents the wrong capture (caught here because
the refused run's `Executed` line was missing from a grep-filtered output; see
`../pitfalls/shell.md`).

### Black bands beside the Cover (#119c, 2026-10-01)

Same invocation, `artwork-sides.py` on the Cover capture. Since 2ad77c0 the
tall Cover sits on an **opaque black** square (`NowPlayingPicture.squared`
fills black first), so the bands read near-black and the light-band strip
isolation fails honestly; the script now answers this case first — two
near-black column clusters with a mostly non-black middle between them — and
falls through to the two paths above for a square artwork. It cannot
distinguish an opaque black fill from transparency onto a black surface; that
is decided by the wallpaper beside the card **not** being black, which it
prints. A pure-black Cover defeats the middle-picture test and fails honestly.

Measured (same device, `1.0.0-beta8`, Debug over Metro 8119, the fake Kokoro
on 8811): the card draws the 300×400 Cover **whole and centred** on a 1120 px
(≈373 pt) black square — strip aspect 0.7527, gaps 139/138 px — and **both
bands read (0, 0, 0)** at the top, middle and low of both sides, in **light
and dark appearance alike**; the wallpaper beside the card reads (70, 76, 90)
light and (58, 63, 77) dark — not black, so the bands are the artwork's own
fill. The cover-less book still shows the icon filling its square edge to edge
(edge columns light on 504/504 rows, corners (235, 235, 235)/(209, 209, 209)),
no bands, and one session's RI → MVS → RI switch moves the card each time with
no RedBox. The Dynamic Island stays unverifiable on this simulator (above);
it and the card share the one artwork key.

The probe refuses any `--expect-player` run while the simulator's own volume
is not zero, **including a capture of an already-paused card that will play
nothing** — re-run `silence.sh set UDID` right before such a run too; the
volume had reset to 60 twice within a few minutes on this device with nothing
playing.
