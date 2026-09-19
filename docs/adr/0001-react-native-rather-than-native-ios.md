---
status: proposed
---

# Target React Native and Expo rather than native iOS

Android is a hard requirement, which rules out a SwiftUI-only app. Among the
cross-platform options, React Native wins on one specific asset rather than on
general merit: the TTS provider layer of the Zotero-TTS plugin is about 3,000
lines of TypeScript that is roughly 95% portable as-is, because its dependency
injection is already complete — `createProvider(id, settings, deps)` takes
`{ fetch, getWebSocket, newRequestId, ... }` and the only Zotero-specific code
left in the non-system providers is two functions in `azure.ts`.

## Considered options

Flutter and Kotlin Multiplatform were rejected for the same reason: either one
means rewriting those providers in another language, and with them the two
dozen provider quirks that only exist in the code because they were found by
measuring live APIs — that Kokoro-FastAPI speaks `29.83` as "twenty-nine point
eight three", that Speechify's speech marks are in milliseconds and not the
seconds its docs claim, that Cloudflare MeloTTS returns a WAV while documenting
MP3, that Azure's `:DragonLatestNeural` voices emit dozens of zero-duration
word boundaries after about 9.5 seconds. Flutter's text rendering is in fact
the better fit for custom highlighting, but not by enough to pay for a rewrite.

## Consequences

React Native saves less here than it does in a typical app, and this should be
expected rather than discovered. The two hardest components — the audio session
with lock-screen controls and high-resolution playback position, and
highlighting an arbitrary text range in a rendered document — are both places
where native code or a WebView bridge is unavoidable. The realistic shape of
the project is one native module, one WebView bridge, and shared TypeScript
for everything else.

The platform facts this is built on, as of September 2026: Expo SDK 57, React
Native 0.86, Xcode 26.4+. The New Architecture is
mandatory from SDK 55 — there is no opt-out. `expo-av` was removed entirely in
SDK 55, so `expo-audio` is not a preference but the only option. Expo Go stops
at SDK 54 on the App Store, which settles the question of a development build:
one is needed from day one regardless of what the app does.

Hermes was checked for the features the ported code depends on. Unicode
property escapes (`\p{L}`, `\p{Script=Han}`), which `align.ts` and
`speech-text.ts` require, are supported. Two remain unresolved and belong on a
day-one spike rather than in an assumption:

- `String.prototype.normalize('NFKC')` has a history of crashing on Hermes and
  is not mentioned in recent release notes. It is used in two places.
- `TextDecoder` — the Hermes release notes of 2026-06-05 say it now ships with
  the engine; an older Hermes issue says it does not. Which is true of the
  Hermes actually bundled in React Native 0.86 was not established.

## The deployment target is iOS 17.2, not the platform minimum

Expo SDK 57 will run on iOS 16.4. This project requires **17.2** anyway, which is
a choice rather than a constraint.

The reason is the CSS Custom Highlight API, which ADR 0005 depends on to highlight
a word without touching the DOM. It arrived in Safari 17.2. Under a 16.4 floor it
would need a fallback that wraps each word in an element instead — which is the
per-word DOM mutation that ADR 0005 exists to avoid, so the fallback would be a
second implementation of the hardest part of the app, written to be worse.

Raising the floor deletes that path entirely. While the app is built for its
author, on the author's own devices, the floor costs nothing: it is not a market
to be served, it is one person's phone. If it ever needs lowering for a wider
audience, adding a fallback to a working app is easier than having maintained a
second rendering path from the start.

A practical consequence worth noting: the installed simulator runtime is iOS 27.0,
so the floor could not have been tested anyway without downloading an older
runtime specifically to exercise a path that now does not exist.
