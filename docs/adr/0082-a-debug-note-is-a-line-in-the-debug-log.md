---
status: accepted
---

# A Debug Note is a line in the Debug Log, and a new version starts the log afresh

_The product argument is
[design 0082](../design/0082-a-fault-can-be-noted-the-moment-it-is-seen.md).
Issue #305; the owner's decisions are its plan comment (Q1–Q18). The terms are
CONTEXT.md's **Debug Mode**, **Debug Log** and **Debug Note**. It supersedes
three parts of [ADR 0054](0054-debug-mode-is-fixed-when-the-app-is-built.md):
#82's decision 8 ("No in-app control to mark a fault"), the 20 MB bound, and
"Off, nothing"._

## The row and the alert

- **Granted, not discovered.** `ReaderActions` (`src/app/reader-actions.tsx`)
  takes `debugNote`, as it takes `appearance`, and only `reader-screen.tsx`
  passes it, as `debugNote={DEBUG_MODE}`. The Library's drawer is the same
  component and never grants it. The row is the menu's last: `icon="bug"`, a
  beetle drawn in `icon.tsx`'s own 24-unit stroke, and the label `Debug`.
- **The time is the tap's.** The row's `onPress` sets `noting` to
  `localStamp(Date.now())`, the Debug Log's own line format
  (`2026-10-20 14:03:12.345 +08:00`), so the copied text finds its line by a
  plain search. Typing may take half a minute; the tap is nearer the fault.
- **The phone's alert.** `DebugNoteAlert` (`src/app/debug-note-alert.tsx`) is
  `@expo/ui` 57.0.19's SwiftUI `Alert`, mounted inside the drawer while it is
  up, as `RenameAlert` is (#117): title `Debug Note`, `Alert.Message` the time,
  one `TextField` with the placeholder `What went wrong`, then `Cancel`
  (`role="cancel"`) and `Save and Copy`. Every button of a SwiftUI alert
  dismisses it, so the copy is part of Save rather than a third button. Save
  is never disabled, a blank comment included, and passes `text.get()`, the
  native field, for #123's reason.
- **Save and Copy** calls `writeDebugNote`, then expo-clipboard 57.0.2's
  `setStringAsync(debugNoteCopy(time, comment))`, then `onClose`. Its iOS
  implementation sets `UIPasteboard.general.string` and answers `true`
  (`ClipboardModule.swift`). A rejection leaves the note written and the drawer
  open, and says `The Debug Note is saved, but it could not be copied: …` in the
  menu's `DrawerFooter`, where a failed Share is said. `Cancel` unmounts the
  alert and writes nothing.

## The lines

`src/debug/debug-note.ts` is platform-free, like every file in `src/debug/`
but `install.ts` and `launch.ts`.

- **`writeDebugNote`** writes one line in the new category `debug-note`:
  `[debug-note] <the Debug Note's time> "<cutText(title)>" (<shortId(id)>):
  <comment>`. The comment is trimmed and otherwise whole, up to `LINE_CHARS`
  (2,000), and `(no comment)` when blank. It passes `withoutCredentials` like
  every line. It is flushed at once rather than after `FLUSH_MS`. The line's own
  time is Save's, so the note carries two times and the search finds the tap's.
- **The reader answers.** `writeDebugNote` then calls every listener of
  `onDebugNote`. `reading-view.tsx` listens in Debug Mode only, and writes the
  status line at once with `hlog(statusLine(status, AppState.currentState))`,
  instead of up to 5 s later. It also calls `reading.bridge.snapshot(\`Debug
  Note ${time}\`)`, #113's page snapshot, whose reason the page cuts to 80
  characters. So a search for the copied time finds the note, and the snapshot
  as `[renderer] snapshot, Debug Note 2026-10-20 14:03:12.345 +08:00: …`. The
  status line follows the note within milliseconds. They are written at Save,
  not at the tap, because Cancel writes nothing.
- **What is copied** is `debugNoteCopy`: the time, a space and the trimmed
  comment, or the time alone.

## The bound: twenty files of 5 MB

`FILES` is 20 and `FILE_BYTES` still 5,242,880: 104,857,600 bytes. Nothing else
in the writer changed. The append is `File.write(text, { append: true })`, which
seeks to the end (ADR 0054), so a file's length costs nothing. Twenty files
instead of four larger ones keep each piece under 5 MB for `devicectl` and the
kit's scripts, and keep what a roll deletes to a twentieth. By ADR 0054's
estimate of 0.64 MB an hour, 100 MB holds about 150 hours of listening. That
was estimated from the lines' formats, not measured, and the `[renderer]` and
`[playback]` lines added since (#113, #152) make an hour heavier. The test
writes about 110 MB through a folder that keeps sizes only, and checks both
bounds after every batch.

## A new version starts the log afresh

- **`version.txt`** sits beside the log in `Library/Application
  Support/debug-log/` and holds the `APP_VERSION` that wrote it. It is not named
  `debug-log-….txt`, because the kit's scripts glob that as the log.
- **At launch**, `installDebugLog` runs `clearForVersion(files, mark,
  APP_VERSION)` (`src/debug/debug-log.ts`) before the writer exists. When the
  folder's version is the running one, nothing happens. Otherwise every
  `debug-log-NNNNNN.txt` is deleted, `version.txt` is rewritten, and the launch
  line ends `; cleared the Debug Log of 1.0.0 (9)-beta11: 7 files, 31.2 MB`, in
  MiB to one decimal. A log from before this change, which has no
  `version.txt`, is named `a build that did not record its version`. A failure
  here is said in the system log, and the writer goes on with what is there.
- **What counts as new** is `APP_VERSION`, the Version, Build Number and Beta
  (ADR 0070). Every app change moves the Beta (MEMORY/app-change.md), so every
  new build is one. Installing the same build again keeps the log. A Metro
  reload that brings a new Beta is a new JavaScript runtime with a new
  `APP_VERSION`, and clears it. Turned down: clearing on every installation of
  the same version. It would need a signal of a new installation, such as the
  bundle container's path, which has not been measured.
- **The pre-install copy.** `docs/install-on-iphone.md` copies the phone's Debug
  Log to `/tmp/or-debug-before-<old version>` with `debug-log.py` before
  `devicectl device install`, and the reply says how many Debug Notes it held
  (`debug-notes.py`). On this Mac (macOS 27.0.1) `/tmp` keeps files unread for
  weeks but nothing from before the last restart (notes 2026-10-20), so the copy
  lasts until the Mac restarts.

## A build without Debug Mode removes what one with it left

`installDebugLog` without Debug Mode now does one thing. It constructs the
folder's `Directory` and deletes it when `exists` is true (expo-file-system
57.0.7: `Directory.delete()` deletes what is inside too). It constructs no
`File`, writes no line, wraps no handler and holds no credential, and it says
nothing even when the delete throws: such a build has no Debug Log to say it in,
and the next launch tries again. It replaces 0054's "Off, nothing". Without it,
a TestFlight or App Store build installed over a Debug Mode build of the same
bundle identifier would keep up to 100 MB in Library that no one can see. The
Demo App has its own container and identity, so this removes nothing of the
author's. test/debug/install.test.ts checks both: without a folder, nothing is
touched; with one, only it is deleted.

## On the Mac

- `test/manual-test/kit/debug-notes.py LOG` prints `Debug Log written by
  <version.txt>` and then one line per Debug Note, under its own time: `<time>
  "<title>" (<id>): <comment>`. It is how an agent finds a note by what it says,
  and it skips the player's `[reading] note: …` lines.
- `debug-log-timeline.py LOG --around '<time>'` takes the window from
  `--before` minutes before (10) to `--after` minutes after (2). The value may
  be the whole copied line, comment and all: the leading `YYYY-MM-DD HH:MM[:SS[.mmm]]`
  is read and the offset ignored, as the timeline compares the lines' local
  time as text. A value that is not a time exits 2.
- test/scripts/debug_notes_test.py runs both against a Debug Log in a temporary
  folder, through test/scripts/debug-notes.test.ts.

## Tests

- test/debug/debug-log.test.ts: the bound, and `clearForVersion` for the same
  version, another version, no `version.txt`, and an empty folder.
- test/debug/install.test.ts: clearing at launch with the launch line's ending;
  the same version's log kept; a build without Debug Mode deleting a leftover
  folder and touching nothing else.
- test/debug/debug-note.test.ts: the line, the flush, a blank comment, the copied
  text, and the order of the note and the reader's answer.
- test/app/debug-note.test.ts: the alert, and the real `ReaderActions` with the
  phone's views as plain elements. It checks the row, the tap's time, Save and
  Copy, a failed copy and Cancel. It also pins the grant and the reader's
  answer, which only the phone runs.

## Not verified here

Written before the simulator run: that the alert presents over the drawer's
sheet with its message and field as `RenameAlert`'s does; that the clipboard
holds the copied text; that the snapshot reaches the log; that a new Beta
clears the simulator's log at its first launch.
