# OpenReader

A reader for EPUB — later PDF and HTML — that speaks the text aloud through a
text-to-speech provider the reader's owner chooses and pays for directly, and
that keeps its place in sync across the owner's phones, tablets and their
desktop copy of the Zotero-TTS plugin.

Everything the app runs on belongs to the owner: the provider is the owner's, the
keys are the owner's, the sync server is the owner's, and the documents stay the
owner's.

## Language

### What is read

**Document**:
One file the owner reads: an EPUB now, a PDF or HTML page later.
_Avoid_: book, attachment, item, file, publication

**Document Id**:
A document's identity, derived from the document's own bytes and metadata
rather than from any library that holds it, so that two devices recognise the
same document without a shared catalogue.
_Avoid_: content id, hash, key, ISBN

**Contents**:
A document's own list of its parts, as rows a reader can open — the volumes and
chapters a book names for itself. A row may name a place that has no text on it.
_Avoid_: table of contents, TOC, navigation, index, outline, chapter list

**Block**:
A run of text the document itself presents as one unit — a paragraph, a
heading, a list item.
_Avoid_: segment, paragraph (as a type name), node

**Body Text**:
The text a document sets most of its characters in: its paragraphs, as against
its headings, notes and small print.
_Avoid_: running text, main text

**Utterance**:
The unit of the document's text that becomes one synthesis request, in practice
one sentence. The unit of caching, of prefetching and of resuming.
_Avoid_: segment, sentence (as a type name), chunk, phrase

**Speakable**:
Said of text containing at least one letter or digit. Text that is not
speakable is never sent to a provider; it becomes silence.
_Avoid_: valid, non-empty, meaningful

### Speech

**Provider**:
A source of synthesized speech, reached over the network: a hosted service, a
server on the owner's own machine, or the operating system's own voices.
_Avoid_: engine, backend, service, vendor, TTS

**Enabled Provider**:
A provider the owner has made available for selection in the player.
_Avoid_: configured provider, in-use provider, default provider

**Voice**:
One named speaker a provider offers. A voice belongs to exactly one provider.
_Avoid_: model, speaker, persona

**Gateway Headers**:
The credential a provider reached at an address of the owner's own needs in
order to get past whatever guards that address. It belongs to one provider, as
a key does, and is never sent to another.
_Avoid_: auth headers, token, proxy headers, custom headers, access token

**Speech Text**:
The form of an utterance's text that is actually sent to a provider. It differs
from the utterance's own text only where the owner has asked for enclosing
brackets to be removed. A provider's word timings are reported in its
coordinates and are turned back into the utterance's before anything is
highlighted.
_Avoid_: stripped text, cleaned text, normalized text, TTS text

**Clip**:
The audio a provider returns for one utterance.
_Avoid_: segment audio, blob, buffer, track

**Offline Narration**:
A document's spoken audio saved on the device for listening inside OpenReader
without a network connection.
_Avoid_: downloaded book, audiobook export, document download

**Word Timing**:
Where one spoken word falls inside a clip, and which characters of the
utterance it corresponds to. A provider either reports these or does not;
they are never estimated or interpolated.
_Avoid_: timestamp, speech mark, boundary, alignment

**Highlight Level**:
How much text is marked as it is spoken: the word, or the whole utterance. A
provider that reports no word timings can only be highlighted at utterance
level.
_Avoid_: granularity, highlight mode

**Natural Pace**:
The speed a voice speaks at when nothing asks it to go faster. Every clip is
synthesized at natural pace; playback speed is applied when the clip is
played, never when it is requested.
_Avoid_: rate, default speed, 1x

### Keeping place and settings

**Library**:
The documents the owner has opened, listed so that returning to one is a tap.
It holds what the owner put there and nothing else — it is not browsable for
documents the owner does not have, and removing an entry leaves the file alone.
_Avoid_: shelf, catalogue, collection, bookshelf, recents

**Reading Position**:
Where speech stopped in a document. One per document, overwritten as the
owner reads, and not something the owner creates or sees in a list.
_Avoid_: bookmark, progress, location, savedPosition

**Stamp**:
The wall-clock time an entry was last written, together with which device
wrote it, used to decide which of two copies of an entry wins.
_Avoid_: timestamp, ts, version, clock

**Appearance**:
How the text of a document is set: which font it is shown in and its font
size. It belongs to the owner rather than to a document, so one choice applies
to every document; the font starts out following whatever the document itself
asked for, and the font size never does.
_Avoid_: theme, style, typography, display settings, font settings

**Font Size**:
How big the body text of every document is shown. It is the owner's and never
the document's, so body text is the same size in every document.
_Avoid_: scale, zoom, text size, percentage

**Theme**:
Whether the app is shown light or dark, including the document itself. It
belongs to the owner rather than to a document and can defer to the phone's own
setting, which is what it does until the owner says otherwise.
_Avoid_: appearance, dark mode, night mode, colour scheme, skin

**Shared Settings**:
The settings all of the owner's devices agree on, merged setting by setting so
that two devices changing different settings both keep their change.
_Avoid_: sync settings, global settings, preferences

**Settings Backup**:
One device's complete settings, written for that device alone and never
merged. Restoring one replaces settings rather than combining them.
_Avoid_: snapshot, export, sync

**Sync Folder**:
The folder on the owner's own WebDAV server that holds shared settings,
reading positions and the document catalogue. Shared with the desktop
Zotero-TTS plugin, which reads and writes the same files.
_Avoid_: remote, cloud, server, bucket
