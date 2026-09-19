---
status: accepted
---

# Bring your own API keys; no backend

The owner supplies their own provider API keys, which are stored on the device
and sent only to the provider they belong to. There is no server of ours, no
proxy, no subscription and no hosted tier.

This follows the rule the Zotero-TTS plugin already states — "Bring your own
provider: no vendor is required or hard-coded" and "the plugin never spends
your money without you knowing" — and it keeps the project something one
person maintains rather than operates.

## Consequences

The audience is capped at people willing to obtain an API key, which is
effectively technical users. That is acceptable while the app is built for its
author and open-sourced later; it would have to change before the app could
serve a general audience.

Synthesized audio is cached **in memory only**, and there is deliberately no
disk cache. The obvious argument for one — that without it every re-listen
re-spends the owner's own quota — does not apply, because the owner rarely
re-listens to anything.

That reframes what a disk cache would be for. Its value here is not keeping what
has been heard; it is **synthesizing a whole book ahead of time so it can be
listened to offline**, which is a different feature with a different design. So
the step of caching heard audio is skipped entirely rather than deferred, and
pre-synthesis comes later on its own terms.

Two decisions it will need then, both left open: what format the audio is stored
in — raw samples are about sixteen times larger than a low-bitrate encode, and a
ten-hour book is the difference between 1.7 GB and 108 MB — and where it lives,
given that what is wanted is "kept indefinitely but never backed up", which no
JavaScript API on this platform exposes.

## How the key is stored

`expo-secure-store`, which is the iOS Keychain as `kSecClassGenericPassword`,
and **not** at its default accessibility. The default, `WHEN_UNLOCKED`, cannot
be read while the screen is locked — which is precisely when a backgrounded
reader needs the key to synthesize the next sentence. The accessibility must be
`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`: readable during locked background
playback, and still never migrated to another device.

One key per entry. Keychain values have historically been refused above roughly
2 KB, which no API key approaches but a single JSON blob holding every
provider's key eventually would.

Keychain entries survive an app uninstall on iOS, so removing a key has to be an
explicit action in the app.
