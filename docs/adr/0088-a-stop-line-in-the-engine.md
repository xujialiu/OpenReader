---
status: accepted
---

# The Sleep Timer is a stop line in the engine, stated again by the Reading

_The product argument is
[design 0088](../design/0088-the-reading-can-pause-by-itself.md). Issue #326._

## What was done

### The engine: `stopAfter(utterance | null)`

`src/playback/engine.ts` holds a **stop line**, an Utterance index or null.

- **Nothing past it is fetched or queued.** `queueLimit()` is
  `min(availableThrough(), line + 1)`, used by `fetchWindow` and by `drain`'s
  loop in place of `availableThrough()`. The out-of-text test still uses
  `availableThrough()`, so the line never looks like the end of the text.
- **What is already queued past it is taken off** (`cutAtLine`). The
  read-ahead keeps up to three sentences queued after the one being spoken
  (`READ_AHEAD_UTTERANCES`), so a line set mid-sentence would otherwise let
  them play. The splice is the voice switch's: `timeline.truncateAfter` the
  last buffer at or before the line, `graph.remove` (the patched
  `dequeueBuffer`) for the rest, their `DecodedClip.clip` back into `prepared`
  so the next Play does not ask the Provider again, `nextToEnqueue = line + 1`.
  Not while a voice switch has its replacement queued (`pending.armed`): its
  tail and the `removed` list it would restore on cancel are not this splice's
  to tear, so the line is reached once what is queued has played.
- **Reaching it** (`reachLine`, in `pump` before `outOfText`): playing, not
  `waiting`, `nextToEnqueue > line` and `timeline.pending() === 0`, that is,
  every buffer up to and including the line's has ended, its pause after it
  included. The engine pauses as an output loss does (`pauseNow`), clears the
  line and calls `deps.onStopLine(line)`. The queue is empty and
  `nextToEnqueue` is past the line, so the next `play()` resumes an empty
  graph, `drain` queues `line + 1` from `prepared`, `enqueue` cues it, and
  nothing is repeated.
- **A line behind the sentence being spoken is that sentence**
  (`max(utterance, cursor)`). A line equal to the one held is ignored.
- **It is cleared by `restart`** (every `seek`, `load` and `silence`), because
  a `load` may renumber the list and a seek points somewhere new.
- **`play()` drops a line already passed**: paused with an empty queue and
  `nextToEnqueue > line`, the line's sentence was finished before the pause,
  and the press means the next sentence. Without this, choosing the chapter
  again while paused at a chapter's end would stop again at once.

### The Reading: `stopAt(request)`

`useReading` keeps a `StopRequest`, `{ kind: 'sentence' }`,
`{ kind: 'chapter', rows }` or null, and `restateStop()` turns it into a line
from `atRef` and calls `engine.stopAfter`:

- at every cue (`clock.onClip`), where a seek's sentence becomes the one being
  spoken and the chapter's end moves on;
- after `adopt`'s `extend` (more text may reach the chapter's end) and its
  renumbering `load`;
- after `seekTo`, and after `build`'s first `load`.

For a sentence, the line is `atRef`. For a chapter, `chapterEnd` in
`src/app/sleep-timer.ts` walks from `atRef` through `readingExtent(...).end`
and returns the last Utterance before the Contents row changes, by
`rowOfPlace`, the rule `currentRow` and the download drawer already share,
with each Block moved to `anchoredStart` and the answer cached per
`(section, start)`; null while the contiguous text does not reach the row's
end, unless that text reaches the Document's end (`next === null`). The engine
then holds no line until more text arrives, and the next section is laid out
well before its first sentence is needed (ADR 0023), so the line is in place
before the boundary. If it is not, the engine is already waiting at the
section boundary, and the line, once stated, is reached there at once.

`onStopLine` clears the request and calls `useReading`'s new `onSlept`
argument. The pause itself reaches `onState`, and through it the stop effect
that writes the Reading Position and starts a sync, as every stop does.

### The timer: `useSleepTimer`

`src/app/use-sleep-timer.ts`, held by `ReadingView`, which lives as long as the
Reading does (ADR 0049): `{ choice, left, since, expired }`. A length counts
only while `status.playing` (`playingChanged()`, run from an effect on `playing`);
a `setTimeout` for what is left sets `expired`, which turns the request into
`{ kind: 'sentence' }`; a stop while expired, the line's or the owner's, turns
it off. The request is one `useMemo` of the state, handed to `stopAt` by one
effect. `ReadingView` turns it off and opens the Player on `onSlept`.

The Player's button (`src/app/sleep-timer-button.tsx`) ticks its own countdown
once a second from `left` and `since`, so the reader is not rendered again
every second. Its menu is `@expo/ui`'s SwiftUI `Menu`, as `ChoiceMenu`'s
(ADR 0035): a `Button` for `Turn Off Timer` and a `Divider` while set, then one
`Toggle` per choice, `menuOrder('fixed')`, `accessibilityElement('ignore')`
with the label and the `isButton` trait put back.

The menu label's React Native face takes the same explicit `width` and `height`
as its outer `Host` (#331), not `flex: 1`. This gives it the final centring box
before `RNHostView` reports its size. The native menu, `RNHostView`'s default
sizing mode and `ignoreSafeArea="container"` stay unchanged; no delay, visibility
gate or positional compensation is needed.

## Facts it rests on

- **The menu label's first height is zero even with a sized outer Host (#331).**
  On an iPhone 17 simulator, the outer Host reported 48×44 while `RNHostView`
  and its flex-filled face reported 48×0; 30 ms later both reported 48×44.
  The vertically centred moon moved down 22 points. Three collapse/reopen
  cycles reproduced it; giving only the face the supplied dimensions removed
  the movement in all three, without hiding the moon. Restoring flex-fill
  sizing restored the jump. The mocked component tests cannot measure this
  native size handoff; `test/manual-test/player-and-reading-held/player-opening.cjs`
  records and checks the actual native pixels. An explicitly sized face with
  `matchContents` also passed, but changing the sizing mode was unnecessary.
- **A JavaScript timer fires while the phone is locked here.** The Reading's
  audio keeps the app running in the background, and React Native's timer
  module, on `UIApplicationDidEnterBackgroundNotification`, stops its display
  link and schedules an `NSTimer` for the next JavaScript timer instead
  (`appDidMoveToBackground` → `didUpdateFrame` → `scheduleSleepTimer`,
  `node_modules/react-native/React/CoreModules/RCTTiming.mm`).
- **A buffer's end reaches JavaScript after the audio thread has moved on.**
  The node plays its queue without a gap and reports each end through the
  bridge, so pausing on that report would start the next sentence. That is
  why the line is enforced on the queue and not on the end event.
- **Between spine items the engine waits for the queue to drain and then
  100 ms** (`sectionReady`, `chapterPause`), so at a chapter that is its own
  file nothing of the next chapter is ever queued when the line is its last
  sentence.

## Considered

- **Pausing on `onBufferEnded`** when the new front is past the line. Simpler,
  but see the second fact: the next sentence's start would be heard, longer
  while the phone is locked.
- **Keeping the line across a seek** in the engine. A `load` renumbers, so an
  index kept across it would name another sentence; stating it again from the
  request is the one rule that holds for both.
- **Counting the length in the engine**, against the audio clock. It would
  survive JavaScript being late, but the length is minutes, not a word's
  timing, and the owner's rule is about playing, which `status.playing` already
  says.
