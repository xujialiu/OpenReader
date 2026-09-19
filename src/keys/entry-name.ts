/**
 * Which Keychain entry holds which of a Provider's secrets.
 *
 * Two kinds now. One is the **API key** ADR 0002 names. The other is the
 * **gateway headers** — the `Name: value` pairs a server of the owner's own sits
 * behind, whose values are a service token and therefore a credential (ADR
 * 0019). One entry each, keyed by Provider, so the entry's name has to be
 * derived from the Provider's id — and that derivation is nearly the whole of
 * `src/keys/` that a test can reach. `expo-secure-store` is a native module and
 * is not tested here by design (test/README.md), which is the reason this is a
 * file of its own rather than a template string at the call site: it can be
 * imported under Node, and `store.ts` cannot.
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
 * every secret already written, on a device where nothing the app can do will
 * reach them again. That is also why the two prefixes below are different words
 * rather than one prefix and a suffix: an entry name has to stay readable in a
 * Keychain viewer, which is where an owner has to go to remove a secret an
 * uninstalled app left behind.
 */

/**
 * Prefixed because `kSecAttrAccount` is all that identifies the entry to a
 * human reading a Keychain viewer, and ADR 0002 makes removing a key an
 * explicit act — so someone may one day have to find these by eye. A bare
 * `azure` says nothing about which app wrote it, or why.
 */
const ENTRY_NAME_PREFIX = 'provider-key.';

/**
 * The second kind, and a separate prefix rather than a second field inside the
 * first entry.
 *
 * ADR 0002's "one key per entry" is not tidiness — it is the roughly 2 KB above
 * which Keychain values have historically been refused, which one credential
 * never approaches and a blob of several eventually would. Two secrets for one
 * Provider is the same argument, so they are two entries.
 */
const GATEWAY_HEADERS_PREFIX = 'gateway-headers.';

/** `expo-secure-store`'s own rule for an entry name, quoted rather than approximated. */
const ACCEPTED_BY_SECURE_STORE = /^[\w.-]+$/;

/**
 * The name of a Keychain entry holding one of `provider`'s secrets.
 *
 * `provider` is the Provider id — the `id` that
 * `createProvider(id, settings, deps)` takes. It stays a plain `string` rather
 * than the provider layer's own union of ids, because `src/keys/` imports
 * nothing from `src/core/`: a secret is a setting the caller hands onward (ADR
 * 0002), and nothing here needs to know what the Provider with that id does.
 * The price is that no type catches a wrong id, which is why the check below is
 * made at runtime instead.
 *
 * This throws where the rest of the module returns. A Provider id that cannot
 * form an entry name is a bug in the caller, not a condition the owner can act
 * on, and keeping the two apart is the point: Keychain refusals are values here
 * precisely so that they are never confused with mistakes of ours.
 */
function entryName(prefix: string, provider: string, holds: string): string {
  // Checked before the pattern, because the pattern cannot see it. A prefix
  // alone satisfies `/^[\w.-]+$/`, so an empty id would yield the entirely
  // valid entry name `provider-key.` — and every caller that lost its id would
  // quietly share one secret.
  if (provider === '') {
    throw new Error(`A Provider id is needed to name the Keychain entry holding its ${holds}, and an empty one was given.`);
  }

  const name = `${prefix}${provider}`;
  if (!ACCEPTED_BY_SECURE_STORE.test(name)) {
    throw new Error(
      'A Keychain entry name may hold only alphanumeric characters, ".", "-" and "_", so the Provider id ' +
        `${JSON.stringify(provider)} cannot have one.`,
    );
  }

  return name;
}

/** The name of the Keychain entry holding `provider`'s API key. */
export function providerKeyEntryName(provider: string): string {
  return entryName(ENTRY_NAME_PREFIX, provider, 'API key');
}

/**
 * The name of the Keychain entry holding `provider`'s gateway headers — the
 * whole typed field, `Name: value` pairs and all.
 *
 * The header *names* are not secret and go in here with the values anyway. The
 * owner pastes the pairs as one thing, and splitting the secret half out would
 * mean two fields for one paste and a screen that reassembles a credential from
 * two places. What is gained by splitting is that a Keychain viewer would not
 * show the names; what is lost is the only reading of the field that can be
 * checked by eye.
 */
export function gatewayHeadersEntryName(provider: string): string {
  return entryName(GATEWAY_HEADERS_PREFIX, provider, 'gateway headers');
}
