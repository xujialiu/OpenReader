# Reading the final line above the Player (#371)

Open a fixture whose final paragraph has the ID `ending`. Expand the Player,
drag to the bottom and run the probe. Read its latest `[probe]` result in the
Debug Log and capture the screen.

```sh
node test/manual-test/kit/hx.cjs SIMULATOR_UDID '{}' --code-file test/manual-test/player-and-reading-held/end-spacer-geometry-probe.js
```

Check that `remaining` is within one CSS pixel of zero and that the screenshot
shows the whole last line, including punctuation, above the card. Then play
from a few sentences before the end. Repeat the probe and screenshot with the
completion note visible. The range coordinates are relative to the WebView
viewport. Use the card's visible upper edge when checking clearance.

On the iPhone 17 Pro with build 1.0.5 (36)-beta8-debug, the completion note
increased the scroll extent by 32 CSS pixels. The page moved from 1857 to
1889, leaving the final line visible above the note.
