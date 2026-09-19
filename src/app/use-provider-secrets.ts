/**
 * Whether the Keychain holds a Provider's secrets, and the acts that change
 * that.
 *
 * `src/keys/store.ts` is the whole of the Keychain and this is the whole of the
 * app's use of it: look, save, forget. Three operations because ADR 0002 names
 * three needs, and **forget** is a first-class one — Keychain entries survive an
 * app uninstall on iOS, so deleting the app is not how a secret goes away.
 *
 * **Two secrets, one shape.** The API key (ADR 0002) and the gateway headers
 * (ADR 0019) differ in what they are for and in nothing else: both are the
 * owner's credential for one Provider, both are needed on the synthesis path
 * with the screen locked, and both are removed only by asking. So there is one
 * hook body and two names for it, rather than two hooks that could drift.
 *
 * A secret's value never reaches React state. It is read at the moment a
 * Provider is built (`use-reading.ts`) and handed over as a setting; what the UI
 * holds is whether there is one.
 */

import { useCallback, useEffect, useState } from 'react';

import type { ProviderId } from '../core/providers/types';
import {
  forgetGatewayHeaders,
  forgetProviderKey,
  readGatewayHeaders,
  readProviderKey,
  saveGatewayHeaders,
  saveProviderKey,
  type SecretChange,
  type SecretLookup,
} from '../keys/store';

import { useShell } from './routes';
import { headersAreOffered, keyIsOffered } from './settings';

/**
 * What is known about one of a Provider's secrets.
 *
 * `refused` is not folded into `absent`, and that is the distinction
 * `src/keys/refusal.ts` exists to preserve: "the owner has not entered one" and
 * "there is one and the Keychain would not read it" are different problems, and
 * the second is the one that happens with the screen locked.
 */
export type SecretPresence =
  | { readonly state: 'unknown' }
  | { readonly state: 'not-offered' }
  | { readonly state: 'held' }
  | { readonly state: 'absent' }
  | { readonly state: 'refused'; readonly message: string };

export interface ProviderSecret {
  presence: SecretPresence;
  /** Store it, replacing whatever was there. Resolves with what went wrong, or null. */
  save(secret: string): Promise<string | null>;
  /** Remove it. Resolves with what went wrong, or null. */
  forget(): Promise<string | null>;
  /**
   * Do something that needs it, with it.
   *
   * It is handed to a callback rather than returned so that a caller cannot keep
   * it: the value belongs in `providerSettings` and nowhere else (ADR 0002).
   * A Provider with none is called with the empty string, which is what its own
   * `keyRequired` — or, for headers, the gateway's own answer — is there to
   * judge.
   */
  with<T>(use: (secret: string) => Promise<T>): Promise<T>;
}

/** The three Keychain calls one kind of secret is made of, so that the hook below is written once. */
interface SecretStore {
  offered(provider: ProviderId): boolean;
  read(provider: ProviderId): Promise<SecretLookup>;
  save(provider: ProviderId, secret: string): Promise<SecretChange>;
  forget(provider: ProviderId): Promise<SecretChange>;
  /** What the sentence calls it when the Keychain will not hand it over. */
  called: string;
}

const KEY: SecretStore = {
  offered: keyIsOffered,
  read: readProviderKey,
  save: saveProviderKey,
  forget: forgetProviderKey,
  called: 'the key',
};

const HEADERS: SecretStore = {
  offered: headersAreOffered,
  read: readGatewayHeaders,
  save: saveGatewayHeaders,
  forget: forgetGatewayHeaders,
  called: 'the gateway headers',
};

function useProviderSecret(provider: ProviderId, store: SecretStore): ProviderSecret {
  /**
   * Every screen that shows a secret's presence is mounted at once — the
   * Library, the Reader under the stack, and the Provider screen being typed
   * into. The one being typed into is the only one that writes, so the other two
   * would go on showing what was true when they mounted, and a Reader whose Play
   * button is disabled because it still believes there is no key is a dead end
   * with nothing on screen to explain it.
   *
   * `secretsWritten` is the shell's count of writes. Reading it here is what
   * makes a save on one screen a re-look on all of them; `use-reading.ts` reads
   * the same number to decide that the engine it built with the old credential
   * is no longer the engine to play.
   */
  const { secretsWritten, noteSecretWritten } = useShell();

  /**
   * The answer, and which Provider it was about.
   *
   * Both, so that choosing another Provider does not have to *reset* anything:
   * an answer about OpenAI is not an answer about Speechify, and `presence` below
   * derives that rather than briefly claiming the previous Provider's secret
   * belongs to this one.
   */
  const [answered, setAnswered] = useState<{ provider: ProviderId; presence: SecretPresence } | null>(null);

  const look = useCallback(async (): Promise<SecretPresence> => {
    if (!store.offered(provider)) return { state: 'not-offered' };
    const lookup = await store.read(provider);
    if (lookup.outcome === 'found') return { state: 'held' };
    if (lookup.outcome === 'absent') return { state: 'absent' };
    return { state: 'refused', message: lookup.refusal.message };
  }, [provider, store]);

  useEffect(() => {
    let watching = true;
    void look().then((found) => {
      if (watching) setAnswered({ provider, presence: found });
    });
    return () => {
      watching = false;
    };
  }, [look, provider, secretsWritten]);

  const presence: SecretPresence = answered?.provider === provider ? answered.presence : { state: 'unknown' };

  const save = useCallback(
    async (secret: string) => {
      const change = await store.save(provider, secret.trim());
      setAnswered({ provider, presence: await look() });
      noteSecretWritten();
      return change.outcome === 'done' ? null : change.refusal.message;
    },
    [provider, look, store, noteSecretWritten],
  );

  const forget = useCallback(async () => {
    const change = await store.forget(provider);
    setAnswered({ provider, presence: await look() });
    noteSecretWritten();
    return change.outcome === 'done' ? null : change.refusal.message;
  }, [provider, look, store, noteSecretWritten]);

  const withSecret = useCallback(
    async <T,>(use: (secret: string) => Promise<T>): Promise<T> => {
      if (!store.offered(provider)) return use('');
      const lookup = await store.read(provider);
      if (lookup.outcome === 'refused') {
        throw new Error(`The Keychain would not hand over ${store.called}: ${lookup.refusal.message}`);
      }
      return use(lookup.outcome === 'found' ? lookup.secret : '');
    },
    [provider, store],
  );

  return { presence, save, forget, with: withSecret };
}

/** The Provider's API key (ADR 0002). */
export function useProviderKey(provider: ProviderId): ProviderSecret {
  return useProviderSecret(provider, KEY);
}

/**
 * The Provider's gateway headers (ADR 0019), offered only by the two sections of
 * `ProviderSettings` that have somewhere to put them.
 */
export function useGatewayHeaders(provider: ProviderId): ProviderSecret {
  return useProviderSecret(provider, HEADERS);
}
