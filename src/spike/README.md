# src/spike

The day-one spike, and the only code in `src/` that does anything yet.

`hermes-support.ts` answers notes/NOTES.md items 1 and 2, and the two
unresolved paragraphs at the end of ADR 0001. It also probes three things that
cost one line each and are owed elsewhere: NFC and NFD (ADR 0008 text anchors
fail silently when normalisation disagrees), Unicode property escapes (ADR 0001
claims they are supported and `align.ts` requires them), and `Intl.Segmenter`
(which is why `unicode-segmenter` is a dependency at all).

## It has been run, and here is what it said

On **Hermes 250829098.0.17**, the engine React Native 0.86.3 bundles, in a debug
build on an iOS 27.0 simulator, 2026-09-19:

| Probe | Result |
| --- | --- |
| `String.prototype.normalize('NFKC')` (item 1) | **yes** |
| `TextDecoder` (item 2) | **yes** |
| `normalize('NFC')` / `normalize('NFD')` (ADR 0008) | yes |
| `\p{L}`, `\p{Script=Han}` (ADR 0001) | yes |
| `Intl.Segmenter` (item 7) | **no — the polyfill is required** |

NFKC folds fullwidth Latin, a circled digit, the fi ligature, a CJK
compatibility square and a no-break space. `TextDecoder` exists, reports
`encoding === 'utf-8'`, decodes three-byte and four-byte sequences, and holds
state across a chunk boundary with `{ stream: true }`.

`Intl.Segmenter` is **absent** — `Intl.Segmenter is not a function`. That is the
first measured thing this project knows about Hermes's cut-down `Intl`, and it
settles why `unicode-segmenter` is a dependency rather than a maybe.

Those results belong in a dated `notes/NOTES_YYYY-MM-DD.md` (ADR 0015) written by
the author, not here — this file is a pointer, and the note is the record. Items
1 and 2 can then be struck.

## The screen cannot currently be reached from a clean checkout

Read this before trying to reproduce the table above. `npx expo run:ios` builds
and installs, and then iOS 27 refuses to launch the app:

```
Application failed to launch: UIScene life cycle is required for apps built with
this SDK.
```

Expo SDK 57.0.24's prebuild template still generates the legacy window-based
`AppDelegate` and an Info.plist with no `UIApplicationSceneManifest`. The Expo
pod itself ships `ExpoAppSceneDelegate`, whose own doc comment says it is
"Required by the iOS 27, which asserts at launch unless the app adopts the
scene-based life cycle" — but nothing wires it up. The results above were
obtained by wiring it by hand in the generated `ios/`, which is untracked and
has been deleted.

Until that is resolved, this directory's answers stand and the screen does not
run. The fix is in the report for step 1; it is not in this scaffold because it
needs a config plugin, and whether to vendor one or wait for Expo is a decision,
not a detail.

## Then delete this directory

Once the dated note exists and items 1 and 2 are struck, this has no other
purpose. A spike that outlives its question becomes something future readers
have to interpret.
