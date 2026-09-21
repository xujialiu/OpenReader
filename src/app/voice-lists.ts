/**
 * Asking Providers for their Voices, once per Provider at a time, for whoever
 * asks (#24).
 *
 * The voice sheet used to be the only thing that asked, and only when it
 * opened: "the one fetch that is not a tap, and it is the owner's own act".
 * The owner found the price of that rule on every fresh start — the first tap
 * on a language waited while Fish's four or five listing requests went out —
 * and asked for the lists to be fetched in the background when the app starts.
 * So the listing lives here instead of inside the hook, where both the start
 * and the sheet can reach it:
 *
 * - **One request per Provider and settings scope while it is in flight.** A
 *   sheet opened while the start-up listing is still out waits for that same
 *   request rather than sending a second one.
 * - **Providers are asked at once, not one after another.** The hook used to
 *   refuse a second ask while one was running, so the fourth Provider in the
 *   start-up list would have waited for the first three.
 * - **The start-up ask is silent.** Nobody is looking at a list yet, so a
 *   failure there says nothing; opening the sheet asks again and reports, as it
 *   always has.
 *
 * It is also what fills Fish's session voice cache before a Fish voice first
 * reads a short sentence, which is where #23's language hint finds the voice's
 * language and region.
 */

import type { ProviderId, VoiceInfo } from '../core/providers/types';
import { withTimeout } from '../core/timeout';

import { enabledProviders, PROVIDER_LABELS, type AppSettings } from './settings';

/** Philosophy rule 1: a request that never settles is a spinner that never stops. The same number the Provider screen uses. */
export const ASK_TIMEOUT_MS = 15_000;

export interface VoiceListDeps {
  /** The listing itself, with the Provider's credential read and the Provider built. */
  list(settings: AppSettings, provider: ProviderId, signal: AbortSignal): Promise<VoiceInfo[]>;
  /** Where a listing is kept once it has arrived. */
  remember(settings: AppSettings, provider: ProviderId, voices: readonly VoiceInfo[]): void;
  /** What makes two listings the same one: the Provider, and whatever settings change its answer. */
  scope(settings: AppSettings, provider: ProviderId): string;
}

export interface VoiceLists {
  /** The Provider's Voices, joining a listing already in flight for the same scope. Rejects with what went wrong. */
  load(settings: AppSettings, provider: ProviderId): Promise<readonly VoiceInfo[]>;
  /** Every enabled Provider, asked at once, and every failure kept to itself. */
  prefetch(settings: AppSettings): void;
  /** The scopes being asked right now; a new set whenever that changes, for `useSyncExternalStore`. */
  asking(): ReadonlySet<string>;
  subscribe(listener: () => void): () => void;
}

export function createVoiceLists(deps: VoiceListDeps): VoiceLists {
  const inFlight = new Map<string, Promise<readonly VoiceInfo[]>>();
  const listeners = new Set<() => void>();
  let snapshot: ReadonlySet<string> = new Set();
  const publish = () => {
    snapshot = new Set(inFlight.keys());
    for (const listener of listeners) listener();
  };

  function load(settings: AppSettings, provider: ProviderId): Promise<readonly VoiceInfo[]> {
    const scope = deps.scope(settings, provider);
    const running = inFlight.get(scope);
    if (running) return running;
    const label = PROVIDER_LABELS[provider];
    const abort = new AbortController();
    const promise = withTimeout(
      deps.list(settings, provider, abort.signal),
      ASK_TIMEOUT_MS,
      () => new Error(`${label} did not answer within ${ASK_TIMEOUT_MS / 1000} seconds.`),
      () => abort.abort(),
    )
      .then((voices) => {
        deps.remember(settings, provider, voices);
        return voices as readonly VoiceInfo[];
      })
      .finally(() => {
        inFlight.delete(scope);
        publish();
      });
    inFlight.set(scope, promise);
    publish();
    return promise;
  }

  return {
    load,
    prefetch(settings) {
      for (const provider of enabledProviders(settings)) void load(settings, provider).catch(() => {});
    },
    asking: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
