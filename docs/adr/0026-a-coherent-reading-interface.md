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
