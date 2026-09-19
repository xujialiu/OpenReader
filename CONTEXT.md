# FreeReader

A reader for EPUB — later PDF and HTML — that speaks the text aloud through a
text-to-speech provider the reader's owner chooses and pays for directly, and
that keeps its place in sync across the owner's phones, tablets and their
desktop copy of the Zotero-TTS plugin.

`FreeReader` is the project and repository name. The name shown on the App Store
is a separate, later decision: review guideline 2.3.7 forbids prices and
descriptive terms in an app's name, and "Free" reads as a price.

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

**Block**:
A run of text the document itself presents as one unit — a paragraph, a
heading, a list item.
_Avoid_: segment, paragraph (as a type name), node

**Utterance**:
The unit of text sent to a provider as one synthesis request, in practice one
sentence. The unit of caching, of prefetching and of resuming.
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

**Voice**:
One named speaker a provider offers. A voice belongs to exactly one provider.
_Avoid_: model, speaker, persona

**Clip**:
The audio a provider returns for one utterance.
_Avoid_: segment audio, blob, buffer, track

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

**Reading Position**:
Where speech stopped in a document. One per document, overwritten as the
owner reads, and not something the owner creates or sees in a list.
_Avoid_: bookmark, progress, location, savedPosition

**Stamp**:
The wall-clock time an entry was last written, together with which device
wrote it, used to decide which of two copies of an entry wins.
_Avoid_: timestamp, ts, version, clock

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
