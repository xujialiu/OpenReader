# src

One native module, one WebView bridge, and shared TypeScript for everything
else. ADR 0001 says that is the realistic shape of the project, and this is
that shape laid out.

The split that matters is `core/` against everything else.

| Directory | What lives there | Decided by |
| --- | --- | --- |
| [`core/`](core/) | The half that runs under Node. No React, no React Native, no Expo — enforced. | ADR 0013 |
| [`core/providers/`](core/providers/) | The provider layer, copied from Zotero-OpenReader. Text in, PCM out. | ADR 0013 |
| [`core/segmenter/`](core/segmenter/) | Text into utterances, over upstream `sentencex`. | ADR 0006 |
| [`core/sync/`](core/sync/) | The owner's WebDAV folder, shared with the desktop plugin. | ADR 0003 |
| [`core/document/`](core/document/) | Document identity and reading positions. | ADR 0004, 0007, 0008 |
| [`playback/`](playback/) | The audio graph: read-ahead, time-stretch, the clock the highlight follows. | ADR 0012, 0009 |
| [`renderer/`](renderer/) | The bridge to epub.js in a WebView, and the highlighter inside it. | ADR 0011, 0005 |
| [`now-playing/`](now-playing/) | Lock screen and headphone controls: our module on iOS, the library's on Android. | ADR 0016 |
| [`keys/`](keys/) | Provider API keys in the Keychain. | ADR 0002 |

Dependencies point inwards: `playback/`, `renderer/`, `now-playing/` and
`keys/` may import from `core/`, and `core/` may import from none of them.
`eslint.config.js` enforces that and
`test/core/providers/import-boundary.test.ts` enforces the enforcement.

## Nothing here is written yet

Most directories below still hold a README and no code. The READMEs say what
belongs where and which decision put it there, so that the first file in each
one arrives in the right place. A stub that pretends to work would be worse than
an empty directory, because it would have to be believed and then found out —
which is why an empty directory here means exactly that and not "started".

Code has arrived in two of them. `core/` holds the platform-free files ported
from Zotero-OpenReader — `align.ts` above all, which ADR 0005 names the
first thing to carry over. `keys/` holds the Keychain, which is small and whose
correctness is entirely in one line of options (ADR 0002).
