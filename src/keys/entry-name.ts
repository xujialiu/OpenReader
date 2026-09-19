/**
 * Which Keychain entry holds which Provider's API key.
 *
 * One key per entry, keyed by Provider (ADR 0002), so the entry's name has to
 * be derived from the Provider's id — and that derivation is nearly the whole
 * of `src/keys/` that a test can reach. `expo-secure-store` is a native module
 * and is not tested here by design (test/README.md), which is the reason this
 * is a file of its own rather than a template string at the call site: it can
 * be imported under Node, and `store.ts` cannot.
 *
 * Two facts make it worth getting right rather than obvious.
 *
 * `expo-secure-store` constrains the name. Its own `isValidKey`, in
 * node_modules/expo-secure-store/src/SecureStore.ts, is `/^[\w.-]+$/`, and
 * `ensureValidKey` throws "Invalid key provided to SecureStore. Keys must not
 * be empty and contain only alphanumeric characters, ".", "-", and "_"."
 * before the call ever reaches the Keychain. A Provider id carrying a slash or
 * a space would therefore surface as a rejected promise indistinguishable from
 * the Keychain refusing to answer — which is the one failure this module exists
 * to report precisely.
 *
 * And these entries survive an app uninstall (ADR 0002). An entry name is not
 * an implementation detail that can be tidied up later: changing it abandons
 * every key already written, on a device where nothing the app can do will
 * reach them again.
 */

/**
 * Prefixed because `kSecAttrAccount` is all that identifies the entry to a
 * human reading a Keychain viewer, and ADR 0002 makes removing a key an
 * explicit act — so someone may one day have to find these by eye. A bare
 * `azure` says nothing about which app wrote it, or why.
 */
const ENTRY_NAME_PREFIX = 'provider-key.';

/** `expo-secure-store`'s own rule for an entry name, quoted rather than approximated. */
const ACCEPTED_BY_SECURE_STORE = /^[\w.-]+$/;

/**
 * The name of the Keychain entry holding `provider`'s API key.
 *
 * `provider` is the Provider id — the `id` that
 * `createProvider(id, settings, deps)` takes. It stays a plain `string` rather
 * than the provider layer's own union of ids, because `src/keys/` imports
 * nothing from `src/core/`: a key is a setting the caller hands onward (ADR
 * 0002), and nothing here needs to know what the Provider with that id does.
 * The price is that no type catches a wrong id, which is why the check below is
 * made at runtime instead.
 *
 * This throws where the rest of the module returns. A Provider id that cannot
 * form an entry name is a bug in the caller, not a condition the owner can act
 * on, and keeping the two apart is the point: Keychain refusals are values here
 * precisely so that they are never confused with mistakes of ours.
 */
export function providerKeyEntryName(provider: string): string {
  // Checked before the pattern, because the pattern cannot see it. The prefix
  // alone satisfies `/^[\w.-]+$/`, so an empty id would yield the entirely
  // valid entry name `provider-key.` — and every caller that lost its id would
  // quietly share one key.
  if (provider === '') {
    throw new Error('A Provider id is needed to name the Keychain entry holding its API key, and an empty one was given.');
  }

  const name = `${ENTRY_NAME_PREFIX}${provider}`;
  if (!ACCEPTED_BY_SECURE_STORE.test(name)) {
    throw new Error(
      'A Keychain entry name may hold only alphanumeric characters, ".", "-" and "_", so the Provider id ' +
        `${JSON.stringify(provider)} cannot have one.`,
    );
  }

  return name;
}
