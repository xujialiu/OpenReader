import { parseHeaderList } from '../headers';
import { createCompatibleProvider } from './compatible';
import { SynthesisError } from './errors';
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
 * Everything the platform has to hand in. In the plugin this also carried
 * `getWebSocket` and `newRequestId` for Azure's WebSocket route and
 * `newAbortController` for Fish; none of those providers is here, so neither
 * are they. The one that is left is the one the whole of ADR 0013 rests on:
 * a provider never reaches for a global `fetch`, which is what lets the tests
 * run under Node with no network at all.
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

    case 'local': {
      const engine = getLocalEngine(settings.local.engine);
      if (!engine) {
        throw new SynthesisError('unknown', `Unknown local engine: ${settings.local.engine}`);
      }
      return engine.create(settings.local.baseURL, { fetch: deps.fetch, headers: parseHeaderList(settings.local.headers) });
    }
  }
}
