---
status: accepted
---

# Consent is one gate in front of every send

For #109. Before text first goes to a service, the owner is asked in the phone's
own alert, once per recipient. Guideline 5.1.2(i) requires this, and ADR 0017
deferred it. The product argument is in
`docs/design/0064-the-app-asks-before-text-leaves-the-phone.md`.

## The gate

`src/core/consent.ts` is platform-free. `createConsentGate({ kept, keep, ask })`
returns `ensure(recipient)` and `again(key?)`:

- **One question per key.** Concurrent `ensure` calls for a key share one
  pending question.
- **A yes is `keep`-ed.** `kept` is read on every call, so the gate holds no copy
  that could disagree with the settings.
- **A no keeps nothing, and holds.** Later `ensure` calls for that key resolve
  false at once, without asking, until `again` lifts the refusal.
- **An `ask` that throws is a no.**

`src/app/consent.ts` names the recipients, words the question
(`consentQuestion`) and holds the app's one instance, `consent`. It is
platform-free too, so all of it is tested under Node. The shell configures it
with `configureConsent` before the downloads start, because a download queued
before this change may be about to send:

- `kept` reads `settingsRef.current.consent`.
- `keep` goes through `setSettings`, which updates that ref synchronously, so a
  yes is visible to the very next call.
- `ask` is `askWithAlert` (`src/app/consent-alert.ts`).

Until the shell configures it, the gate keeps nothing and every question is a
no. So no path can send before there is a way to ask.

`askWithAlert` is `Alert.alert(title, message, [Don't Allow (style 'cancel'),
Allow (isPreferred)], { cancelable: false, onDismiss })`. That is the phone's
permission-prompt arrangement, Allow bold on the right. In React Native 0.86,
`cancelable` and `onDismiss` exist only on Android (`Alert.d.ts`). On iOS the
alert can only be answered with a button, and a dismissal elsewhere counts as a
no.

## Recipients, and where a yes is kept

| Recipient | Key | Named |
| --- | --- | --- |
| OpenAI, Azure, Speechify, Fish Audio | `provider:<id>` | `PROVIDER_LABELS` |
| OpenAI-compatible, Kokoro-FastAPI | `provider:<id>@<origin>` | `the server at <host[:port]>` |
| Free Dictionary API (English → English) | `lookup:free-dictionary` | `the Free Dictionary API` |
| Youdao (the other dictionaries; translation) | `lookup:youdao` | `Youdao` |
| Google, Microsoft Translator | `lookup:google`, `lookup:microsoft` | `Google`, `Microsoft Translator` |

- **A hosted Provider** is one recipient whatever its model, voice or Azure
  region.
- **A server the owner typed** is keyed by `originOf` its configured address.
  Another path on the same server is the same recipient. Another host, port or
  scheme is not.
- **A pronunciation** rides on its lookup's recipient: it plays only from a
  result that service returned. Youdao's dictionary page, `aidemo` translation
  and `dictvoice` audio are all one recipient, Youdao.
- **"With your API key"** is said only when a key goes along. That is
  `keyResult.outcome === "found"` for synthesis. Kokoro-FastAPI never takes
  one, and among lookups only Microsoft Translator does.

A yes is a key in `AppSettings.consent`, in `settings.json`. The file is
device-local and is not the Positions File, so it is never synced. Each device
asks for itself. `parseSettings` keeps only strings matching `CONSENT_KEY`, once
each. A file written before #109 has no `consent`, so everything is asked about
afresh, with no migration. The walkthrough harness's `settings` patch can set
it, which is how a device test starts with a recipient already allowed.

## Where it is asked

- **Synthesis:** `synthesize()` in `src/offline/runtime.ts`. It is the one place
  a Reading and a download send a Document's text, and Azure's WebSocket runs
  inside the Provider it builds there. The question comes after the offline
  check, the Keychain read and `readiness`, so a missing key is still reported
  as that. It comes before `createProvider`, so nothing is built for a refused
  recipient. The engine's Clips reach it through `offlineProvider`, for the
  Reading and for a Voice switched to (`use-reading.ts`).
  `test/app/consent-paths.test.ts` fails if a `.synthesize(` call appears
  anywhere else outside the Provider layer, or if the gate moves below the call.
- **Starting a download:** `startDownload` asks before `enqueue`, so a refusal
  leaves no task. The drawer calls only that.
- **Looking up:** `use-lookup.ts` asks after reading the Microsoft key, because
  the question says whether a key goes along, and before `lookup()`.

Voice lists are not asked about. `listVoices` and the connection check send the
key and no text, and the warm-up GET carries nothing at all (ADR 0040).

## Why a refusal holds until the owner asks again

The engine asks for up to `CONCURRENT_FETCHES` (2) Utterances at a time, within
`READ_AHEAD_UTTERANCES` (3) of the cursor. When those are refused, `pump` runs
in the fetch's `finally` and starts the next absent Utterances in the window.
Each would call `ensure` again, so without the hold the alert would come back
the moment Don't Allow dismissed it, once per sentence in the window. So a
refusal stands until `again`, which is called where the owner asks for text to
be sent:

- `play()` and `chooseVoice()` in `use-reading.ts` lift every refusal;
- Resume all or Retry failed (`toggleTask`) and a chapter's ring that resumes
  (`toggleChapter`) lift every refusal;
- `startDownload` lifts its recipient's;
- each lookup lifts its recipient's.

## What a refusal does on each path

It is a `SynthesisError` of a new kind, `'declined'`, with `declinedSentence`
as its message. The kind is not retriable.

- **A Reading:** the refused Utterances go into `failed`, and `drain` pauses at
  the first one once the queue is empty. That is ADR 0027's stop on a refusal,
  unchanged, so the cursor stays where the reading was. `report` (`onError`)
  ignores `isDeclined`, so the player shows no note.
- **A Voice switch:** its `failed` clears `pendingVoice` without a
  `voiceError`, and the reading goes on in the old Voice.
- **A download:** the scheduler treats `'declined'` as it treats `'auth'`,
  `'no-key'` and `'quota'`. The task becomes `blocked`, shown as Needs
  attention with the sentence, and no chapter is marked failed.
- **A lookup:** `close()`, as the drawer's own close does. Nothing was
  requested.

## Tests

- `test/core/consent.test.ts`: the gate.
- `test/app/consent.test.ts`: recipients, the approved wording, the settings
  projection, and the unconfigured gate refusing.
- `test/offline/runtime-consent.test.ts`: the runtime and `startDownload`.
- `test/offline/scheduler.test.ts`: `'declined'` blocks the download.
- `test/app/use-lookup-consent.test.ts`: the real hook.
- `test/app/consent-paths.test.ts`: the sweep.

Every new guard was watched failing once with its rule broken. Nothing here has
run on a device yet. The alert's appearance, and the Reading's quiet pause
after Don't Allow, are for the simulator run.
