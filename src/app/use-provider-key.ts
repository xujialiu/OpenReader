/**
 * Whether the Keychain holds a key for a Provider, and the two acts that change
 * that.
 *
 * `src/keys/store.ts` is the whole of the Keychain and this is the whole of the
 * app's use of it: look, save, forget. Three operations because ADR 0002 names
 * three needs, and **forget** is a first-class one — Keychain entries survive an
 * app uninstall on iOS, so deleting the app is not how a key goes away.
 *
 * The key's value never reaches React state. It is read at the moment a Provider
 * is built (`use-reading.ts`) and handed over as a setting; what the UI holds is
 * whether there is one.
 */

import { useCallback, useEffect, useState } from 'react';

import type { ProviderId } from '../core/providers/types';
import { forgetProviderKey, readProviderKey, saveProviderKey } from '../keys/store';

import { keyIsOffered } from './settings';

/**
 * What is known about a Provider's key.
 *
 * `refused` is not folded into `absent`, and that is the distinction
 * `src/keys/refusal.ts` exists to preserve: "the owner has not entered a key" and
 * "there is a key and the Keychain would not read it" are different problems, and
 * the second is the one that happens with the screen locked.
 */
export type KeyPresence =
  | { readonly state: 'unknown' }
  | { readonly state: 'not-offered' }
  | { readonly state: 'held' }
  | { readonly state: 'absent' }
  | { readonly state: 'refused'; readonly message: string };

export interface ProviderKey {
  presence: KeyPresence;
  /** Store it, replacing whatever was there. Resolves with what went wrong, or null. */
  save(key: string): Promise<string | null>;
  /** Remove it. Resolves with what went wrong, or null. */
  forget(): Promise<string | null>;
  /**
   * Do something that needs the key, with the key.
   *
   * It is handed to a callback rather than returned so that a caller cannot keep
   * it: the value belongs in `providerSettings` and nowhere else (ADR 0002).
   * A Provider with no key is called with the empty string, which is what its own
   * `keyRequired` is there to judge.
   */
  withKey<T>(use: (key: string) => Promise<T>): Promise<T>;
}

export function useProviderKey(provider: ProviderId): ProviderKey {
  /**
   * The answer, and which Provider it was about.
   *
   * Both, so that choosing another Provider does not have to *reset* anything:
   * an answer about OpenAI is not an answer about Speechify, and `presence` below
   * derives that rather than briefly claiming the previous Provider's key belongs
   * to this one.
   */
  const [answered, setAnswered] = useState<{ provider: ProviderId; presence: KeyPresence } | null>(null);

  const look = useCallback(async (): Promise<KeyPresence> => {
    if (!keyIsOffered(provider)) return { state: 'not-offered' };
    const lookup = await readProviderKey(provider);
    if (lookup.outcome === 'found') return { state: 'held' };
    if (lookup.outcome === 'absent') return { state: 'absent' };
    return { state: 'refused', message: lookup.refusal.message };
  }, [provider]);

  useEffect(() => {
    let watching = true;
    void look().then((found) => {
      if (watching) setAnswered({ provider, presence: found });
    });
    return () => {
      watching = false;
    };
  }, [look, provider]);

  const presence: KeyPresence = answered?.provider === provider ? answered.presence : { state: 'unknown' };

  const save = useCallback(
    async (key: string) => {
      const change = await saveProviderKey(provider, key.trim());
      setAnswered({ provider, presence: await look() });
      return change.outcome === 'done' ? null : change.refusal.message;
    },
    [provider, look],
  );

  const forget = useCallback(async () => {
    const change = await forgetProviderKey(provider);
    setAnswered({ provider, presence: await look() });
    return change.outcome === 'done' ? null : change.refusal.message;
  }, [provider, look]);

  const withKey = useCallback(
    async <T>(use: (key: string) => Promise<T>): Promise<T> => {
      if (!keyIsOffered(provider)) return use('');
      const lookup = await readProviderKey(provider);
      if (lookup.outcome === 'refused') {
        throw new Error(`The Keychain would not hand over the key: ${lookup.refusal.message}`);
      }
      return use(lookup.outcome === 'found' ? lookup.key : '');
    },
    [provider],
  );

  return { presence, save, forget, withKey };
}
