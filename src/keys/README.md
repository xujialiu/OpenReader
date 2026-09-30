# src/keys — ADR 0002, ADR 0019

A provider's credentials, in the Keychain. Nothing else.

**Two kinds, since ADR 0019.** The API key ADR 0002 names, and the **gateway
headers**: the `Name: value` pairs that get past whatever guards a server of the
owner's own. The second is not an API key and the argument for putting it here
is made again rather than inherited — it is a bearer credential, it is needed on
the synthesis path with the screen locked, and the place it would otherwise live
is the settings, whose stated destination is the owner's own sync folder. A
credential goes to the provider it belongs to and nowhere else, and a sync server
is somewhere else.

The owner supplies their own keys, stored on the device and sent only to the
provider they belong to. There is no server of ours, no proxy, no subscription
and no hosted tier — philosophy rule 3, and there is no server of mine.

## The one thing that is easy to get wrong

`expo-secure-store`, which is the iOS Keychain as `kSecClassGenericPassword`, and
**not at its default accessibility.**

The default, `WHEN_UNLOCKED`, cannot be read while the screen is locked — which
is precisely when a backgrounded reader needs the key to synthesize the next
sentence. The accessibility must be **`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`**:
readable during locked background playback, and still never migrated to another
device.

This is the same requirement as the `audio` background mode in `app.config.ts`,
seen from the other side. Both are needed for a 60–90 minute backgrounded session
(notes/NOTES.md item 4) to survive, and a key the Keychain refuses at 2 a.m. is
one of the failure modes that note says are invisible on a desk.

## Two more facts from the ADR

**One secret per entry.** Keychain values have historically been refused above
roughly 2 KB, which no API key approaches but a single JSON blob holding every
provider's key eventually would. Two secrets for one provider is the same
argument, so they are two entries under two prefixes — and one entry per provider
per kind is what makes "a credential goes only to the provider it belongs to"
true of the headers as well as of the key.

**Keychain entries survive an app uninstall on iOS**, so removing a key has to be
an explicit action in the app.

## Credentials never reach the provider layer as a side effect

A key is a setting, handed to `createProvider(id, settings, deps)`. So are the
gateway headers, which the factory parses on the way in. The provider
layer does not read the Keychain and `eslint.config.js` forbids it from importing
`expo-secure-store` at all (ADR 0013). That is what keeps the provider tests
runnable under Node.

## What is not here, deliberately

**No link to any provider's signup, pricing or key console** (ADR 0017). Not a
tappable button, not a URL, not pricing anywhere in the app or its screenshots.
Instructions for obtaining a key are static text; the walkthrough lives in the
repository and on the project's site.

This will look like an omission to anyone later trying to improve onboarding. It
is not. The one App Store rejection in this category with a documented resolution
turned on something narrow: the directive was *remove the "Get API Key" link from
the binary*. The app deleted the link, replaced it with static text, and shipped —
keeping the key field, the save action, the provider picker, the validation and
every bit of the plumbing. **The credential field was never the problem. The
tappable route to the provider's paid signup was.**

## Asked before anything is sent

Guideline 5.1.2(i), amended in late 2025 to name third-party AI explicitly,
requires disclosing what data goes to a third party and obtaining permission
**before** it is sent, and a rejection in this category stated plainly that a
privacy policy alone is not sufficient. So before a key and a Document's text
first go to a Provider, the owner is asked, once per Provider, in the phone's
own alert (#109, ADR 0064). The question is on the synthesis path,
`src/offline/runtime.ts`, after the key has been read and before anything is
built with it.

## What is here

Three files, split where the native module is.

- `store.ts` — the three operations, twice over, and the only file in OpenReader
  that touches the Keychain. One options object serves every call: two would be
  two places for the service name to drift, and `test/keys/provider-key.test.ts`
  asserts that exactly one accessibility is named in the file.
- `entry-name.ts` — a Provider id becomes a Keychain entry name, under one prefix
  per kind of secret.
- `refusal.ts` — what the Keychain said when it would not answer.

The split is not decoration. `store.ts` cannot be imported under Node, because
`expo-secure-store` resolves its native module at import time, so the halves
that can be wrong on their own live beside it where `test/keys/provider-key.test.ts`
can reach them. The two decisions left inside `store.ts` are one line each and
their values come from that native module, so they are checked as source text —
the same tool `test/app-config.test.ts` already uses on `app.config.ts`, for the
same reason.

**Reading a secret has three outcomes, not two.** `found`, `absent` and `refused`:
`getItemAsync` resolves `null` for "there is no entry" and rejects for
everything else, and collapsing the second into the first is how the 2 a.m.
failure becomes indistinguishable from an owner who never entered a key
(philosophy rule 1).

**Saving a secret deletes the entry first.** Not defensiveness. iOS's `set` adds
the item with the accessibility it was given, but on `errSecDuplicateItem` it
falls through to an update of `kSecValueData` alone — so an entry keeps the
accessibility it was *created* with, however many times the key is saved again.
Entries survive an uninstall, so one written at `WHEN_UNLOCKED` by an earlier
build would otherwise stay unreadable while locked on that device forever, with
nothing the app could do about it. Deleting first makes "save the key again" the
fix, at a price that is reported rather than hidden: a write refused after a
successful delete leaves no key, and says so.
