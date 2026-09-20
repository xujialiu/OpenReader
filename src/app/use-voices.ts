/** Voice lists are fetched only for explicitly enabled providers. */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { createProvider } from '../core/providers/factory';
import type { ProviderId, VoiceInfo } from '../core/providers/types';
import { withTimeout } from '../core/timeout';
import { readGatewayHeaders, readProviderKey } from '../keys/store';

import { catalogVoices, rememberVoices, subscribeVoiceCatalog, voiceCatalogSnapshot } from './voice-catalog';
import {
  enabledProviders,
  headersAreOffered,
  keyIsOffered,
  PROVIDER_LABELS,
  providerDeps,
  providerSettings,
  type AppSettings,
} from './settings';

/** Philosophy rule 1: a request that never settles is a spinner that never stops. The same number the Provider screen uses. */
const ASK_TIMEOUT_MS = 15_000;

export interface VoiceLists {
  /** The providers the owner explicitly enabled, in display order. */
  enabled: readonly ProviderId[];
  /** The Voices a Provider published, or null if it has not been asked yet. */
  voicesOf(provider: ProviderId): readonly VoiceInfo[] | null;
  /** The Provider being asked, or null. */
  asking: ProviderId | null;
  /** What the last ask said went wrong, or what a Provider said about itself. */
  note: string | null;
  /** Ask a Provider for its Voices. Does nothing if its list is already held or an ask is in flight. */
  ask(provider: ProviderId): void;
}

function describe(problem: unknown): string {
  return problem instanceof Error ? problem.message : String(problem);
}

export function useVoiceLists(settings: AppSettings): VoiceLists {
  const lists = useSyncExternalStore(subscribeVoiceCatalog, voiceCatalogSnapshot);
  const [asking, setAsking] = useState<ProviderId | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /**
   * The settings as they are, for the ask below, which runs after an await and must
   * not read a value from the render that started it.
   */
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const enabled = useMemo(
    () => enabledProviders(settings),
    [settings],
  );

  const voicesOf = useCallback((provider: ProviderId) => catalogVoices(lists, settings, provider), [lists, settings]);

  const ask = useCallback(
    (provider: ProviderId) => {
      if (asking || !settingsRef.current.enabledProviders.includes(provider)) return;
      setAsking(provider);
      setNote(null);
      const label = PROVIDER_LABELS[provider];
      void (async () => {
        try {
          const settingsNow = settingsRef.current;
          const key = keyIsOffered(provider) ? await readProviderKey(provider) : null;
          if (key?.outcome === 'refused') {
            throw new Error(`The Keychain would not hand over the key: ${key.refusal.message}`);
          }
          const gateway = headersAreOffered(provider) ? await readGatewayHeaders(provider) : null;
          if (gateway?.outcome === 'refused') {
            throw new Error(`The Keychain would not hand over the gateway headers: ${gateway.refusal.message}`);
          }
          /**
           * `provider` and not `settingsNow.provider`: this list exists so that a
           * Voice can be chosen from a Provider that is **not** the one reading, and
           * `providerSettings` writes the credential into the section of whichever
           * Provider the settings name (philosophy rule 3). So the settings are
           * pointed at the Provider being asked, which is the Provider whose key was
           * just read, and nothing else gets it.
           */
          const built = createProvider(
            provider,
            providerSettings(
              { ...settingsNow, provider },
              {
                key: key?.outcome === 'found' ? key.secret : '',
                headers: gateway?.outcome === 'found' ? gateway.secret : '',
              },
            ),
            providerDeps,
          );
          const abort = new AbortController();
          const listed = await withTimeout(
            built.listVoices({ signal: abort.signal }),
            ASK_TIMEOUT_MS,
            () => new Error(`${label} did not answer within ${ASK_TIMEOUT_MS / 1000} seconds.`),
            () => abort.abort(),
          );
          rememberVoices(settingsNow, provider, listed);
          if (listed.length === 0) setNote(`${label} answered, and published no Voices.`);
        } catch (problem) {
          setNote(describe(problem));
        } finally {
          setAsking(null);
        }
      })();
    },
    [asking],
  );

  return { enabled, voicesOf, asking, note, ask };
}
