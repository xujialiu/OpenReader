---
status: accepted
---

# A Contents row browses while playing too

_The product argument is
[design 0063](../design/0063-a-chapter-chosen-while-listening-only-takes-the-page-there.md).
Issue #107. It replaces ADR 0044's "While playing … the row is still ADR 0020's
two steps", and its reason "Not playing. … A browse while playing would be
undone at the next sentence boundary"; the rest of ADR 0044 stands._

## What was done

`use-reading.ts`'s `goToSection` browses on two conditions instead of three:

```ts
if (atRef.current !== null && !unreadRef.current) {
  const waited = pendingSectionRef.current;
  pendingSectionRef.current = null;
  if (waited?.onward) engineRef.current?.seek(atRef.current);
  revealCue.current = false;
  bridgeRef.current?.browse(section);
  return;
}
```

`!playIntent.current` is gone. ADR 0044 needed it because every cue revealed its
sentence while playing, so a browse lasted until the next Clip. Since #71 (ADR
0050) only Play's first cue reveals. Each later cue is sent as
`{ reveal: false, recover: true }`, and the highlighter gives a browsing page back
only when `begins && browsing && onVisiblePage(shown)`. A finger drag while
playing already relies on this. A `BrowseMessage` sets the same page-level
`browsing` flag, so a row gets the finger drag's rules, and the player's **M**,
with no change on the WebView side.

A browse issues no engine call: no `seek`, no `silence`, no `pause`. The voice
goes on with the Clip it is playing, `status.utterance` and `status.section`
stay the reading's, and the Contents mark with them.

### `revealCue` is cleared by a browse

Play sets `revealCue`, and the clock reveals the first cue after it
(`asked = playIntent.current && revealCue.current`). A row pressed after Play and
before that cue arrives would have been browsed and then undone by the first
Clip a moment later, which with a remote Provider is the fetch time of one Clip.
The browse branch therefore sets `revealCue.current = false`, and that first cue
recovers like any later one. While paused `revealCue` is already false (`pause()`
clears it), so the line changes nothing there.

### What still seeks while playing

`atRef.current === null` while playing: Play before its first cue in a book
with no place, or Play walking forward past a cover (`seekingRef`). There is no
sentence to keep, so the row is still `followRow(section, true)` (#86): the engine
is silenced while the section is waited for, and a row with no text reads on
past it. `unreadRef` is always false while playing, since `play()` clears it
before `playIntent.current = true`.

The `waited?.onward` line in the browse branch stays for the same case: a row
pressed then, followed by a second row once a sentence exists, ends the first
row's silenced wait at the sentence the reading is on.

## Tests

`test/app/use-reading-resume.test.ts`, in the block now named "a Contents row
only moves the page, paused (#52) or playing (#107)". It replaces
`still takes the reading to the chapter while playing`:

- A row while playing calls `browse(3)` and not `goToSection`, calls nothing on
  the engine, leaves `playing`, `utterance` and `section` as they were, and the
  section reporting moves nothing. The next cue goes out as
  `{ reveal: false, recover: true }` and moves `utterance` on.
- A row after Play and before its first cue: that cue recovers. Play after a
  pause still reveals.
- Playing with no sentence yet, a row still takes the reading to the chapter's
  heading.

`test/app/player-rules.test.ts`'s #86 pins (`followRow(section,
playIntent.current)`, `if (waited?.onward) …`) still hold, and pass.

## Measured after the change

_To be filled in from the simulator run (notes, 2026-09-30)._

## Considered

- **Pausing at the press.** Rejected by the owner (design 0063).
- **A Contents browse that returns only when asked**, with no return at a
  visible sentence. It would need a second kind of `browsing` in the highlighter,
  told apart from a finger's, for a difference the owner turned down.
- **Leaving `revealCue` alone.** The first Clip after Play would take the page
  back from a row pressed while that Clip was being fetched.

## Limits

- While browsing far away, the voice can read into a section epub.js has not
  rendered or has trimmed. That highlight is not painted until the page comes
  back, as after a finger drag (ADR 0044's `awaited()` treats an off-page
  section as waited for, not failed).
- A row to the chapter being read shows its top. Whether the page follows again
  depends on where the next sentence begins, which the owner may not expect for
  a long chapter.
