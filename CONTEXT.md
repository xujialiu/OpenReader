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

**Cover**:
The picture a Document declares as its own cover, the one the Library shows
beside its name. A Document that declares none has no Cover, even if its first
page is a picture.
_Avoid_: thumbnail, artwork, cover image

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
The form of an utterance's text that is actually sent to a provider to be
spoken. It differs from the utterance's own text only where the owner has asked
for enclosing brackets to be removed; a language hint may travel in front of it
but is not part of it. A provider's word timings are reported in its
coordinates and are turned back into the utterance's before anything is
highlighted.
_Avoid_: stripped text, cleaned text, normalized text, TTS text

**Language Hint**:
A note sent in front of a very short speech text, naming the language its voice
speaks, so that a provider given too few words to judge by does not read them
as another language. It is never spoken, and nothing is highlighted for it.
_Avoid_: cue, prefix, prompt, tag, language tag

**Clip**:
The audio a provider returns for one utterance.
_Avoid_: segment audio, blob, buffer, track

**Offline Narration**:
A document's spoken audio saved on the device for listening inside OpenReader
without a network connection.
_Avoid_: downloaded book, audiobook export, document download

**Download**:
The preparation of one document's offline narration in one voice, for the
chapters the owner chose, worked through one chapter at a time. Each chapter in
it is waiting its turn, being written, paused, failed or saved.
_Avoid_: task, job, queue

**Sentences at once**:
How many of a chapter's sentences a Download asks one Provider for at the
same time. Chosen per Provider.
_Avoid_: concurrency, parallelism, threads, batch size

**Word Timing**:
Where one spoken word falls inside a clip, and which characters of the
utterance it corresponds to. A clip either comes with them or does not; they
are never estimated or interpolated.
_Avoid_: timestamp, speech mark, boundary, alignment

**Highlight Level**:
How much text is marked as it is spoken: the word, or the whole utterance. A
clip that comes without word timings can only be highlighted at utterance
level.
_Avoid_: granularity, highlight mode

**Natural Pace**:
The speed a voice speaks at when nothing asks it to go faster. Every clip is
synthesized at natural pace; playback speed is applied when the clip is
played, never when it is requested.
_Avoid_: rate, default speed, 1x

**Pause between sentences**:
The silence added after an utterance, on top of whatever silence the voice
leaves at its own end. It is set at natural pace, so it shortens as playback
speeds up. Named as the desktop plugin names it.
_Avoid_: gap, delay, sentence gap, break

**Pause between paragraphs**:
The whole silence added after an utterance when the next one begins a new
block (a paragraph, a heading or a list item), or when the document ends. It
replaces the pause between sentences at that point and is not added to it. Set
at natural pace, like the pause between sentences.
_Avoid_: paragraph gap, extra pause, paragraph delay

**Reading**:
One document being read aloud; there is at most one at a time. It begins with
Play, goes on when the owner leaves the reader while it plays, and ends when the
owner leaves the reader while it is paused, opens another document, or deletes
this one.
_Avoid_: session, playback, now playing

### Keeping place and settings

**Library**:
The documents the owner has opened, listed so that returning to one is a tap.
It holds what the owner put there and nothing else — it is not browsable for
documents the owner does not have, and removing an entry leaves the file alone.
_Avoid_: shelf, catalogue, collection, bookshelf, recents

**Folder**:
A named place within the Library containing Documents and other Folders. Each
Document and Folder belongs to exactly one parent Folder or to the Library root.
_Avoid_: collection, tag, category, directory

**Share**:
Handing a copy of one document's file, under the name the Library shows for
it, to another app or person through the phone's own share sheet. Only the file
goes: the Library entry, its reading position and its offline narration stay
behind. It has nothing to do with Shared Settings.
_Avoid_: export, send

**Reading Position**:
Where the reading is in a document: the sentence speech last reached, on this
device or another. Only speech moves it. Pointing the reading at another
sentence while paused changes where Play starts, but not the position, so
leaving the reader without playing comes back to where speech stopped. One per
document, overwritten as the owner reads, and not something the owner creates or
sees in a list. It is a locator and a text anchor together.
_Avoid_: bookmark, progress, location, savedPosition

**Browsing**:
Moving the page to another part of a document without moving the reading,
whether it plays or is paused.
_Avoid_: previewing, peeking, jumping, navigating

**Skip**:
Moving the reading back or forward by one sentence, or to the start of a
paragraph. Unlike browsing, it moves the reading: while it plays, speech goes
there and the reading position follows; while it is paused, only where Play
starts moves.
_Avoid_: jump, step, seek

**Following**:
The page moving itself so that the line being spoken stays at the line
position — a line at a time, or continuously as the words are spoken. Browsing
interrupts it.
_Avoid_: auto-scroll, tracking, centring, automatic mode

**Line Position**:
How far down the visible page the line being spoken is held while following, as
a share of that page's height. It belongs to the owner rather than to a
document.
_Avoid_: anchor, focus point, centre, offset

**Scrolling**:
How following moves the page: by line, a line at a time, or continuously, as
the words are spoken. It belongs to the owner rather than to a document.
_Avoid_: scroll mode, follow mode, scroll style

**Locator**:
Where a reading position points, in the document's own format: for an EPUB,
the paragraph its sentence is in. A paragraph, never a sentence.
_Avoid_: CFI (as a type name), path, selector, pointer

**Text Anchor**:
The quotation half of a reading position: its sentence, with a little of the
text either side of it, by which the place is found again and a locator is
checked.
_Avoid_: quote, snippet, excerpt, context

**Stamp**:
The wall-clock time something was last written, together with the device
name of whoever wrote it, used to decide which of two copies wins. A library
entry carries one that moves whenever the owner touches the document; a
reading position carries its own, which moves only when the reading moves
somewhere new.
_Avoid_: timestamp, ts, version, clock

**Device Name**:
The readable name a device signs its stamps with, so that a position can be
told to have come from the desktop or from a phone. Made once by the device
itself and never chosen or changed by the owner: a phone's names its kind and
ends in a few random characters.
_Avoid_: machine id, device id, host name

**Appearance**:
How the text of a document is set: which font it is shown in, its font size,
its margins, its text alignment and its highlight colours. What a Word Lookup or Text Translation was
asked about, and what it found, are set in the same font and font size, because
they are read as part of the reading. The app's own words around them, its
buttons, rows and notes, are not. It belongs to the owner rather than to a
document, so one choice applies to every document; the font starts out
following whatever the document itself asked for, and the font size, margins
and text alignment never do.
_Avoid_: theme, style, typography, display settings, font settings

**Font Size**:
How big the body text of every document is shown. It is the owner's and never
the document's, so body text is the same size in every document.
_Avoid_: scale, zoom, text size, percentage

**Margins**:
The empty space between a document's text and the left and right edges of the
screen, always the same on both sides. It is the owner's and never the
document's; an indent a document sets inside its own text, for a quotation or a
list, comes on top of it.
_Avoid_: padding, gutter, side space, inset, page margin

**Text Alignment**:
How the lines of body text meet the margins: flush with both, or with the left
one only. It is the owner's and never the document's; text a document centres
or sets to the right is not body text, and keeps the place the document gave it.
_Avoid_: alignment (on its own), justification, text-align, paragraph alignment

**Highlight Colours**:
The colour and opacity the sentence being read and the word being spoken are
marked in. Part of Appearance, and the same under either theme.
_Avoid_: highlight style, highlight theme, highlight scheme

**Theme**:
Whether the app is shown light or dark, including the document itself but not
its highlight colours. It
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
The folder on the owner's own WebDAV server that holds shared settings and
the positions file. Shared with the desktop Zotero-TTS plugin, which reads
and writes the same files.
_Avoid_: remote, cloud, server, bucket

**Positions File**:
The one file in the sync folder, `xujialiu-positions.json`, that holds every
device's reading positions by document id, written by the phones and by the
desktop plugin alike.
_Avoid_: sync file, remote library, catalogue, documents file

### Looking up and translating

**Word Lookup**:
Finding a dictionary's meanings for a selected word in a document, in the
language direction the owner chooses.
_Avoid_: translation (for dictionary definitions), synthesis

**Text Translation**:
Rendering a selected passage of a document in another language.
_Avoid_: word lookup, speech text

**Translation Service**:
A source of text translations, separate from a provider of synthesized speech.
_Avoid_: provider, voice, dictionary

**Pronunciation**:
A dictionary's spoken example of a word, separate from the document's narration.
_Avoid_: clip, voice, offline narration

### On the screen

**Drawer**:
A surface that rises from the bottom of the screen to the drawer height, over
part of what the owner was looking at, holding the choices or the list that
belong to it. Pushed up, it reaches almost to the top of the screen; dragged
down, it goes away. At the drawer height, what it does not cover stays in view
and in use.
_Avoid_: sheet, bottom sheet, modal, popup, panel

**Drawer Height**:
How much of the screen a drawer covers when it opens, measured from the bottom
edge of the screen. The same for every drawer, and the owner's.
_Avoid_: sheet height, detent, drawer size

**Player**:
The Reading's controls, floating over the bottom of the page in the reader: the
voice, the transport, the contents and the speed. Collapsed, it is down to the
Reading Button.
_Avoid_: control bar, toolbar, mini player, transport bar

**Reading Button**:
The round button that stands for the Reading: in the reader, what is left of
the Player when it is collapsed, and in the Library, the way back to the
document being read. It shows whether the Reading is playing, and a press
brings its controls back; it never plays or pauses.
_Avoid_: play button, mini player, floating button, now playing

**Live Activity**:
The phone's own display of the Downloads going on while the app is not in
front, one for all of them, on the Lock Screen and in the Dynamic Island. The
phone draws it; it is not a notification, and OpenReader sends none.
_Avoid_: banner, notification, progress bar, island

**Now Playing**:
The phone's own display of the Reading outside the app: on the Lock Screen, in
the Dynamic Island and in Control Centre. The phone draws it from what the app
tells it.
_Avoid_: lock screen (for the whole of it), media controls, island

### The app on the owner's devices

**Consent**:
The owner's yes to one service receiving text from the app: a Provider
receiving a Document's text to speak it, or a dictionary or Translation Service
receiving a selection. Each service is asked about once, the first time it would
receive any, and the yes is kept on that device only. A server at an address the
owner typed is a service of its own.
_Avoid_: permission, approval, opt-in, agreement, privacy prompt

### The author's side

**Author**:
The person who made OpenReader and answers its email: Xujia Liu. Whoever reads
with the app is its owner; the author is one of them.
_Avoid_: developer, maintainer, creator; for whoever wrote a Document, say "the
document's author"

**Version**:
The three numbers the App Store knows a release by, such as 1.0.0. Only the
author changes it; uploads, submissions and new features leave it as it is.
_Avoid_: release (for the number), marketing version, `v1.0.0`

**Build Number**:
The number of one upload to App Store Connect, shown in brackets after the
Version: 1.0.0 (5). Each upload takes the next number, across all Versions, and
no number is used twice. A Beta shows the number of the upload it leads to.
_Avoid_: build (alone), upload number

**Beta**:
One app change since the last upload, counted from 1 again after each upload:
1.0.0 (5)-beta3 is the third change since build 4. An uploaded build has none,
although TestFlight calls every upload a beta.
_Avoid_: TestFlight beta, beta build, pre-release

**Debug Mode**:
What a build of the app installed on the author's own devices has and a released
build never has: it keeps a Debug Log, and the line in Settings that names its
Version ends in `-debug`, as in 1.0.0 (5)-beta1-debug.
_Avoid_: debug build, diagnostic build, dev build, debug configuration, logging mode

**Debug Log**:
The record a build with Debug Mode keeps on the device of what the app did, read
back from the Mac after the author reports a fault. It never holds a credential.
_Avoid_: log file, trace, diagnostics, crash log

**Demo App**:
A second OpenReader on the author's iPhone, installed beside his own under another
identity and starting empty, so a recording for App Review touches none of his
documents, settings or keys. The line in Settings that names its Version ends in
`-demo`, as in 1.0.0 (5)-beta5-demo.
_Avoid_: demo version, demo build, test app, second app
