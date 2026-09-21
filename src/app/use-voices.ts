/** Voice lists are fetched only for explicitly enabled providers. */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { createProvider } from '../core/providers/factory';
import type { ProviderId, VoiceInfo } from '../core/providers/types';
import { readGatewayHeaders, readProviderKey } from '../keys/store';

import { catalogVoices, rememberVoices, scope, subscribeVoiceCatalog, voiceCatalogSnapshot } from './voice-catalog';
import { createVoiceLists } from './voice-lists';
import {
  enabledProviders,
  headersAreOffered,
  keyIsOffered,
  PROVIDER_LABELS,
  providerDeps,
  providerSettings,
  type AppSettings,
} from './settings';

/**
 * The one set of listings the running app has: the start-up prefetch in
 * `shell.tsx` and every open voice sheet ask through it (#24), so a sheet
 * opened while the start-up listing is out waits for that same request.
 */
export const voiceLists = createVoiceLists({
  async list(settings, provider, signal) {
    const key = keyIsOffered(provider) ? await readProviderKey(provider) : null;
    if (key?.outcome === 'refused') {
      throw new Error(`The Keychain would not hand over the key: ${key.refusal.message}`);
    }
    const gateway = headersAreOffered(provider) ? await readGatewayHeaders(provider) : null;
    if (gateway?.outcome === 'refused') {
      throw new Error(`The Keychain would not hand over the gateway headers: ${gateway.refusal.message}`);
    }
    /**
     * `provider` and not `settings.provider`: this list exists so that a Voice
     * can be chosen from a Provider that is **not** the one reading, and
     * `providerSettings` writes the credential into the section of whichever
     * Provider the settings name (philosophy rule 3). So the settings are
     * pointed at the Provider being asked, which is the Provider whose key was
     * just read, and nothing else gets it.
     */
    const built = createProvider(
      provider,
      providerSettings(
        { ...settings, provider },
        {
          key: key?.outcome === 'found' ? key.secret : '',
          headers: gateway?.outcome === 'found' ? gateway.secret : '',
        },
      ),
      providerDeps,
    );
    return built.listVoices({ signal });
  },
  remember: rememberVoices,
  scope,
});

export interface VoiceLists {
  /** The providers the owner explicitly enabled, in display order. */
  enabled: readonly ProviderId[];
  /** The Voices a Provider published, or null if it has not been asked yet. */
  voicesOf(provider: ProviderId): readonly VoiceInfo[] | null;
  /** Whether a Provider is being asked right now — by this sheet, another, or the app's start. */
  asking(provider: ProviderId): boolean;
  /** What the last ask said went wrong, or what a Provider said about itself. */
  note: string | null;
  /** Ask a Provider for its Voices, joining an ask already in flight. Does nothing for a Provider that is not enabled. */
  ask(provider: ProviderId): void;
}

function describe(problem: unknown): string {
  return problem instanceof Error ? problem.message : String(problem);
}

export function useVoiceLists(settings: AppSettings): VoiceLists {
  const lists = useSyncExternalStore(subscribeVoiceCatalog, voiceCatalogSnapshot);
  const inFlight = useSyncExternalStore(voiceLists.subscribe, voiceLists.asking);
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
  const asking = useCallback((provider: ProviderId) => inFlight.has(scope(settings, provider)), [inFlight, settings]);

  const ask = useCallback((provider: ProviderId) => {
    const settingsNow = settingsRef.current;
    if (!settingsNow.enabledProviders.includes(provider)) return;
    setNote(null);
    const label = PROVIDER_LABELS[provider];
    voiceLists.load(settingsNow, provider).then(
      (listed) => {
        if (listed.length === 0) setNote(`${label} answered, and published no Voices.`);
      },
      (problem: unknown) => setNote(describe(problem)),
    );
  }, []);

  return { enabled, voicesOf, asking, note, ask };
}
