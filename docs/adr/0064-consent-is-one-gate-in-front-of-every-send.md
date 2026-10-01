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

## The answer comes before every clock

**Measured** on the simulator on 2026-09-30 (iPhone 17, iOS 27.0,
`0.0.2-beta73-debug`, the fake server at `127.0.0.1:8795`;
`test/manual-test/voices-and-providers/consent.md`, "What it found"):

- A Provider was not yet allowed. Play was pressed at utterance 6 at
  00:20:32.896, and the alert was left alone.
- At 00:21:32.982, 60.09 s later, the player showed
  `compatible: no audio within 60s` in red under the still-open alert. The
  engine had paused, `playing=false utterance=7`.
- A Don't Allow at 00:21:48 sent nothing (0 new requests), and left the note
  and utterance 7 in place.
- It was seen twice more, at 23:37:22.4 and about 23:40:59. A harness `pause`
  sent first left only the note.

**The cause.** The question was asked only inside `synthesize()`. The clip
fetcher (`clips.ts`) wraps the whole of `provider.synthesize` in its 60 s
`withTimeout`, so its clock counted the owner's answer as the Provider's
silence. A Voice switch's 120 s deadline (`engine.ts`) ran from the choice, and
would have done the same to a switch. Downloads were not affected: their only
clock is the runtime's own, which starts after the gate.

**Why utterance 7.** Sentence 6 was in the runtime's memory cache from earlier
in that process, and such a sentence never asks: it is not sent. So 6 played,
while the read-ahead's request for 7 waited on the question. When 7's clock ran
out, the engine stopped there, as it stops at any refused Utterance
(ADR 0027). The same run after this change still plays 6 and waits at 7.
Don't Allow then leaves the Reading at 7, where it was waiting, with no note.
The refusal itself moves nothing.

**What was done.** The answer is taken before either clock starts.

- **The fetcher.** `ClipProvider` in `clips.ts` is a Provider with an optional
  `ensureConsent(text, { voice })`. The fetcher awaits it inside the job that
  every Utterance wanting that text shares. That is after the fetcher's own
  cache and before `synthesize()`, whose `withTimeout` is the only clock it has.
  So one question serves all of them. `fetch()` takes an optional `cleared`,
  called once that wait is over: at once for silence or a cache hit, after the
  answer otherwise, and never on a refusal.
- **The runtime.** `offlineProvider` implements it with `ensureConsent()` in
  `runtime.ts`, which asks exactly when `synthesize()` would. It returns at once
  in four cases:
  - The recipient is already allowed. `consent.allows(key)` is a Set lookup,
    because the recipient's key needs no credential, so it reads no Keychain
    entry and no store.
  - The sentence is in the memory cache.
  - Its audio is saved (`savedClip`, the same read `synthesize()` makes).
  - `sendable()` throws, because the sentence could not be sent anyway. Then
    `synthesize()` meets the same reason and reports it.

  Otherwise it calls `consent.ensure`. `sendable()` holds the network, Keychain
  and `readiness` checks that `synthesize()` used to make inline, and both call
  it, so the two cannot disagree about whether a sentence would go out or to
  whom. The gate in `synthesize()` stays the guarantee that nothing is sent
  without a yes, and after the step it answers at once.
- **The switch.** Its deadline is no longer armed in `switchVoice`.
  `startDeadline` arms it once none of the switch's fetches is uncleared (held
  in `uncleared`), so the answer is not counted as preparation. It is armed
  once and never restarted. A slow target still cannot chase a fast reading
  forever, however many sentences it goes on fetching.

**Alternatives turned down.**

- **Asking in `play()` and `chooseVoice()`, with the runtime's gate behind it.**
  The question is reached with no press at all. When a Reading crosses from
  saved or cached audio into a sentence that must be sent, the read-ahead asks
  mid-reading. That crossing, a tapped sentence and a Play from the lock screen
  would all have stayed inside the clock. Asking at the press would also ask
  about audio that is never sent, and a refusal there would stop saved audio
  that sends nothing.
- **No fetcher clock for the runtime's Provider.** The runtime already times
  its own send, after the gate. That gives one clock and no new step, but it
  would have left the Keychain and store reads before the send unbounded on the
  Reading path. The switch's deadline would still have counted the answer.
- **Pausing the clocks while a question is open.** Every timer would have
  needed to know about the gate, and a rule for how much time it has left once
  the answer comes.

**What it costs.**

- **Duplicate reads.** While a Provider is not yet allowed, a sentence is
  looked up twice, by the step and then by `synthesize()`: its saved audio,
  and for one that must be sent, the Keychain. That happens once for each
  sentence the read-ahead reaches before the answer. An allowed Provider costs
  one Set lookup per sentence.
- **A race.** Saved audio deleted between the step and `synthesize()` would be
  asked about inside the clock again. The gate still refuses to send without a
  yes.
- **A switch with no deadline.** A switch that fetches nothing, while the
  engine is held silent, has no deadline until it fetches.
- **A wait away from the screen.** A Reading or a switch that reaches the
  question away from the screen now waits for the answer, however long, with
  nothing timed.

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

For the clocks (#109):

- `test/offline/runtime-consent.test.ts` reproduces the simulator run with the
  real fetcher over the runtime's Provider and fake timers. Unfixed, the fetch
  was rejected at 60 s with `SynthesisError('network', 'speechify: no audio
  within 60s')`. Now it waits 90 s without giving up or sending, and then:
  - a no is `declined`;
  - an Allow plays;
  - a Provider silent after the answer still times out a full clock later.

  It also covers the step's fast paths, including no Keychain or store read
  for an allowed Provider.
- `test/playback/clips.test.ts` covers the fetcher's side, and
  `test/core/consent.test.ts` covers `allows`.
- `test/app/use-reading-resume.test.ts` covers the hook's side: a refusal is no
  note and moves nothing, and a timeout is a note.
- `test/app/consent-paths.test.ts` pins where each clock starts, because
  `engine.ts` cannot run under Node.

Each guard was seen to fail on the unfixed code or with its rule broken.

For the gate itself:

- `test/core/consent.test.ts`: the gate.
- `test/app/consent.test.ts`: recipients, the approved wording, the settings
  projection, and the unconfigured gate refusing.
- `test/offline/runtime-consent.test.ts`: the runtime and `startDownload`.
- `test/offline/scheduler.test.ts`: `'declined'` blocks the download.
- `test/app/use-lookup-consent.test.ts`: the real hook.
- `test/app/consent-paths.test.ts`: the sweep.

Every new guard was watched failing once with its rule broken. The simulator
run of 2026-09-30 (`test/manual-test/voices-and-providers/consent.md`) showed
the rest on the phone: the alert, the quiet pause after Don't Allow, a download
and a lookup each asking, and nothing sent without a yes. The one defect it
found is the section on the clocks above, and that change has not yet run on a
device.
