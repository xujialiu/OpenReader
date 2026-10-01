# Debug a fault on the iPhone

Use this guide when the owner reports a fault seen on the phone, usually a
screenshot and a time. It gets from that report to the state the app was in,
in one pass. It was written from #112 (2026-10-01), where the pass took four
rounds; each step below is one of those rounds, done in order.

The phone is the owner's own. Everything here only reads it; on a build before
`1.0.0-beta3` a probe's answer in step 4 also replaces the note on the player. Anything that would
play, pause, navigate or change a setting on the phone needs the owner's
go-ahead first, and so does playing audio (MEMORY/device-testing.md).

Commands write the phone's UDID as `IPHONE_UDID`; `xcrun devicectl list
devices` gives the real one. All output goes under `/tmp`, never into the
repository.

## 0. A fault still on the screen is the best evidence

If the fault is still showing (a reading that waits for ever, a spinner, a
blank page), ask the owner to leave the app and the book open: no Close, no
swipe-away. The live state (epub.js's queues, the views on the page, what the
app holds in memory) exists only in that process. In #112 the reader was still
stuck when it was probed 14 minutes later, and what located the fault came from
that probe, not from the log. Say so in the first reply, before anything else.

## 1. The phone, and whether it can be reached

```sh
xcrun devicectl list devices              # the phone: available (paired), and its UDID
/tmp/pmd3-venv/bin/pymobiledevice3 usbmux list   # non-empty only with the cable in
```

`devicectl` reaches the phone over Wi-Fi as well as the cable, and that is all
the Debug Log and the harness need. The system log (step 3) needs the cable:
ask the owner to plug it in when step 3 matters. pymobiledevice3's venv is
installed as `test/manual-test/pitfalls/physical-iphone.md` says.

The build must have Debug Mode: Settings' version ends in `-debug`. A build
without it keeps no Debug Log and has no harness. Then the only way forward is
to install one (`install-on-iphone.md`) and have the owner meet the fault again.

## 2. The Debug Log, around the moment

```sh
python3 test/manual-test/kit/debug-log.py IPHONE_UDID /tmp/or-debug-NAME
python3 test/manual-test/kit/debug-log-timeline.py /tmp/or-debug-NAME/debug-log --from '2026-10-01 01:28' --to '2026-10-01 01:50'
```

`debug-log.py` copies the folder and prints the span it covers. The owner's time
and the log's stamps are both the phone's local time (`+08:00`). Start the
window well before the reported moment: the fault is usually where something
stopped changing, minutes earlier.

`debug-log-timeline.py` prints each line that changes something, with the app's
state beside it: `active`, `inactive`, `background`, or `launch`. The reading's
status line appears only when `playing`, `known`, `section`, `rendered` or
`note` changes. What the lines say:

| Line | Meaning |
| --- | --- |
| `[launch]` | the app started: after a crash, a kill from the app switcher, or iOS reclaiming it |
| `[app] app active/inactive/background` | the app's state; the lock screen and Control Center pass through `inactive` |
| `[document] opening … / opened …` | a Document opened in the Reader |
| `[reading] play at / pause at utterance N` | Play and Pause, from the player or the lock screen |
| `[reading] note: …` | the sentence the player showed, word for word |
| `[hx] playing=… app=… utterance=… known=… section=… rendered=I/S …` | the Reading's status, every 0.5 s when it changes and every 5 s when it does not, while a Document is open or its Reading is held. `app=` (from `1.0.0-beta3`) is the app's state then. `known` is the number of Utterances the app holds, `section` the spine index being read, `rendered` the last section the page reported out of `S` spine items. |
| `[renderer] …` | (from `1.0.0-beta3`, #113) epub.js on the reader's page, event by event: `renderAhead:` asking for the next section, and `done` or why nothing was asked; `view N appended / displayed in X ms / unloaded / removed before its display finished / has not finished displaying`; `display "…" asked by X ← Y`; `views cleared`; `stage resized`; `page hidden / visible`; `manager queue stalled` with what is in flight and waiting, then `moving again`; and `snapshot, the reading ran out of text` beside the out-of-text note |
| `[probe]` | a harness `js` probe's answer (step 4) |
| `[sync]`, `[download]`, `[provider]` | skipped by the timeline by default; `--skip ''` shows them |
| `[warn]`, `[error]` | `console.warn` and `console.error`, uncaught errors, unhandled rejections |

On a build with `[renderer]` lines, read those around the fault first: they
say what epub.js was doing and waiting on, which is what #112 needed four rounds
of probing to learn. Search `stalled`, `has not finished displaying` and
`snapshot`.

Compare the fault's window with an earlier stretch where the same thing worked.
In #112 the comparison was the finding. In the foreground, entering section N
had always found N+1 rendered (`section=N rendered=N+1`). This time the reading
entered section 33 while the app was in the background, `rendered` stayed at 33,
and the reading ran out of text 11 minutes later.

Done when you can name the first line where the state went wrong, and the app's
state at that line.

## 3. The system log, while it is still on the phone

```sh
python3 test/manual-test/kit/debug-log.py IPHONE_UDID /tmp/or-debug-NAME --syslog --pmd3 /tmp/pmd3-venv/bin/pymobiledevice3
```

This needs the cable. It collects from the Debug Log's first line to now, and
the phone keeps WebKit's lines for only about half a day, so run it in the first
session after the report. `OUT/system-openreader.txt` is OpenReader's own
process. What has mattered:

- `com.apple.WebKit:ProcessSuspension`: the reader's web content process being
  suspended and resumed. In #112, about 700 cycles in the 17 minutes the
  Reading played in the background.
- `WebPage::runJavaScriptInFrameInScriptWorld`: each message the app sent to the
  page.
- A crash or a jetsam kill: the Debug Log shows it only as the next `[launch]`.

## 4. Ask the running app

The walkthrough harness runs a command in the app on the phone. `phone-hx.cjs`
sends one command and prints the Debug Log lines that answered it:

```sh
node test/manual-test/kit/phone-hx.cjs IPHONE_UDID '{"do":"navstate"}'   # which screens are open
node test/manual-test/kit/phone-hx.cjs IPHONE_UDID '{"do":"say"}'        # the Reader's full status, notes, voice
node test/manual-test/kit/phone-hx.cjs IPHONE_UDID '{}' --code-file test/manual-test/kit/probes/renderer-state.js
```

`probes/renderer-state.js` reads epub.js inside the reader's page: views,
both queues, scroll against height, and which spine items are loaded. Write a
new probe beside it when a fault needs another question: a file that defines
`function probe()` returning a string (`--code-file` appends the call). Keep
its answer under about 1,900 characters, because the Debug Log cuts a line at
2,000.

- **It needs the JavaScript running**: in the foreground, and in the
  background while a Reading plays (the status line keeps coming then). `js`
  and `say` need the Reader open. No answer means one of those. The script then
  says so and leaves the command in `harness.json`. Whether the reader's page
  answers a `js` probe with the app in the background has not been measured:
  every #112 probe ran with the app in the foreground.
- **The answer is a `[probe]` line** from `1.0.0-beta3` on (#113). It changes
  nothing on the owner's screen, and every answer is kept. On an older build the
  answer replaces the note on the player until the next note, so tell the owner
  what the new note is. Two answers within milliseconds of each other there
  leave only the second in the Debug Log, so send one answer per probe.
- **Read only.** A probe that changes the renderer, the reading or a setting is
  an intervention on the owner's phone: ask first.
- **The owner may be using the phone at the same time.** Their Play, Pause and
  app switches appear in the same lines as the probe's answer. Read them as the
  owner's, not the probe's.

The script puts `{"do":"noop"}` back in `harness.json` after an answer, because
the harness runs whatever the file holds once at every launch.

Done when the answer names the state that stops the app. In #112 that state
was epub.js's manager queue with `running: true` and 43 tasks waiting, the
rendition queue likewise with 49, and spine item 34 loaded with no view left to
show it.

## 5. From the phone to a loop

The phone says what the state was, not how it got there. Take the state to the
simulator and build a loop that goes red on it (the diagnosing-bugs skill,
`test/manual-test/README.md` for the area's recipes). Record the evidence as the
issue's evidence, with the times, commands and answers, so the next reader does
not need the phone.

A Debug Mode build marks the reading page inspectable for Safari's Web
Inspector (ADR 0054, decision 6). Attaching to it on the phone has not been
tried yet: when it is, record the steps here.

## Pitfalls

`test/manual-test/pitfalls/physical-iphone.md`, "Physical iPhone logs": read it
before the first command, and add what misleads you there.
