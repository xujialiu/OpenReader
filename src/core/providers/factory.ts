import { parseHeaderList } from '../headers';
import { createCompatibleProvider } from './compatible';
import { SynthesisError } from './errors';
import { createFishProvider } from './fish';
import { getLocalEngine } from './local/registry';
import { createOpenAIProvider } from './openai';
import { createSpeechifyProvider } from './speechify';
import type { ProviderId, TTSProvider } from './types';

/**
 * One provider from its section of the settings. Enabled or not, the settings
 * only say how to reach it — what is published to the owner is a question for
 * the layer above.
 */

/**
 * Everything the platform has to hand in — still exactly one thing.
 *
 * In the plugin this also carried `getWebSocket` and `newRequestId` for Azure's
 * WebSocket route, and `newAbortController` for Fish. Azure is not here. Fish
 * now is, and it needed **nothing added**: `newAbortController` existed only
 * because the Zotero sandbox has no `AbortController` of its own and one had to
 * be borrowed from a chrome window, and this engine has it (measured,
 * notes/NOTES_2026-09-19.md). Fish's other two injections — a session voice
 * cache and the pause before a retry — are not platform capabilities: each has
 * a working default inside `fish.ts`, the same way `speechify.ts` keeps its
 * shared serial queue there, and each exists so a test can be fast and
 * isolated without stubbing a global.
 *
 * The one dependency that is left is the one the whole of ADR 0013 rests on: a
 * provider never reaches for a global `fetch`, which is what lets the tests run
 * under Node with no network at all.
 *
 * The plugin's `system` dependency — the helper process behind the operating
 * system's own voices — is gone for good rather than pending: under ADR 0014
 * the OS voices are a native module, not a member of this layer.
 */
export type ProviderDeps = {
  fetch: typeof fetch;
};

/**
 * The settings these providers read, and nothing else.
 *
 * The plugin imported its whole `Settings` type here. That type describes a
 * preferences pane and reaches `createZoteroPrefs()`, which touches the Zotero
 * global: it erased at compile time because the import was type-only, and one
 * change to a value import would have pulled XPCOM into this directory without
 * the lint boundary noticing. So the shape is declared where it is used, by the
 * fields that are actually read.
 *
 * `headers` is the text the owner typed — `Name: value` pairs separated by `;`
 * or newlines — and is parsed by `core/headers.ts` on the way in, which is why
 * it is a string here and a record in the provider configs.
 */
export type ProviderSettings = {
  'openai-official': { apiKey: string; model: string; voices?: string };
  compatible: { baseURL: string; apiKey: string; model: string; voices?: string; headers?: string };
  speechify: { apiKey: string };
  /**
   * `freeOnly` is not optional and has no default here on purpose: a missing or
   * unknown `model` header makes Fish fall back to the **paid** model, so the
   * choice between `s2.1-pro-free` and `s2.1-pro` is the owner's money and is
   * always stated (ADR 0002). The three `include…` flags are Fish's own
   * "omitted means enabled", so a settings screen that does not offer them
   * still gets every source.
   */
  fish: { apiKey: string; freeOnly: boolean; voices?: string; includeOfficial?: boolean; includeOwn?: boolean; includeManual?: boolean };
  local: { engine: string; baseURL: string; headers?: string };
};

export function createProvider(id: ProviderId, settings: ProviderSettings, deps: ProviderDeps): TTSProvider {
  switch (id) {
    // The two sections that speak OpenAI's API, each with its own settings:
    // nothing typed for one is ever sent to the other
    case 'openai-official':
      return createOpenAIProvider(settings['openai-official'], { fetch: deps.fetch });

    case 'compatible':
      return createCompatibleProvider({ ...settings.compatible, headers: parseHeaderList(settings.compatible.headers) }, { fetch: deps.fetch });

    case 'speechify':
      return createSpeechifyProvider(settings.speechify, { fetch: deps.fetch });

    // The pasted model ids are a string here and a string in `FishConfig`; it is
    // `fishVoiceIds` that finds the ids inside whatever was pasted, so an empty
    // field is a field with no ids and not a special case.
    case 'fish':
      return createFishProvider({ ...settings.fish, voices: settings.fish.voices ?? '' }, { fetch: deps.fetch });

    case 'local': {
      const engine = getLocalEngine(settings.local.engine);
      if (!engine) {
        throw new SynthesisError('unknown', `Unknown local engine: ${settings.local.engine}`);
      }
      return engine.create(settings.local.baseURL, { fetch: deps.fetch, headers: parseHeaderList(settings.local.headers) });
    }
  }
}
