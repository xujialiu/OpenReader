# src

One native module, one WebView bridge, and shared TypeScript for everything
else. ADR 0001 says that is the realistic shape of the project, and this is
that shape laid out.

The split that matters is `core/` against everything else.

| Directory | What lives there | Decided by |
| --- | --- | --- |
| [`core/`](core/) | The half that runs under Node. No React, no React Native, no Expo — enforced. | ADR 0013 |
| [`core/providers/`](core/providers/) | The provider layer, copied from the Zotero-TTS plugin. Text in, PCM out. | ADR 0013 |
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

Every directory below holds a README and no code. Step 1 of this project is
the scaffold; the READMEs say what belongs where and which decision put it
there, so that the first file in each one arrives in the right place. A stub
that pretends to work would be worse than an empty directory, because it would
have to be believed and then found out.
