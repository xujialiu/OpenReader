---
status: accepted
---

# A voice belongs to a document, with a global default

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

## Consequences

Per-language voice selection, Zotero's own model, remains rejected, and a
document with more than one language in it is **not** handled specially: it is
read in its one voice, and whatever that voice does with the other language is
what happens. Detecting language per sentence would mean reinstating the
language detector that ADR 0006 deliberately avoided. This is a decision to
build nothing, not an omission.

A clip's cache identity therefore includes the voice, as it already does in the
plugin — provider, voice and text, and deliberately not speed (ADR 0009).
