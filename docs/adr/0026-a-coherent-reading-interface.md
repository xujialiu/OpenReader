---
status: accepted
---
# A coherent reading interface

The product decision is in [design 0026](../design/0026-a-coherent-reading-interface.md).

## Display metadata outlives a Reader

`useVoiceLists` kept the Provider's response in component state. The regression
`test/app/voice-lifetime.test.ts` fetched a known name, unmounted the Reader hook,
then remounted it: the lookup changed from `Bingbing — Female professional (ZH)`
to `undefined` with no change of Provider or Voice id. The fix keeps session lists
outside the screen, subscribes readers to changes, and records names separately
in `voice-names.json`. Provider settings and the reader publish to the same cache.
Only ids, labels and locales are stored, never credentials. Self-hosted names are
scoped by server address (and local engine), not only Provider id. Persisted names
are used for captions; they are not used as a current list of selectable voices.
Opening a document does not fetch a list just to complete its caption.

## Covers are derived, device-local data

The version-1 shared Library schema does not gain thumbnail paths. Covers live
under `Paths.cache/document-covers`, named by Document Id, and can be rebuilt.
Visible library rows read the ZIP directory, container, package and declared cover
only. Inflating the entire archive was rejected: document identity was already
changed to range reads because hashing the owner's 34 MB novel blocked Hermes for
14,362 ms (ADR 0004); thumbnails must not reintroduce a whole-document read.

The extractor handles EPUB 3 `cover-image` and EPUB 2 `meta name="cover"`.
It supports stored and deflated ZIP members and local JPEG, PNG, WebP and GIF
covers, with 1 MiB XML and 8 MiB image limits. Remote, missing, malformed or
unsupported covers use the same placeholder; they never stop opening a document.
`fflate` inflates only selected members and `@xmldom/xmldom` parses the metadata.
The identity manifest is unchanged; member offsets live in a separate ZIP index.

## Icons and status

`react-native-svg`, installed using Expo SDK 57's versioned instructions, renders
one family of 24-unit outline icons. The single/double chevron transport language
follows Zotero-TTS. There is no icon font or Unicode transport glyph. Controls have
spoken labels and at least 44-point targets. Routine reading status and successful
resume messages remain available to diagnostics but leave the player; errors and
missing setup remain visible. This supersedes the presentation portion of 0020,
not the reading cursor or playback semantics.

The navigation container also receives the resolved light/dark theme. On the
simulator, painting only the header background left its native glass controls
with light traits, even while the page and text were dark. The explicit navigation
theme corrects the icons and glass together. Lost or changed resume positions
carry `resumeNeedsAttention`; hiding successful-resume text must not hide those
warnings. Problems render even when the player was previously collapsed.

## Speed adjustment leaves the transport row

Contents and a pressable rate caption flank the five transport buttons in
`player.tsx`; the separate footer row is removed. The caption opens a transparent
sliding `Modal`, following Appearance's backdrop and Done dismissal. `Speed`
mounts only while that drawer is open, so its existing cleanup cancels held-button
timers when the drawer closes. Changes still call `onRate` immediately, with the
range, integer-grid stepping and measured repeat cadence from ADR 0020 unchanged.
Transport hit slop is removed now that these targets sit directly beside one
another; their actual targets remain at least 44 points wide.


## Provider enablement is explicit

The owner agreed that player eligibility requires explicit per-provider
enablement, after a successful connection test. A standalone test does not
enable, and enabling does not select the document's Provider or Voice.
This revises ADR 0020's configured-provider eligibility and its deliberate
first-run offering of `local` solely because its default address exists.
The old measurements in 0020 remain historical evidence, not the new rule.
`PROVIDER_LABELS.local` will read `Kokoro FastAPI` instead of
`A server of your own`. Settings retain a list/detail structure, remove voice
selection from provider configuration, and move optional explanations behind
help controls.

Enabled configurations are read-only; disabling unlocks editing and retains
configuration. There is no Save action. Disabling the document's Provider stops
playback immediately, preserves its Voice assignment, and requires choosing an
enabled Provider on the next play attempt rather than silently falling back.

A new Document inherits the most recently selected Voice whose Provider remains
enabled, or requires selection if none qualifies. There is no separately edited
default Voice. This supersedes the explicit new-document default in ADR 0010,
while retaining per-document Voice assignments. Existing settings migrate with
configuration retained and all Providers disabled; each must pass the explicit
enablement test. Configuration edits, including credentials, persist automatically
while disabled and survive leaving the detail screen. Enable is a test and state
transition, not a save action; a failed test retains inputs. Credentials continue
to belong in the Keychain, separately from ordinary settings. The owner confirmed the complete proposal and authorised implementation.

The previous `AppSettings` was session-only. Local `settings.json` now persists
ordinary configuration and enabled ids; credentials remain in the Keychain.
This is a local preferences file, not the unimplemented shared sync format.
The parser projects known non-secret fields and migrates unversioned settings
with all providers disabled. New documents use `recentVoices`, ordered by the
owner's selections, skipping disabled providers.

Fish configuration explicitly passes `includeOfficial: true`, `includeOwn: false`
and `includeManual: false` by default. The provider layer's own omitted flags
mean enabled, so leaving them out would fetch all three sources. Manual ids are
passed as `voices`. Fish voice-list cache scope includes these source settings.
Connection checks use `checkConnection` where supplied before listing voices:
OpenAI's static voice list is not evidence that a key works. Tests make no audio
playback or synthesis requests. Enable and standalone Test share that check;
only Enable changes eligibility. List and detail share an in-flight check.


The reader's engine identity includes only its own provider configuration and
enablement. Credential revision counters are per provider. Editing a disabled
provider therefore cannot dispose another provider's live engine. A generation
guard also discards an engine build whose credentials finish loading after its
provider was disabled.


## Follow-up provider control review

The owner revised the switch placement to detail-only. Provider rows show names
and a read-only enabled check mark, with neither enable controls nor errors.
Errors remain in the provider detail screen. Remove the detail-header and
API-key help buttons and the separate Remove action. Fish source choices become
native switches, and switch rows need verified vertical centring.

An enabled provider locks every configuration field and source switch. Its
enable control remains operable so it can be disabled. The locked-state hint is
"Disable to edit." Credentials must be editable as actual masked field contents
while disabled, so manual deletion clears the Keychain entry; the existing empty
input plus bullet placeholder cannot support that interaction. Credentials stay
out of ordinary settings, logs and commits. Autosave and test-before-enable
semantics remain unchanged. The owner confirmed and authorised this revision.

`ProvidersScreen` now reads enabled ids directly and renders a check mark; it
neither mounts a connection controller nor displays its error state. The detail
screen owns the sole Enable switch. `useSecretInput` reads only that screen's
credential into its secure field, without triggering a write during hydration.
Initial reads block editing until complete; failed reads cannot overwrite an
unread credential. Clearing invokes the existing queued Keychain deletion.
The editor is keyed by provider and credential kind; late reads after unmount
are ignored. This revises the previous presence-only UI rule while retaining
credential separation from ordinary settings and all persistence formats.

The installed React Native iOS Switch composes `alignSelf: 'flex-start'` into its
style. It overrides a parent's `alignItems: 'center'`, which caused the reported
vertical offset. Both enablement and source switches explicitly set
`alignSelf: 'center'`. No guessed translation or native-size override is needed.


## Credential visibility is independent of editing

The Enabled label and “Disable to edit.” now share a text group beside the
switch, rather than separate siblings in the screen's 20-point gap layout.
API-key fields use a trailing 44-point eye button with Show/Hide accessibility
labels. Visibility is local state, initially false and reset on navigation blur;
it only changes secureTextEntry, never editability or credential persistence.
All API-key providers share this behavior. Extra headers retain their existing
masked field.

## A shared draggable header replaces decorative grips

`Sheet` owns the transparent Modal, backdrop, animated vertical offset and
PanResponder for the handle/title region. The list and stepper do not claim that
gesture, so scrolling and holding speed buttons retain their existing behaviour.
Voice and Speed have no Done; Appearance retains its existing button. Voice
selection no longer closes the sheet. `LoadingSpinner` supplies the same native
ActivityIndicator to pending voice rows and the playback button.

## Voice handover retains the source queue

The previous identity cleanup disposed the engine on every Voice change. The
new path defers document persistence until the native queue actually reaches
the new voice. A pending selection lives separately from the active settings:
the old row keeps its tick and the chosen row spins. Selecting the current voice
cancels pending work; a generation guard discards superseded preparation and
Keychain lookups. A failure restores any queued old tail and leaves the old
voice selected. A paused selection still updates settings immediately without
starting synthesis. Configuration changes and unmount still dispose the engine;
an accepted live handover alone retains it. The cursor preservation of 0025 stays.

The boundary matcher comes from the owner's Zotero-TTS code, including the
captured Kokoro negative-onset fixture. It requires a shared, whole text-token
boundary in both timing arrays and never equates playback seconds across voices.
Missing timings, unsafe overlaps, partial tokens and absent remaining boundaries
fall back to a prepared next Utterance. A switch prepares at most two Clips
concurrently alongside the old read-ahead. Preparation has the existing 60-second
synthesis timeout and a 120-second overall catch-up limit; an armed handover can
remain paused indefinitely. All voice fetchers share the engine's bounded
memory cache, whose key already contains Provider, Voice and text.

Decoded audio is queued in frame-exact pieces at reported word ends. Native
`dequeueBuffer` leaves the read index untouched when removing a non-front buffer;
it resets the read index when removing the front. Consequently handover keeps
the current piece plus a following safe boundary, removes only the later pieces,
and appends the prepared new voice from its matching text offset. The native
queue, rather than a JavaScript timer, executes that boundary. This trades more
native buffer-end events for a handover that does not require stopping the
current source or a second audio session. It does not add per-word WebView
messages: a cue still travels only when the Utterance or voice changes, and
position corrections remain once per second. Timeline entries retain the full
Clip's timings, duration and piece offset; discarded audio does not advance the
content anchor. A queued replacement can be disarmed by restoring its old tail.

`onState` publishes only playing/buffering transitions. Buffering is requested
playback with an empty native queue, including initial synthesis and later
underruns. Pause changes playback intent and pauses the source; it does not
abort requests, empty the queue, or discard arrived audio. The intent guard also
covers asynchronous engine construction and walking past an empty cover.
Arriving Clips while paused hold the renderer, and only another Play resumes it.
The native source boundary, not a network response or decoded buffer, moves the
voice spinner to a tick.

The simulator evidence and fixture limitations are recorded in the engineering
log at 2026-09-20 15:54. The deterministic provider supplies silent WAV data and
real timing arrays through the normal provider path; the actual native graph,
React state, persistence callback and renderer run. This proves transport and
handover state, not the quality of a remote narrator's sound or a long-session
drift bound.


## Fish source membership and regional display grouping (#3)

`Default` remains `mul/default`, but `listVoices` appends it only when
`includeOwn` is enabled. The source controls affect the selectable catalogue,
not saved document voice IDs. A failed enabled-source request still reports its
failure when no remote voices were obtained; Default must not hide that error.

`fishVoice` retains the existing language-derived ID prefix. Display grouping
can use a title or tag explicitly marking English (`EN`, `English`, or a regional
English code) and exactly one recognized region even when `languages` lists
several languages. The existing Aarav fixture contains
`['ru', 'ar', 'en', 'es', 'fr']`, the title
`Aarav — Male Indian multilingual (EN)` and the tag `indian`: it now displays as
`en-IN` while its ID still begins with `mul/`. A name alone, region alone,
description text, or conflicting regions do not establish that classification.
Explicit single-language regional metadata retains precedence; a single
non-English language is not regrouped from its title.

The paused-seek regression added for #2 samples the actual WebView highlight
across background receipt, current/next sentence taps and Play. The latest
bundle's existing intent guard passes those cases; the original reported
animation has not been reproduced, so no additional playback mechanism was
introduced. Measurements and the diagnostic-receiver limitation are recorded
in the engineering log at 2026-09-20 16:37. Text taps continue to select an
Utterance start, not a word offset.
