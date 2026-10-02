---
status: accepted
---

# The reader's page is opened again when its web content process ends

For #120. The owner came back to a book left paused in the background and found
the reader blank: the navigation bar and the player were there, the text was
not, and nothing brought it back while the Reader stayed open.

## What happened on the phone

On 2026-10-01 (iPhone 16 Pro, `1.0.0-beta9`), the system log has the kernel
ending the reader's web content process while OpenReader was suspended, 13
minutes after the pause:

```
20:18:55.903 kernel memorystatus: killing_idle_process pid 6925 [com.apple.WebKit.WebContent] (long-idle-exit 0 691s …) 36897KB
20:18:55.903 launchd … [6925] exited with exit reason (namespace: 1 code: 0x11) - JETSAM_REASON_MEMORY_LONGIDLE_EXIT
21:29:07.854 OpenReader[6824] WebPageProxy::processDidTerminate: (pid 6925), reason=Crash
```

The app's own process lived on. WebKit learned of the loss only when the app
resumed, 70 minutes later, and reported it as a crash. A WKWebView whose process
has ended shows nothing until it is loaded again, and nothing loaded it:
react-native-webview 13.16.1's `webViewWebContentProcessDidTerminate:` logs
`Webview Process Terminated` (`RCTLogWarn`, not shown in a Release build) and
calls `onContentProcessDidTerminate` if it was given one, and
`@epubjs-react-native/core` passes its `WebView` a fixed list of props that
does not include it.

A `kill -9` of the simulator's WebContent process (the `WebContentExtension`
child of the device's `launchd_sim`) produces the same report and the same blank
page (`test/manual-test/library-and-reader/webcontent-killed.sh`).

## Decision

1. `patches/` adds `onContentProcessDidTerminate` to the library's `View`, passed
   straight to its `WebView`, and to `ReaderProps`. `Reader` spreads its other
   props into `View`, so the app sets it on `<Reader>`.
2. The reading view gives `<Reader>` a key of its own, a page generation, and
   the callback bumps it. **Only the page is mounted again, not the
   `ReadingView`.** The `ReadingView` holds the Reading: the engine, the
   Utterances, the cursor. Remounting it is what leaving the book does, and it
   would end a Reading that plays in the background. The page is what was lost,
   so the page is what is replaced.
3. The new page opens at the first Block of the sentence the bridge last cued
   (`bridge.restart()`), else where the old page was (the library's
   `currentLocation`), else where the book opened. A book opened and not yet
   read reopens where it was being looked at.
4. The bridge keeps its Blocks. The new page reports the same sections with the
   same ids and text, which `withSection` reads as no change, so nothing is
   segmented again and no Utterance is renumbered. What the new page lacks is
   the Blocks themselves: until it reports a section, a cue for a sentence in it
   would be reported as `Block … has not been reported: no rendered section
   holds it`. So after `restart()` the bridge keeps the cue, the last correction
   and a pause's hold instead of sending them, and sends them once, the cue with
   `reveal`, when the new page has reported the sentence's section. If the
   Reading moved into another section meanwhile, that section is displayed
   first.
5. Everything else the page is told after it installs was already sent again on
   its document message (inset, bar, line position, Appearance, theme, lookup,
   follow-only). The decided body text size joins them as `measured`, so the new
   program does not count characters again for a size already decided
   (ADR 0030).
6. At most three restarts within 60 s. A fourth leaves the page as it is, and
   the Debug Log says so, rather than reading the book in and laying it out
   again in a loop for a page that ends its process every time it opens.

Each restart writes `[renderer] the page's web content process ended; the page
opens again at <CFI>` to the Debug Log.

## Measured on the simulator

2026-10-01, iPhone 17 (iOS 27.0), "My Vampire System 251-500", Metro bundle
`1.0.0-beta10`:

- Before the change, `webcontent-killed.sh` failed 3 times of 3 (twice with the
  app in front, once with it in Settings during the kill): the page answered no
  probe and the screenshot was blank under the bar and the player.
- After it, the script passed 6 times of 6 (four in front, two `--away`):
  a new page (`born` after the kill) with epub.js on it, displayed views, and
  the paused sentence highlighted as before the kill. One run had no sentence
  cued; it reopened at the title page, where the old page was.
- Playing through the fake Kokoro server (volume zero): the kill at 23:00:48
  came during Utterance 302. The Reading went on to 306 without a note, the
  server kept answering a request every 2.5 s, and the new page, created
  1.6 s after the kill, showed Utterance 305's sentence and word highlighted.
- Four kills within a minute: three restarts, then `the page's web content
  process ended, 4 times in a minute: the page is not opened again`.

## Not covered

The Indexer (`src/offline/indexer.tsx`) has a `<Reader>` of its own for
preparing downloads, and its page can end the same way. It is not handled here.
A preparation asked of such a page would meet the Indexer's own 60 s timeout
(`Chapter preparation timed out. Continue to try again.`); that path has not
been measured.
