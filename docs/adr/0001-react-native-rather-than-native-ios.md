---
status: proposed
---

# Target React Native and Expo rather than native iOS

*The product argument — what this is for and what it gives up — is
`docs/design/0001-one-app-for-iphone-and-android.md`.*

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
mandatory from SDK 55 — there is no opt-out, and by SDK 57 there is no longer a
config key for it either. Expo Go stops at SDK 54 on the App Store, which settles
the question of a development build: one is needed from day one regardless of what
the app does.

Xcode 27 is not merely supported, it is a hard floor in a way "26.4+" understates:
an app built against its SDK **refuses to launch** unless it adopts the
scene-based life cycle, and SDK 57's generated `AppDelegate` does not. See ADR
0018.

(An earlier draft of this ADR said `expo-audio` was "not a preference but the only
option" because `expo-av` was removed in SDK 55. That is wrong: ADR 0012 rejects
`expo-audio` and uses an audio graph instead. The sentence is removed rather than
corrected in place, because its conclusion was the opposite of the decision.)

Hermes was checked for the features the ported code depends on. Unicode
property escapes (`\p{L}`, `\p{Script=Han}`), which `align.ts` and
`speech-text.ts` require, are supported. Two could not be settled by reading and
went to a day-one spike instead of into an assumption. **Both were measured on
2026-09-19 and both are supported** — Hermes 250829098.0.17, the engine React
Native 0.86.3 bundles:

- `String.prototype.normalize('NFKC')`, which has a history of crashing on
  Hermes and is not mentioned in recent release notes, works.
- `TextDecoder`, which the Hermes release notes of 2026-06-05 said ships with
  the engine and an older issue said does not, is present and correct.

So nothing in the ported code needs a polyfill or a JavaScriptCore decision, and
this ADR loses the two risks it was carrying. The measurement — including what
it found that nobody had asked about, that Hermes has no `Intl.Segmenter` at all
— is in `notes/NOTES_2026-09-19.md`, which is the record; this is a pointer to
it (ADR 0015).

## The deployment target is iOS 17.2, not the platform minimum

Expo SDK 57 will run on iOS 16.4. This project requires **17.2** anyway, which is
a choice rather than a constraint.

The reason is the CSS Custom Highlight API, which ADR 0005 depends on to highlight
a word without touching the DOM. It arrived in Safari 17.2. Under a 16.4 floor it
would need a fallback that wraps each word in an element instead — which is the
per-word DOM mutation that ADR 0005 exists to avoid, so the fallback would be a
second implementation of the hardest part of the app, written to be worse.

Raising the floor deletes that path entirely. If it ever needs lowering for a
wider audience, adding a fallback to a working app is easier than having
maintained a second rendering path from the start.

A practical consequence worth noting: the installed simulator runtime is iOS 27.0,
so the floor could not have been tested anyway without downloading an older
runtime specifically to exercise a path that now does not exist.
