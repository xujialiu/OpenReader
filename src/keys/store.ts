/**
 * A Provider's secrets, in the Keychain. Nothing else — ADR 0002.
 *
 * `expo-secure-store` is the iOS Keychain as `kSecClassGenericPassword`, and
 * this file is the only place in OpenReader that touches it. Three operations
 * per secret, because ADR 0002 names three needs: the owner enters one, the
 * reader reads it while the screen is locked, and the owner removes it — the
 * last one because Keychain entries survive an app uninstall, so deleting the
 * app is not how a secret goes away.
 *
 * **Two kinds of secret, not one.** ADR 0002 wrote down the API key. ADR 0019
 * adds the **gateway headers**: the `Name: value` pairs that reach a server of
 * the owner's own through a gateway, whose values are a service token and
 * therefore a credential by every test ADR 0002 applies to a key — needed on the
 * synthesis path with the screen locked, useless on any other device, and
 * belonging to one Provider and to nothing else. The settings they might
 * otherwise have lived in are the ones ADR 0003 intends to sync to the owner's
 * own folder, and philosophy rule 3 says a credential goes to the Provider it
 * belongs to and nowhere else — a sync server is somewhere else.
 *
 * Nothing here imports from `src/core/`, and nothing in `src/core/` may import
 * this. A secret reaches a Provider only as a setting a caller passes to
 * `createProvider(id, settings, deps)`, never as a side effect of synthesis:
 * `eslint.config.js` forbids the provider layer from importing
 * `expo-secure-store` at all, which is what keeps its 3,200 lines of tests
 * runnable under Node (ADR 0002, ADR 0013).
 *
 * This module cannot be imported under Node — `expo-secure-store` resolves the
 * native module at import time — so the parts of it worth testing live in
 * `entry-name.ts` and `refusal.ts` beside it.
 */

import * as SecureStore from 'expo-secure-store';

import { gatewayHeadersEntryName, providerKeyEntryName, SYNC_PASSWORD_ENTRY_NAME } from './entry-name';
import { keychainRefusal, type KeychainRefusal } from './refusal';

export type { KeychainRefusal } from './refusal';

/**
 * What reading a secret found, and deliberately not `string | null`.
 *
 * Three outcomes, because there are three: the secret is there, there is none,
 * or the Keychain would not say. Collapsing the last two into `null` is the
 * mistake `refusal.ts` exists to prevent, and a union makes it one a caller
 * cannot make by accident — `secret` is unreachable without narrowing first.
 */
export type SecretLookup =
  | { readonly outcome: 'found'; readonly secret: string }
  | { readonly outcome: 'absent' }
  | { readonly outcome: 'refused'; readonly refusal: KeychainRefusal };

/** What saving or forgetting a secret did. Either it happened, or the Keychain refused and said why. */
export type SecretChange = { readonly outcome: 'done' } | { readonly outcome: 'refused'; readonly refusal: KeychainRefusal };

/**
 * iOS's `kSecAttrService` for every entry written here, which the module
 * suffixes with `:no-auth` (SecureStoreModule.swift `query(with:options:)`).
 * Naming it is worth the one hazard it carries: the default is `app`, shared
 * with anything else in the process using this package, and ADR 0002 makes
 * removing a key an explicit act — which someone may one day have to perform
 * with a Keychain viewer rather than this app.
 *
 * The hazard is that changing this string abandons every entry already written,
 * and those entries outlive the app. It is effectively permanent.
 *
 * It has changed once, when the app was renamed from OwnReader to OpenReader,
 * and only because that rename changed the bundle identifier in the same breath.
 * An entry written with no keychain-sharing entitlement lives in the access group
 * derived from the bundle identifier, so every key the old app wrote was already
 * out of the new app's reach and this string had nothing left to abandon. That
 * coincidence is the only circumstance in which it may change again.
 */
const KEYCHAIN_SERVICE = 'openreader.provider-keys';

/**
 * The options every call below passes. The accessibility line is the one line
 * in `src/keys/` that cannot be wrong.
 *
 * The default is `WHEN_UNLOCKED` — `SecureStoreOptions` documents it and
 * node_modules/expo-secure-store/ios/SecureStoreOptions.swift defaults the
 * field to `.whenUnlocked` — and a `WHEN_UNLOCKED` item cannot be read while
 * the screen is locked. That is precisely when a backgrounded reader needs the
 * key to synthesize the next Utterance, so the default produces a reader that
 * works on a desk and stops in a pocket. `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`
 * is readable after the first unlock following a restart, and is still never
 * migrated to another device (ADR 0002). It is the same requirement as the
 * `audio` background mode in `app.config.ts`, seen from the other side.
 *
 * `requireAuthentication` is absent, and its absence is a decision. A key needed
 * at 2 a.m. with the screen locked cannot sit behind a biometric prompt.
 * `app.config.ts` sets `faceIDPermission: false` for the same reason, so the
 * plugin writes no NSFaceIDUsageDescription — and iOS's `set` throws
 * MissingPlistKeyException without one, so the option could not even be turned
 * on here quietly. test/keys/provider-key.test.ts fails if it ever appears.
 *
 * One object for every call, although the accessibility is read only on a write
 * — `attributeWith(options:)` is called from `set` and nowhere else.
 * `keychainService` is the reason: it must be identical on every call, or a read
 * looks in a different service and honestly reports a stored secret as absent.
 * It is also why the gateway headers go through the same object rather than one
 * of their own: two option objects is two places for that string to drift.
 */
const KEYCHAIN: SecureStore.SecureStoreOptions = {
  keychainService: KEYCHAIN_SERVICE,
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/**
 * Store `secret` in `name`, replacing whatever was there.
 *
 * The entry is deleted before it is written, and that is not belt and braces.
 * iOS's `set` adds the item with `kSecAttrAccessible` taken from the options,
 * but on `errSecDuplicateItem` it falls through to `update`, whose update
 * dictionary holds `kSecValueData` alone — so an entry that already exists keeps
 * the accessibility it was *created* with, however many times the secret is
 * saved again (SecureStoreModule.swift). Combine that with entries surviving an
 * app uninstall (ADR 0002) and an entry written at `WHEN_UNLOCKED` by any earlier
 * build would stay unreadable while locked on that device forever, with nothing
 * the app could do about it. Deleting first makes "save it again" the fix.
 *
 * The price is named rather than hidden: if the delete succeeds and the write is
 * refused, the previous value is gone, and this says so. That is the right way
 * round — the caller is a person who has just typed a credential and can type it
 * again, and the alternative is one that cannot be read in the one place it
 * matters.
 */
async function writeSecret(name: string, secret: string): Promise<SecretChange> {
  try {
    await SecureStore.deleteItemAsync(name, KEYCHAIN);
    await SecureStore.setItemAsync(name, secret, KEYCHAIN);
    return { outcome: 'done' };
  } catch (cause) {
    return { outcome: 'refused', refusal: keychainRefusal(cause) };
  }
}

/**
 * Read the secret in `name`.
 *
 * The value goes to the caller and no further. This is the call a backgrounded
 * reader makes with the screen locked, which is why `KEYCHAIN` above says what
 * it says, and why a refusal here is reported rather than flattened into
 * "nothing stored".
 */
async function readSecret(name: string): Promise<SecretLookup> {
  try {
    // `null` is the package's documented answer for "no entry for this key".
    // Everything that went wrong rejects instead, and that is the whole
    // distinction `SecretLookup` keeps.
    const secret = await SecureStore.getItemAsync(name, KEYCHAIN);
    return secret === null ? { outcome: 'absent' } : { outcome: 'found', secret };
  } catch (cause) {
    return { outcome: 'refused', refusal: keychainRefusal(cause) };
  }
}

/**
 * Remove the entry `name`.
 *
 * `done` means no entry remains, which is not the same claim as "an entry was
 * removed": `deleteValueWithKeyAsync` issues `SecItemDelete` for all three query
 * shapes the package has ever written and ignores every status, so forgetting
 * something that was never there succeeds. Reporting that as a failure would be
 * the false signal — what the caller asked to be true is true.
 */
async function removeSecret(name: string): Promise<SecretChange> {
  try {
    await SecureStore.deleteItemAsync(name, KEYCHAIN);
    return { outcome: 'done' };
  } catch (cause) {
    return { outcome: 'refused', refusal: keychainRefusal(cause) };
  }
}

/**
 * The empty string would be stored happily, read back as a found secret, and
 * fail a long way from here — as a 401 from the Provider, or as a request that
 * quietly carries no gateway header at all. Surrounding whitespace is left
 * alone: this module writes what it is given, and tidying up a pasted credential
 * belongs to whatever read the text field.
 */
function refuseEmpty(provider: string, secret: string, holds: string): void {
  if (secret === '') {
    throw new Error(`The ${holds} for the Provider ${JSON.stringify(provider)} cannot be the empty string.`);
  }
}

/** Store `key` as `provider`'s API key, replacing whatever was there. */
export async function saveProviderKey(provider: string, key: string): Promise<SecretChange> {
  const name = providerKeyEntryName(provider);
  refuseEmpty(provider, key, 'API key');
  return writeSecret(name, key);
}

/** Read `provider`'s API key. */
export async function readProviderKey(provider: string): Promise<SecretLookup> {
  return readSecret(providerKeyEntryName(provider));
}

/**
 * Remove `provider`'s API key from the Keychain.
 *
 * A first-class operation, not a convenience. Keychain entries survive an app
 * uninstall on iOS, so removing the app is not how an owner gets rid of a
 * credential, and ADR 0002 therefore makes this something the app has to offer.
 */
export async function forgetProviderKey(provider: string): Promise<SecretChange> {
  return removeSecret(providerKeyEntryName(provider));
}

/**
 * Store `provider`'s gateway headers — the field as the owner typed it,
 * `Name: value` pairs separated by `;` or newlines.
 *
 * Unparsed, deliberately. `core/headers.ts` drops a malformed pair rather than
 * sending it half-formed, and parsing here would mean the owner's text and what
 * is stored could differ without the screen ever saying so. What was typed is
 * what is kept; what is sent is what `parseHeaderList` makes of it.
 */
export async function saveGatewayHeaders(provider: string, headers: string): Promise<SecretChange> {
  const name = gatewayHeadersEntryName(provider);
  refuseEmpty(provider, headers, 'gateway headers');
  return writeSecret(name, headers);
}

/** Read `provider`'s gateway headers. */
export async function readGatewayHeaders(provider: string): Promise<SecretLookup> {
  return readSecret(gatewayHeadersEntryName(provider));
}

/** Remove `provider`'s gateway headers, for the same reason a key can be removed: the entry outlives the app. */
export async function forgetGatewayHeaders(provider: string): Promise<SecretChange> {
  return removeSecret(gatewayHeadersEntryName(provider));
}

/**
 * The WebDAV password of the Sync Folder (issue #20). One entry, the same
 * options object as every other secret here — a second object would be a
 * second place for the service name to drift — and the same three acts.
 */
export async function saveSyncPassword(password: string): Promise<SecretChange> {
  if (password === '') throw new Error('The WebDAV password cannot be the empty string; forget it instead.');
  return writeSecret(SYNC_PASSWORD_ENTRY_NAME, password);
}

/** Read the WebDAV password. */
export async function readSyncPassword(): Promise<SecretLookup> {
  return readSecret(SYNC_PASSWORD_ENTRY_NAME);
}

/** Remove the WebDAV password from the Keychain. */
export async function forgetSyncPassword(): Promise<SecretChange> {
  return removeSecret(SYNC_PASSWORD_ENTRY_NAME);
}

/** Kept separate from Azure speech: configuring one never lends its key to the other. */
const TRANSLATOR_KEY = 'openreader.translation.microsoft';
export const readTranslationKey = (): Promise<SecretLookup> => readSecret(TRANSLATOR_KEY);
export const saveTranslationKey = (key: string): Promise<SecretChange> => {
  if (!key.trim()) throw new Error('Enter a Microsoft Translator key.');
  return writeSecret(TRANSLATOR_KEY, key.trim());
};
export const forgetTranslationKey = (): Promise<SecretChange> => removeSecret(TRANSLATOR_KEY);
