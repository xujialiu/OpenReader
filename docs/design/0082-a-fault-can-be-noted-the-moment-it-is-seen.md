# A fault can be noted the moment it is seen

_The engineering half of this decision is
[ADR 0082](../adr/0082-a-debug-note-is-a-line-in-the-debug-log.md). Issue
[305](https://github.com/xujialiu/OpenReader/issues/305). The words are the
glossary's: **Debug Mode**, the **Debug Log** and the **Debug Note**. It changes
three things that [design 0054](0054-the-owners-phone-keeps-a-record-of-what-the-app-did.md)
decided: that there is no way to mark the moment of a fault, how much the record
keeps, and that a released copy of the app does nothing at all with the record._

## Why

The author meets most faults while reading on the phone, often with the Mac
nowhere near. What he could pass on afterwards was a rough time and his memory
of what he had seen. Hours later he had to work out which minute it was, and
describe the fault again from memory. If he met several in a day, nothing tied
each description to its moment. Design 0054 had chosen not to offer a way to
mark the moment, on the grounds that saying roughly when would be enough. In
use it was not.

## What the author sees

Only the copies of the app made with Debug Mode change. A released copy, and the
Demo App made for App Review, show nothing new.

- **A `Debug` row** at the end of the menu that `…` opens in the reader, with a
  small beetle beside it. The same menu in the Library does not have it.
- **The moment is the tap.** Tapping `Debug` fixes the time there and then, and
  the phone's own alert comes up. It is titled `Debug Note`, shows that time
  exactly as it will be copied, to the thousandth of a second with the phone's
  difference from world time, and has one line to write in, `What went wrong`.
  Writing takes a little while; the time is the tap's, which is nearer the fault.
- **`Save and Copy`** keeps the note and puts the time and what he wrote on the
  clipboard, ready to paste into his own notes. The line may be left empty: the
  moment alone is worth keeping when there is no time to type, and then the time
  alone is copied. The menu closes and he is back on the page.
- **`Cancel`** keeps nothing and goes back to the menu.
- **Nothing else changes.** Reading aloud goes on, and the place does not move,
  so what he was looking at is still there when the alert has gone.

If the copy fails, the note is kept all the same, the menu stays open, and the
reason is said under its rows.

When the player is folded away, the bar with `…` is hidden with it. One tap on
the round button brings both back; it shows the controls and does nothing to
the reading.

## What is kept

The note goes into the Debug Log, among everything else the app recorded,
under the time of the tap: what he wrote, in full, and the book's title, cut to
about a line as every title is. At the same moment the app adds where the
reading was and what the page was doing, so the state at the note is beside it
rather than up to five seconds away. A search for the copied time finds all of
it.

Back at the Mac, the author hands an agent the copied line, or only says what
he remembers writing. The agent copies the record off the phone, lists every
note in it, and reads the record around the one he means.

## How long it is kept

- **Up to 100 MB.** The record keeps its most recent 100 MB, where it kept
  20 MB before, so a note made days ago is usually still there with the record
  around it. That is about 150 hours of listening by design 0054's reckoning,
  which was worked out from the length of the lines and has not been measured on
  the phone; lines added since make an hour somewhat longer. Like the rest of the
  record, it stays on the phone, is not in its backup and is not in the Files
  app.
- **A new copy of the app starts a new record.** When a copy with a new version
  first starts, the record the previous one left is deleted, and the first line
  says how much went. A note about an old version is about code that has since
  changed. Starting the same copy again, or installing it again, keeps the
  record.
- **The Mac takes a copy first.** Because a new copy deletes the record, the
  record is copied to the Mac before a new copy is installed on the phone, and
  the reply says how many notes it held. That copy lasts until the Mac is next
  restarted.
- **A released copy removes a record left behind.** A copy from TestFlight or
  the App Store installed over one with Debug Mode deletes the record that copy
  kept, up to 100 MB nobody could see or read, and does nothing else with it.

## What was turned down

**A page of the menu with room for a paragraph.** It would let him write more,
but it is a step further from the page, and a fault is usually said in a line.
The owner asked for an alert.

**A separate record of the notes that survives when the main record is
trimmed.** The note would outlive the lines that explain it, which is the part
an agent needs. The owner chose instead to keep five times as much of the record
and start it afresh with each new copy.

**A way to change the 100 MB, in Settings or when a copy is made.** Design 0054
kept Debug Mode free of switches that must be remembered at the wrong moment, and
this follows it.

**Clearing the record at every installation, even of the same version.** It
would need a way to tell one installation from the next that has not been
tried. Every change to the app moves its version on, so a new version is what a
new copy is in practice.
