import { createOpenAICompatibleProvider } from './openai-compatible';
import type { TTSProvider } from './types';

/**
 * The OpenAI section: OpenAI itself and nothing else. The address is fixed — a
 * proxy or a mirror is an OpenAI Compatible server (`compatible.ts`) — a key is
 * required, and the voices are OpenAI's documented ones unless the owner types
 * newer names. Its id is `openai-official`, never `openai`.
 */

export const OPENAI_URL = 'https://api.openai.com';

/**
 * OpenAI's own voices, from its documentation. The API has no endpoint that
 * lists them, so this is the last resort when the server publishes no voice
 * list and the owner has typed none.
 */
export const OPENAI_DEFAULT_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
] as const;

export type OpenAIConfig = {
  apiKey: string;
  model: string;
  /** Comma-separated voice ids to offer; empty means OpenAI's documented voices. */
  voices?: string;
};

export function createOpenAIProvider(cfg: OpenAIConfig, deps: { fetch: typeof fetch }): TTSProvider {
  return createOpenAICompatibleProvider(
    {
      id: 'openai-official',
      label: 'OpenAI',
      baseURL: OPENAI_URL,
      apiKey: cfg.apiKey,
      model: cfg.model,
      voices: cfg.voices,
      keyRequired: true,
      route: 'speech',
      defaultVoices: OPENAI_DEFAULT_VOICES,
    },
    deps,
  );
}
