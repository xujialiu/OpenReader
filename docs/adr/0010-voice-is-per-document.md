---
status: accepted
---

# A voice belongs to a document, with a global default

The provider configuration UI, player eligibility and new-document voice default
are revised by [ADR 0026](0026-a-coherent-reading-interface.md). Historical
measurements below are retained unchanged.

Each document remembers the voice it is read in. A document opened for the first
time inherits whatever the global default is at that moment, and from then on it
keeps its own — changing the global default does not change a document already
being read.

The product argument is in `docs/design/0010-each-document-keeps-its-own-voice.md`.

## Why this reverses the desktop plugin

The Zotero-TTS plugin advertises the opposite as a feature: "One voice and speed
everywhere — every document and every open tab, instead of Zotero's choice per
language." A reader who knows that plugin will assume the same model here, so
the departure needs a reason on record.

The reason is caching. Under one global voice, changing the voice invalidates
every clip already synthesized, everywhere — which under ADR 0002 is quota the
owner has already paid for, and which makes pre-synthesizing a whole book
something that a moment's curiosity about a new voice can throw away. Binding
the voice to the document decouples the two: the global default steers new
documents, and a book already underway is untouched.

## How it is built, 2026-09-20

Written down here because for most of this project's life the decision was
half-true: `LibraryEntry.voice` was in the Library format, parsed and serialized
and tested, and **nothing ever set it**. `use-library.ts` wrote `voice: null` on
add and exposed no writer, so there was one global Voice, `settings.ts` admitted
internally that "that half is not built", and `docs/design/0010` described an app
that did not exist. The walkthrough of 2026-09-20 met it as an English document
read by a Mandarin voice (`notes/NOTES_2026-09-20.md`, 07:38), which on a shelf
holding one Chinese novel and one English document is wrong for one of them
whichever way the single Voice is set.

Four pieces, and the first was already there:

- **`LibraryEntry.voice`** — a `VoiceChoice` of `provider` and `voice`, canonical
  in the file, `provider` a plain string on purpose so that an entry written by a
  build with one more Provider than this one is still readable.
- **`settingsForDocument(settings, choice)`** (`src/app/settings.ts`) — the
  owner's settings with the Document's Provider and Voice in place of the
  defaults, and **nothing else moved**: a model, an address and the Appearance
  belong to the owner rather than to the book. It is the one place the
  substitution happens, so everything downstream follows without knowing —
  `engineIdentity` sees this pair and builds the engine around it, `readiness`
  asks for this Provider's key, the player's line and the Voice sheet show this
  Voice as the one in use.
- **`useLibrary.voiced(id, choice)`** — the writer, which writes through to the
  file like every other change and does **not** move the Stamp: the shelf's order
  is when the owner last touched a book, and `opened` has already moved it.
- **`reader-screen.tsx`** — the wiring, and it is deliberately the screen that
  already knows which Document is *open* rather than which one the route names
  (the hand-over window it documents for the Reading Position is the same window
  here). It reads the open entry's Voice live, so choosing one writes the Library
  and the reading follows from the entry rather than from a second copy of the
  choice.

**Choosing a Voice in the reader writes both halves**: the Document's entry, which
is what it will be read in from now on, and the global default, which is what the
next Document opened for the first time inherits. A book already under way is
untouched, because its own entry holds its own Voice. The **Provider screen** holds
the default on its own — "Default Voice", saying that a book already on the shelf
keeps what it was started with.

**The inheritance is written down, not implied.** A Document whose entry holds no
Voice takes the default at the moment it is opened and keeps it; that is what makes
"changing the default later leaves everything already underway exactly as it was"
true rather than accidental.

## Consequences

Per-language voice selection, Zotero's own model, remains rejected, and a
document with more than one language in it is **not** handled specially: it is
read in its one voice, and whatever that voice does with the other language is
what happens. Detecting language per sentence would mean reinstating the
language detector that ADR 0006 deliberately avoided. This is a decision to
build nothing, not an omission.

A clip's cache identity therefore includes the voice, as it already does in the
plugin — provider, voice and text, and deliberately not speed (ADR 0009).

Two narrower ones, both of them cases where the honest answer is a sentence rather
than a substitution:

- **A Document opened before any Voice has been chosen inherits nothing**, because
  there is nothing to inherit. It reads with the default as the default changes,
  until either a Voice is chosen while it is open — which is written straight to
  it — or it is opened again with a default in place. The alternative would be to
  write the first Voice that happens to exist while the book is open, which is not
  the moment ADR 0010 names.
- **A remembered Voice naming a Provider this build does not have** leaves the
  settings alone and says so on the player (`unusableVoiceSentence`). Nothing is
  silently substituted, and nothing is dropped from the file either: the entry
  keeps what it holds unless the owner chooses something else, because losing a
  Reading Position over an unfamiliar Voice would be the worst possible trade
  (`core/document/library.ts` states it from the other end).
