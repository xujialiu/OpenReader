# A section crossed with the app away from the screen (#112)

The owner's phone stopped a Reading for good after it crossed into a chapter
with the phone locked (#112). This recipe makes the crossing happen on the
simulator in about 90 s, and says whether the section after it was rendered
while the app was still away.

## Setup, once

- A simulator with a Debug app on this tree's Metro (`docs/install-on-simulator.md`),
  its volume at zero (`kit/silence.sh set`).
- A long real book (**Real books** in [../README.md](../README.md)); #112 used
  *My Vampire System 251-500*, whose chapters are 90 to 200 sentences.
- A Provider that answers at once and costs nothing: the fake Kokoro in
  `player-and-reading-held/`, with short clips so a chapter passes in about 30 s.

  ```sh
  OPENREADER_FAKE_TTS_SECONDS=0.2 OPENREADER_FAKE_TTS_LOG=/tmp/NAME/fake-tts.log \
    node test/manual-test/player-and-reading-held/fake-kokoro.cjs 8812
  node test/manual-test/kit/hx.cjs UDID '{"do":"settings","patch":{"provider":"local","enabledProviders":["local"],"local":{"engine":"kokoro","baseURL":"http://127.0.0.1:8812"},"voice":"af_bella","rate":1}}'
  node test/manual-test/kit/hx.cjs UDID '{"do":"open","id":"DOCUMENT_ID"}'
  node test/manual-test/kit/hx.cjs UDID '{"do":"ask","provider":"local"}'
  node test/manual-test/kit/hx.cjs UDID '{"do":"voice","provider":"local","voice":"af_bella"}'
  ```

## The crossing

```sh
bash test/manual-test/place-and-following/background-crossing.sh UDID METRO_PORT DOCUMENT_ID
FRONT=1 bash test/manual-test/place-and-following/background-crossing.sh UDID METRO_PORT DOCUMENT_ID
```

It moves the place to the last sentence the Reader holds, reopens the book so
that the page holds that section S and S + 1, and starts 64 sentences before
S + 1 (`OFFSET`). That is far enough that epub.js has unloaded S + 1's view
("out of reach") when the voice arrives, so the voice's own `follow()` has to
display it. It plays, sends the app home (Settings in front), waits `AWAY`
(45 s), and with `FRONT=1` comes back for 10 s, as the owner did in #112. Then it
pauses and reads the window's `[renderer]` and `[app]` lines out of the Debug
Log:

- **GREEN**: the voice entered S + 1 and S + 2 was rendered within `WAIT` (15 s)
  with the app in the same state, away.
- **RED**: S + 2 never rendered, or only after the app came back.
- **VOID**: the setup did not hold (the place, the volume, or no crossing).

The script moves on through the book: each run starts where the last one left
off.

## #112's race, on demand

```sh
node test/manual-test/kit/hx.cjs UDID '{}' --code-file test/manual-test/place-and-following/queue-race-arm.js
sleep 4
node test/manual-test/kit/hx.cjs UDID '{}' --code-file test/manual-test/place-and-following/queue-race-read.js
```

The first probe has the manager's queue start displaying the section after the
last view, as `renderAhead` does. It then asks the rendition to display the
section after that, whose view is not on the page, so `manager.display()`
clears every view while the first display is under way. The second probe reads
the answer as a `[probe]` line: `pending`, with the manager queue `running` and
a task waiting, is the wedge; `rejected: removed before its display finished`,
with both queues idle, is the fix.

## Measured (2026-10-01, iPhone 17 simulator, iOS 27.0; notes, 02:50 to 03:25)

- **Before the fix**, 4 of 4 crossings were RED: section S + 2 waited behind
  `requestAnimationFrame` until the app came back. With `FRONT=1` and S + 1
  unloaded, one run wedged both queues for good, field for field the phone's
  state. The race probe read `pending`, and the manager queue `running` with 1
  waiting.
- **After the fix**, 5 of 5 were GREEN, with S + 2 rendered 0.1 to 0.2 s after
  the crossing, away from the screen. The race probe read `rejected: removed
  before its display finished`, with both queues idle.

## What it cannot prove

The simulator lets a backgrounded page run. A real iPhone suspends the page's
process and wakes it for a median of 7 ms at a time (notes, 02:20). Whether S + 2
renders while the phone is locked therefore needs the owner's phone, locked,
across a chapter. The race probe forces one order of the two queues; the
background run met the other order in each fixed run.
