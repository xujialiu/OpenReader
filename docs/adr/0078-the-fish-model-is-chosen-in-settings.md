---
status: accepted
---

# Fish audio identity includes the Model without moving existing free audio

[Design 0078](../design/0078-the-fish-model-is-chosen-in-settings.md) is the product
agreement for #229. Fish's Model is a local setting, not a Voice or a synced
setting. The app previously passed `freeOnly: true` unconditionally; existing
Fish audio therefore belongs to `s2.1-pro-free`, with no desktop-switch
migration required.

## Preserve the original free-audio address

`OfflineVoice.model` records a Fish speech Model. A missing Model means the old
free Model, never whatever is currently selected. `narrationIdentity` keeps
`[provider, voice]` for that Model and for other Providers, and uses
`[provider, model, voice]` for other Fish Models. `voiceKey` hashes that identity;
chapter membership remains a Model-independent hash of Speech Text.

This deliberately gives the free Model a different-shaped identity. Making
every key uniformly include a Model would require moving or renaming every
existing free Clip and its recovery records. Keeping its existing key makes
upgrade and switching back reuse the same files, without migration copying
paid-for audio or requiring temporary free storage.

SQLite `user_version` becomes 2. The migration adds a nullable `voices.model`
column and advances the version in one exclusive transaction. Old rows retain
NULL and their original keys. Task JSON carries the optional Model too.
Already-saved audio, write intents, deletion intents and sidecars do not move.
Older app code rejects the new database version rather than writing the old
five-column Voice shape into it.

The same identity names runtime progress, task matching, deletion epochs,
in-flight synthesis and memory Clips. Reading supplies the selected Model;
a Download supplies its recorded Model, including after Settings changes while
a request is out. A late reply may still be saved after a pause, as before, but
only under its original Model. This extends ADR 0027's provider-and-voice
identity for Fish only; #174's other Provider Model/Address cases remain open.

## A switch pauses work, not just its presentation

`configureDownloads` pauses every unfinished Fish task on a Model change and
persists the state. Other Providers are untouched. Startup also pauses tasks
whose Model differs from Settings, and remembers switches that happened before
the asynchronous task load, including a switch away and back. Stale resume
callbacks cannot resume a hidden Model. No switch automatically resumes work.

The Download drawer filters saved Fish Voices by the selected Model and passes
that Model to progress and chapter deletion. Contents and saved-audio readiness
use the same identity. Model and Voice are separate informational rows; the
Model row also names Fish Audio. Document-wide occupied space and Delete all
audio remain unfiltered, so hidden audio is still removable. Their
confirmation names every Provider, Model and Voice.

Delete all current voice audio (#306) is scoped by the voice key, which carries
the Model: `removeVoiceDownloads` drops the Document's task for that
`narrationIdentity`, then `beginVoiceRemoval` marks every clip row of the voice
key `deleting`, cancels its `writes` and drops its `voices` row in one
transaction, and `cleanDeletions` removes the files and rows. It selects by
voice rather than through `memberships`, so it reaches clips a bracket setting
change re-keyed away from every chapter, which `beginDelete` cannot, and frees
exactly `occupied(document, voice)`. A reply still out at the Provider is not
saved, because `fetch` keeps a result only while its task is in `tasks`.

## Known choices are useful even when discovery cannot answer

`fish-models.ts` separates speech Models from Fish's reference-Voice objects,
which its API also calls models. The known order is `s2.1-pro-free`,
`s2.1-pro`, `drama-3`, `s2-pro`. Keyless
`GET https://api.fish.audio/compat/v1/models` adds entries with
`architecture.modality = text->speech` and a `fish-audio/` identifier; the prefix
is removed for the request's `model` header. Other modalities are not choices.
The request is single-flight, bounded to five seconds including JSON body
consumption, and successful results are cached for thirty minutes. Failure
leaves the known and saved choices usable and can be retried by reopening the
settings page.

Labels say free or paid, never a quoted price: the compat response does not
name the billing unit. Missing or invalid pricing is not treated as free. A
saved unlisted Model remains selectable by its identifier alone. The existing
native settings menu gains disabled support; it follows the Provider page's
existing disable-edit-enable convention. The phone's connection test remains
its existing check, not a newly added synthesis probe.

No date is used to refuse a Model or shown as the end of the free offer. Fish
has extended that offer repeatedly, so the owner rejected a hard-coded date
and another availability request merely to maintain it. This does not add the
retirement/free-status guard withdrawn from the desktop feature.

## Automated evidence

`runtime-fish-models.test.ts` runs the real runtime and repository over SQLite,
with platform APIs, Provider replies and audio payload files doubled. It checks
v1 Voice-column migration and repeated initialization, the old free address,
Model-isolated memory and in-flight requests, Model-scoped chapter deletion,
document-wide deletion, pauses across Documents and Voices, other Providers
continuing, late free replies, switching back, persisted pauses and explicit
resumption after a fresh runtime. It does not establish audible quality or
native file/database behavior.

`fish-models.test.ts` checks discovery filtering, known order, unlisted
selection, free/paid labels, single-flight caching, retry and a stalled body.
Provider tests check the exact selected Model header; settings tests cover old
defaults and persisted selections. `download-model.test.ts` renders the actual
drawer with platform views doubled to check separate Model/Voice rows, hidden
old-model Voices, preserved other Providers and the document-wide confirmation.
Native interaction and delivery remain the iOS tester's acceptance gate.
