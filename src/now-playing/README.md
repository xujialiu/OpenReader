# src/now-playing — ADR 0016

The JavaScript side of lock screen, Control Centre and headphone controls.

Its whole job is to route: **on iOS to our own native module**
([`modules/open-reader-now-playing/`](../../modules/open-reader-now-playing/)), and
**on Android to `react-native-audio-api`'s own implementation**, which ADR 0016
calls "the better-built half".

The iOS half is written. **The Android half is not, and this directory throws
rather than doing nothing there** — `lockScreen()` refuses on any platform that
is not iOS, in the house style of `plugins/with-ui-scene-lifecycle.ts`. The
machine this was built on has no Android device and no emulator, so a path
written here would be a path that has never run; and the symptom of a silent
no-op is a lock screen with no controls on it, which no log line reports and
which looks exactly like a lock screen that is merely broken. The refusal names
what is missing and says to delete it once it exists.

## One owner, and it is ours (on iOS)

The playback library's `PlaybackNotificationManager` is **never called on iOS**.
Not wrapped, not conditionally used — not called.

Calling both is what would break. `addTarget:` is additive, so every button press
would be handled twice, and both writers would fight over the Now Playing info
dictionary with the library re-pinning "paused" each time. The library touches
`MediaPlayer` from exactly one file, instantiated lazily on the first `show()`
call, so **if `show()` is never called the library never claims the command
centre and never writes Now Playing info**. There is no contest over either
singleton, which is what makes this safe rather than invasive.

## Why a module of our own at all

Three defects in the library's iOS layer, read line by line:

- **`MPNowPlayingInfoCenter.playbackState` is pinned to `.paused`.** The public
  API accepts `state: 'playing' | 'paused'`, the library's docs and example app
  pass it, and on iOS it is silently discarded — the value is read from a
  dictionary key nothing ever writes. Android honours the same field correctly.
  Present on the development branch too, and no issue reports it.
- **`togglePlayPauseCommand` is never registered.** That is the command AirPods
  single-tap and most car head units send.
- **`MPNowPlayingInfoPropertyDefaultPlaybackRate` is never written**, which is
  precisely the key a reader running at 1.5–3× needs for iOS to render the rate
  correctly.

The shipped iOS notification code has had no functional change in about five
months, the maintainers list the feature as delivered, and no lock-screen work
appears on any public roadmap. Waiting is not a plan.

## What is in here

`reading.ts` is the part that runs under Node, and it holds the two decisions:
**what the lock screen's second line says**, and **what a remote button is asking
for**. `index.ts` is the platform half — the routing, the module-level state and
the two effects — and it is not tested here, for the reason `test/README.md`
gives. `test/now-playing/module.test.ts` reads the lines of the Swift that obey
each of ADR 0016's rules, the same tool `test/playback/footguns.test.ts` uses on
the playback library, and for the same reason: every one of them fails as nothing
at all.

**The chapter is refused when it cannot be said honestly.** `chapterOf` takes the
answer `currentRow` already gives the contents sheet and holds it to a higher
bar, because the two are read differently: a marked row in a list the owner has
just opened is read as "about here", while a line on a lock screen is read as a
statement. So a `'before'` precision — no navigation entry names the section
being read, and the nearest one *before* it is reported — produces nothing. That
is ordinary rather than a malformed book: the owner's novel has 2,077 spine items
and 2,076 entries, and reading the one with no entry reports the **cover**.
Marking the cover in an open list is coarse; printing "封面" on a lock screen
while chapter 41 is being read is wrong.

**A toggle is resolved here and nowhere else.** `togglePlayPause` carries no
direction, so `intentOf` resolves it against whether the reading is running —
the one place the lock screen and the screen could disagree about what a press
means, which is why it is a function with a test rather than a conditional inside
a subscription. An explicit `play` or `pause` is honoured as sent, even when this
side believes the opposite: that is what lets a disagreement correct itself
instead of becoming permanent.

**A remote press goes through the screen's own handler.** Not the engine's. The
player's pause re-opens the player, so the coupling moved out of `player.tsx`
and into `reading-view.tsx`, where `collapsed` lives — there is one pause, and
the lock screen and the button both call it.

## What this layer is responsible for

**Pushing elapsed time.** The lock screen's elapsed time is never derived from
the graph — it is pushed by the caller on every change, and the reference cadence
in the library's own example is once a second. The value pushed is the source
node's content position (ADR 0012), the same clock the highlight follows, so the
lock screen and the highlight cannot disagree.

**Disabling the commands this app does not want.** iOS's library defaults enable
next/previous, which would render dead buttons on a book reader's lock screen; our
module sets `isEnabled = false` on those. Android's `MediaSession` does the
opposite and enables **none** by default, so each one must be turned on
explicitly. Both asymmetries live here.

## Not in core

This imports the platform, so it sits outside `src/core/` and `eslint.config.js`
forbids `core/` from importing it.
