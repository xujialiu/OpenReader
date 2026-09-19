/**
 * What the owner has chosen, and whether it is enough to speak.
 *
 * Nothing in this file imports the platform, and that is the point: it is the
 * part of `src/app/` a test can reach at all (`test/README.md` — React Native
 * code is not tested in this suite by design), and what it decides is the one
 * thing ADR 0014 makes unavoidable. **There is no zero-key path.** Until a key
 * is in the Keychain or a server address has been typed, the app cannot speak,
 * and `readiness` is what lets the screen say so instead of failing at the first
 * synthesis.
 *
 * The API key is a **setting**. `providerSettings` is the one place it is joined
 * to a Provider's configuration on its way to
 * `createProvider(id, settings, deps)`, it never arrives as a side effect of
 * synthesis (ADR 0002, which `src/keys/store.ts` states from the other end), and
 * it is written only into the section of the Provider it was typed for —
 * philosophy rule 3: keys go only to the provider they belong to, and to nowhere
 * else.
 */

import { COMPATIBLE_LABEL } from '../core/providers/compatible';
import type { ProviderDeps, ProviderSettings } from '../core/providers/factory';
import { getLocalEngine, LOCAL_ENGINES } from '../core/providers/local/registry';
import type { ProviderId } from '../core/providers/types';

/**
 * The other argument `createProvider(id, settings, deps)` takes, which on this
 * platform is one thing: `fetch` (ADR 0013).
 *
 * Wrapped in an arrow rather than passed by name, because a provider calls
 * `deps.fetch(url, init)` with no receiver and handing over the global itself
 * would make that call's `this` undefined.
 */
export const providerDeps: ProviderDeps = { fetch: (input, init) => fetch(input, init) };

/**
 * The sections the owner can choose between, with the name each is shown under.
 *
 * Two of the four labels are imported rather than written here, because they are
 * the Provider's own and are the same in every language. The local engines are
 * not listed at all: `LOCAL_ENGINES` is the list, and `registry.ts` says adding
 * an engine is an adapter file and one line there — so no engine name is
 * repeated in the UI.
 */
export const PROVIDER_LABELS: Readonly<Record<ProviderId, string>> = {
  'openai-official': 'OpenAI',
  compatible: COMPATIBLE_LABEL,
  speechify: 'Speechify',
  local: 'A server of your own',
};

/** The order the sections are offered in: the one that needs no credentials last, because it is the one with an address to type. */
export const PROVIDER_ORDER: readonly ProviderId[] = ['openai-official', 'compatible', 'speechify', 'local'];

/**
 * Whether this section has an API key at all.
 *
 * `local` has none — a server on the owner's own machine is reached by address
 * (ADR 0014's one configuration that needs no credentials) — and `compatible`
 * may or may not, which is `keyRequired: false` in `compatible.ts`: the request
 * goes out without an Authorization header and a server that wanted one answers
 * 401.
 */
export function keyIsOffered(provider: ProviderId): boolean {
  return provider !== 'local';
}

/** Whether a request without a key is refused before it goes out. The two hosted services; see `keyRequired` in `openai-compatible.ts`. */
export function keyIsRequired(provider: ProviderId): boolean {
  return provider === 'openai-official' || provider === 'speechify';
}

/**
 * The speeds the player offers.
 *
 * 1.5–3× is what the app is built for (ADR 0009, and `docs/PHILOSOPHY.md` is
 * about what happens to a highlight at those speeds). 1.0× is here as well, and
 * not as a courtesy: Natural Pace is what a Provider's Word Timings are reported
 * against, so reading the same page at 1× and at 3× is how the scaling of
 * `rate.ts` is checked at all. Every one of these is inside `clampRate`'s bounds,
 * which is the engine's business and not this list's.
 */
export const READING_RATES: readonly number[] = [1, 1.5, 2, 2.5, 3];

/**
 * Everything the owner has set. One object, held for the session.
 *
 * It is **not** stored anywhere. Shared Settings live in the Sync Folder
 * (ADR 0003) and `src/core/sync/` is not written yet, so the honest thing is to
 * keep them in memory and have the sheet say so — rather than inventing a
 * private store now that the folder will have to argue with later. The API key is
 * the exception and is in the Keychain, because ADR 0002 says where a key lives
 * and nothing about that waits on sync.
 *
 * The two sections that speak OpenAI's API keep their own model and address, as
 * `ProviderSettings` does: nothing typed for one is ever sent to the other.
 */
export interface AppSettings {
  provider: ProviderId;
  openai: {
    /** A speech model id. Empty by default: OpenAI publishes the list and `listModels()` asks for it, so the app does not guess one. */
    model: string;
  };
  compatible: {
    baseURL: string;
    model: string;
  };
  local: {
    /** A `LOCAL_ENGINES` id. */
    engine: string;
    baseURL: string;
  };
  /**
   * The Voice. One Voice belongs to exactly one Provider (CONTEXT.md), so
   * choosing another Provider clears it.
   *
   * ADR 0010 binds a Voice to a document with this as the global default, and
   * that half is not built: there is nowhere to remember a document's own Voice
   * until `core/document/` exists. So there is one Voice, it is the one the open
   * document is read in, and the sheet says that rather than implying a
   * per-document memory that would be lost at the next launch.
   */
  voice: string;
  /** The reading speed. Applied at playback and nowhere else; a Provider is never asked for it (ADR 0009). */
  rate: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  // The first section, not the easiest one: a first run that says "OpenAI has no
  // API key" states ADR 0014's rule where the owner can act on it, and the sheet
  // names the server-of-your-own path underneath. Defaulting to an address that
  // happens to be free would hide the rule instead.
  provider: 'openai-official',
  openai: { model: '' },
  compatible: { baseURL: '', model: '' },
  local: { engine: LOCAL_ENGINES[0].id, baseURL: LOCAL_ENGINES[0].defaultBaseURL },
  voice: '',
  rate: 1.5,
};

/**
 * What is still missing before the app can speak, in the owner's words.
 *
 * A list rather than the first problem found, because "enter a key" followed by
 * "now choose a Voice" followed by "now type a model" is three trips to the same
 * sheet for something that could have been said once.
 */
export type Readiness = { readonly ready: true } | { readonly ready: false; readonly missing: readonly string[] };

/**
 * Whether the selected Provider can be built and asked to speak.
 *
 * `hasKey` rather than the key itself: this decides what the screen shows, and a
 * secret has no business in that. The value is read from the Keychain at the
 * moment it is needed and handed straight to `providerSettings`.
 */
export function readiness(settings: AppSettings, hasKey: boolean): Readiness {
  const missing: string[] = [];

  switch (settings.provider) {
    case 'openai-official':
      if (!hasKey) missing.push('an API key');
      if (!settings.openai.model.trim()) missing.push('a model');
      break;

    case 'compatible':
      if (!settings.compatible.baseURL.trim()) missing.push('the address of the server');
      if (!settings.compatible.model.trim()) missing.push('a model');
      break;

    case 'speechify':
      if (!hasKey) missing.push('an API key');
      break;

    case 'local':
      // An engine id that is in no adapter would reach `createProvider` and
      // throw there; naming it here keeps that a sentence rather than an error.
      if (!getLocalEngine(settings.local.engine)) missing.push('an engine the app knows');
      if (!settings.local.baseURL.trim()) missing.push('the address of the server');
      break;
  }

  // Last, because it is the one thing every section needs and reads oddly first.
  if (!settings.voice.trim()) missing.push('a Voice');

  return missing.length === 0 ? { ready: true } : { ready: false, missing };
}

/** "OpenAI needs an API key, a model and a Voice." */
export function readinessSentence(provider: ProviderId, missing: readonly string[]): string {
  const label = PROVIDER_LABELS[provider];
  if (missing.length === 0) return `${label} is ready.`;
  if (missing.length === 1) return `${label} needs ${missing[0]}.`;
  return `${label} needs ${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}.`;
}

/**
 * The settings `createProvider` reads, with the key in the one section it
 * belongs to.
 *
 * Every section is filled in because `ProviderSettings` describes all four and
 * the factory reads one; the three that are not selected get no key. That is not
 * defensive tidiness — it is philosophy rule 3 in the only place it can be
 * enforced, since this is the single call that turns a typed credential into
 * something a Provider can use.
 */
export function providerSettings(settings: AppSettings, key: string): ProviderSettings {
  const keyFor = (provider: ProviderId): string => (settings.provider === provider ? key : '');

  return {
    'openai-official': { apiKey: keyFor('openai-official'), model: settings.openai.model.trim() },
    compatible: {
      baseURL: settings.compatible.baseURL.trim(),
      apiKey: keyFor('compatible'),
      model: settings.compatible.model.trim(),
    },
    speechify: { apiKey: keyFor('speechify') },
    // No key and no headers: the local engines take neither an API key nor, yet,
    // the gateway headers `kokoro.ts` accepts for a server behind Cloudflare
    // Access. A setting the app does not offer is better than one that claims to
    // do something (philosophy rule 6).
    local: { engine: settings.local.engine, baseURL: settings.local.baseURL.trim() },
  };
}

/**
 * What identifies the Provider the engine was built around.
 *
 * A change to any of it is a different Provider or a different Voice, and the
 * Voice is fixed for an engine's lifetime (ADR 0010) — so the engine is thrown
 * away and built again. The rate is deliberately absent: it is a live parameter
 * of the graph (`setRate`) and putting it here would rebuild the engine, and
 * re-spend the quota, every time the owner nudged the speed.
 */
export function engineIdentity(settings: AppSettings): string {
  return JSON.stringify([
    settings.provider,
    settings.voice,
    settings.openai.model,
    settings.compatible.baseURL,
    settings.compatible.model,
    settings.local.engine,
    settings.local.baseURL,
  ]);
}
