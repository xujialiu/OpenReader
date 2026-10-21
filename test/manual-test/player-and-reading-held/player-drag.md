# A drag on the open Player moves nothing (#312)

Whether a finger dragged up or down on the open Player moves any of it: the
controls, the notes, the panel. Until #312 the whole Player sat in one scroll
view that rubber-banded at every size, so a drag slid the controls up inside the
panel and they sprang back. Since #312 the Player never scrolls; it grows up to
the bottom of the navigation bar, and past that only the notes scroll.

`player-drag.py` holds the finger down on the device, screenshots it mid-drag
and compares each shot with one at rest: where Play's dark circle is, and how
many pixel rows of the panel differ. Its header gives every option, what it
measures and what it cannot prove. About 9 s a run, no audio.

## Set up

Any Debug app of this tree on an iPhone 17 (402 points wide, the column the
script reads Play on), with the reader open:

```sh
npx tsx test/manual-test/fixtures/short-test-fixture.ts /tmp/RUN/fixtures
# copy the .epub into the app's Documents/Inbox, then:
node test/manual-test/kit/hx.cjs SIMULATOR_UDID '{"do":"add","file":"A Short Test of Reading Aloud.epub"}'
node test/manual-test/kit/hx.cjs SIMULATOR_UDID '{"do":"open","id":"sha256:…"}'
```

A fresh install shows the note `No provider is enabled. …` in the Player.
Without a note, enable a Provider and give the Document a Voice:
`{"do":"settings","patch":{"enabledProviders":["local"]}}`, then
`{"do":"voice","provider":"local","voice":"af_heart"}`.

**A long note** (about 210 characters, three lines at the default size): stop
the app, set the entry's `voice.provider` in `Documents/library.json` to a name
the app does not have (`"bogus"`), and relaunch. The Player then says `This book
remembers being read by "bogus", …` (`unusableVoiceSentence`). The harness's
`voice` command will not store such a name. Put the Provider back the same way
afterwards.

## Run

```sh
python3 test/manual-test/player-and-reading-held/player-drag.py SIMULATOR_UDID /tmp/RUN/drag
python3 test/manual-test/player-and-reading-held/player-drag.py SIMULATOR_UDID /tmp/RUN/drag-note --from 200 716
```

The default start is the plain box of the head row. `--from 200 716` starts on
the long note at the default size. Start on a plain spot: a drag that starts
on a button counts its pressed fade as changed rows (the header says more).

**The largest text size**: `xcrun simctl ui SIMULATOR_UDID content_size
accessibility-extra-extra-extra-large` (`large` puts it back). With the long
note the Player reaches the navigation bar and the note is cut off there.
Compare only the controls, below the notes, with `--panel-top 440`:

```sh
python3 …/player-drag.py SIMULATOR_UDID /tmp/RUN/ax5-head --from 250 497 --panel-top 440
python3 …/player-drag.py SIMULATOR_UDID /tmp/RUN/ax5-transport --from 120 715 --panel-top 440
python3 …/player-drag.py SIMULATOR_UDID /tmp/RUN/ax5-note --from 200 250 --by -150 --panel-top 440
```

The last one scrolls the note, which is meant to happen at this size. GREEN
there says the controls below it stayed put.

## Expected

GREEN on every run above: Play moved 0.0 pt and 0 panel rows changed.
Measured 2026-10-21 on an iPhone 17 (iOS 26.5) running `1.0.0 (11)-beta2`. The
same commands against the `player.tsx` before #312 went RED: Play moved
-44.7 to -53.7 pt mid-drag and up to 444 panel rows changed, with or without a
note. Play was back at rest once the finger lifted.

A drag that starts on the page above the Player still moves the page and turns
A to M: `--from 200 450 --by -150 --panel-top 130` reports RED, all of it page
rows plus the A-to-M mark, with Play at +0.0 pt.

Verified 2026-10-21 on `1.0.0 (12)-beta2-debug`, iPhone 17 (iOS 26.5), by
`ios-tester` against ca9628f. Default size, long note: GREEN, 0.0 pt and 0
panel rows in every mid-drag shot, from the head row (300,765), the transport
row's plain gap (73,818) and the note (200,716). Without the note: the same
from (300,765) and (73,818) with `--panel-top 740`, and the Player is the two
rows it was before #312. `accessibility-extra-extra-extra-large`, long note:
the Player's top meets the navigation bar (the notes' viewport 120–438 pt,
"2 pages"), every control readable and at the same frames as without the note;
GREEN from (250,497) and (156,715) with `--panel-top 440`; the note drag
(`--from 200 250 --by -150`) scrolled 914 pixel rows, every one of them in
120–438 pt, 0 below 440 — only the note moved. Without the note at that size
the Player is 441 pt tall (top ≈433 pt against 736 at the default size),
nothing cut off, no scroll, GREEN from the same starts with `--panel-top 425`.
At both sizes: collapse arrow → Reading Button → Player back; Contents opens
and closes; the speed bubble opens above its button fully on screen and a tap
outside over the Contents button closed it without opening Contents; the page
drag above the Player reported RED (page rows only, Play +0.0) and turned A to
M; M brought the page back to A; a tap on a sentence above the Player seeked
the reading (`utterance` null→2) with `playing=false`. No audio played.

The transport row's plain spots are gaps between its buttons, and they move
with the layout: at the default size with the note, `--from 300 818` lands
inside Next paragraph (282–326 × 796–844) — the run still read GREEN 0 rows
here because the finger's pressed fade fell between the shots, but a plain
gap (73,818, between Contents and Previous paragraph; 156,715 at the largest
size, between Previous sentence and Play) is the start the measurement should
come from. Read the frames from `ax.py tree` before choosing one.
