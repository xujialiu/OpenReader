# A contribution is licensed to everyone, and once more to the author

*The engineering half of this decision is
[ADR 0076](../adr/0076-a-contribution-is-licensed-once-more-to-the-author.md).
Issue #149; the author's decisions of 2026-10-10 are its plan comment.*

## What was decided

Anyone may offer a change to OpenReader. Whoever does keeps ownership of what
they wrote. They give it to everyone under the project's licence, as the rest
of the app is given. And they give the author a second, wider permission: to
pass the change on under any other terms as well.

That second permission is what lets the change be part of the copy on the App
Store, where reading aloud is sold (design 0075).

They agree by ticking one box when they offer the change. Nothing is signed and
no account is opened anywhere else. The offer, with its tick, is the record. A
change offered without the tick is not taken in.

## Why a second permission is needed

The project's licence lets anyone copy the app, change it and pass it on, with
conditions. One of them is that whoever passes it on adds no limits of their
own. Apple's store adds limits to every copy it hands out: the copy may be used
only on Apple devices its buyer owns, and may not be passed on. The Free
Software Foundation, which wrote the licence, reads the two as impossible to
honour together.

The author is not caught by this. An owner may hand out his own work on any
terms he likes, so the store copy is in order while every line of the app is
his.

The first line written by someone else changes that. That person owns a piece
of the app and can object to the store copy. This has happened to others. VLC,
a video player under a licence of the same family, was taken off the App Store
in January 2011 after one of its many contributors complained to Apple. It came
back in July 2013, after its authors had agreed to put it under different
licences.

For OpenReader the store copy is also the one that earns money, so an objection
would end the project's income.

## What was turned down

- **A promise made to everyone.** The owners of an app can declare that nobody
  will be pursued for the conflict with Apple's store alone, as the Nextcloud
  app for iPhone does. No contributor has to agree to anything. But the promise
  holds for everyone: anyone could put a copy of OpenReader on the App Store, at
  a price or for nothing, beside the author's. And it settles that one store
  and nothing else.
- **A permission that names only app stores.** It asks less of a contributor,
  who would know their change could never end up under some other licence. But
  its words would be new, written without a lawyer, and any store or
  arrangement they failed to foresee would mean asking every contributor again.
  The wider permission uses wording that large projects have used for years.
- **Taking no code from outside.** The simplest answer. It costs every fix that
  someone else would have written.
- **A signing service.** Projects with many contributors have each one sign
  once, through a service that keeps the signatures. Nobody has offered
  OpenReader a change yet. A box costs nothing to keep, and a service can
  replace it later without changing what is agreed.
- **Asking for ownership itself.** Some projects have contributors hand over
  ownership altogether. The store copy does not need that much, and such a
  transfer is not valid in the same way in every country.

## What it costs

- **Some people will not contribute.** The wider permission lets the author put
  a contribution into a copy under other terms, a closed one included. A person
  who objects to that will keep their change to themselves, or in a copy of
  their own, which the project's licence allows.
- **The author can do what a contributor cannot.** Everyone else receives a
  contribution under the project's licence alone. The store copy rests on that
  one-sidedness.
- **Somebody has to look for the tick.** Nothing stops a change from being
  taken in without it. The author, or an agent working for him, checks each
  time.
- **No lawyer has read the terms.** They reuse established wording with two
  changes. They should be read by one before the first change from outside is
  taken in.
- **The desktop counterpart needs the same.** The part of the app that talks to
  speech services is copied from Zotero-OpenReader. A change taken in there
  without these terms could not follow the rest into the app. Two changes have
  already been offered to that project from outside. Neither was taken in, and
  the author wrote both fixes himself. It has an issue of its own for this.
