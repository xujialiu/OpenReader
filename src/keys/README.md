# src/keys — ADR 0002

A provider's API key, in the Keychain. Nothing else.

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

**One key per entry.** Keychain values have historically been refused above
roughly 2 KB, which no API key approaches but a single JSON blob holding every
provider's key eventually would.

**Keychain entries survive an app uninstall on iOS**, so removing a key has to be
an explicit action in the app.

## Keys never reach the provider layer as a side effect

A key is a setting, handed to `createProvider(id, settings, deps)`. The provider
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

## Deferred, with a known price

Guideline 5.1.2(i), amended in late 2025 to name third-party AI explicitly,
requires disclosing what data goes to a third party and obtaining permission
**before** it is sent, and a rejection in this category stated plainly that a
privacy policy alone is not sufficient. A per-provider consent sheet, shown
before the first request, is therefore required to ship.

It is not built, because while the app is used only by its author the consent is
being asked of the person granting it. It is one check on the synthesis path.
That is a deferral with a known price, not an oversight.
