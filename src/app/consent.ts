/**
 * Who would receive the text, what the person is asked, and the app's one gate
 * (#109, ADR 0064; design 0064).
 *
 * The rule is `src/core/consent.ts`. This file names the recipients and words
 * the question, and it stays platform-free like `settings.ts`, so a test can
 * reach all of it. The alert itself is `consent-alert.ts`. The shell hands both
 * the question and where a yes is kept to `configureConsent` as the app starts.
 * Until it has, nothing is allowed and nobody is asked, so no text can leave
 * before there is a way to ask about it.
 *
 * ## Recipients
 *
 * - **A hosted Provider** is one recipient, whatever it is configured with.
 *   Another model, voice or Azure region still sends to the same company.
 * - **A server at an address the person typed**, for the OpenAI-compatible
 *   Provider or Kokoro-FastAPI, is known by that server's origin. Another server
 *   is somebody else, and is asked about afresh.
 * - **A lookup service** is one recipient per company. Youdao's dictionary page,
 *   its translation endpoint and its pronunciation audio all go to Youdao. A
 *   pronunciation plays only from a result the same service returned, so it
 *   needs no question of its own.
 */

import { SynthesisError } from '../core/providers/errors';
import type { ProviderId } from '../core/providers/types';
import { createConsentGate, type ConsentDeps, type ConsentGate } from '../core/consent';
import { originOf } from '../core/warm-connections';
import type { LookupDirection, LookupMode, TranslationService } from '../translation/settings';
import { PROVIDER_LABELS, type AppSettings } from './settings';

export interface Recipient {
  /** What a yes is kept under: `provider:fish`, `provider:compatible@http://192.168.1.20:8880`, `lookup:youdao`. */
  readonly key: string;
  /** Who, as the question names them: `Fish Audio`, `the server at 192.168.1.20:8880`, `Youdao`. */
  readonly name: string;
  /** A Document's text for reading aloud, or a selection for Word Lookup. */
  readonly sends: 'document' | 'selection';
  /** Whether the person's own key goes with the text, which the question then says. */
  readonly withKey: boolean;
  /**
   * A company with a privacy policy of its own, which the question names. A
   * server at an address the person typed has none the app could name.
   */
  readonly company: boolean;
}

/** The shape of every key `providerRecipient` and `lookupRecipient` make: `settings-storage.ts` keeps nothing else. */
export const CONSENT_KEY = /^(provider:[a-z-]+(@.+)?|lookup:[a-z-]+)$/;

/**
 * The recipient of a Provider's synthesis, as it is configured now.
 *
 * `hasKey` is whether a key was found for it. A hosted Provider cannot send
 * without one, and the OpenAI-compatible Provider may (`keyRequired: false`).
 */
export function providerRecipient(settings: AppSettings, provider: ProviderId, hasKey: boolean): Recipient {
  const withKey = hasKey && provider !== 'local';
  if (provider === 'compatible' || provider === 'local') {
    const typed = (provider === 'compatible' ? settings.compatible.baseURL : settings.local.baseURL).trim();
    const origin = originOf(typed);
    const host = origin ? origin.replace(/^[a-z]+:\/\//, '') : typed;
    return { key: `provider:${provider}@${origin ?? typed}`, name: `the server at ${host}`, sends: 'document', withKey, company: false };
  }
  return { key: `provider:${provider}`, name: PROVIDER_LABELS[provider], sends: 'document', withKey, company: true };
}

/**
 * The service a lookup goes to, as `lookup` in `src/translation/services.ts`
 * chooses it: the Free Dictionary API for English → English, Youdao for the
 * other two dictionaries, and the chosen service for a translation.
 */
export function lookupRecipient(request: { mode: LookupMode; direction: LookupDirection; service: TranslationService }, hasKey: boolean): Recipient {
  const service: 'free-dictionary' | TranslationService = request.mode === 'dictionary'
    ? request.direction === 'en-en' ? 'free-dictionary' : 'youdao'
    : request.service;
  const name = LOOKUP_NAMES[service];
  return { key: `lookup:${service}`, name, sends: 'selection', withKey: hasKey && service === 'microsoft', company: true };
}

/** The name each lookup service goes by in the app: the Service menu's words, and the Microsoft card's title. */
const LOOKUP_NAMES: Readonly<Record<'free-dictionary' | TranslationService, string>> = {
  'free-dictionary': 'the Free Dictionary API',
  youdao: 'Youdao',
  google: 'Google',
  microsoft: 'Microsoft Translator',
};

/**
 * The question, in the words the owner approved on 2026-09-30.
 *
 * "With your API key" is said only when a key goes with the text. The
 * company's privacy policy is named only when there is a company.
 */
export function consentQuestion(recipient: Recipient): { title: string; message: string } {
  const key = recipient.withKey ? ' with your API key' : '';
  if (recipient.sends === 'selection') {
    return {
      title: `Send selected text to ${recipient.name}?`,
      message: `Word Lookup sends the text you select to ${recipient.name}${key}.`,
    };
  }
  const policy = recipient.company ? ` ${recipient.name}'s privacy policy applies.` : '';
  return {
    title: `Send text to ${recipient.name}?`,
    message: `To read aloud, OpenReader sends your document's text to ${recipient.name}${key}.${policy}`,
  };
}

/** What a synthesis that was not allowed says where a download stops for it (`scheduler.ts`); a Reading says nothing. */
export function declinedSentence(recipient: Recipient): string {
  return `${capitalized(recipient.name)} was not allowed to receive this document's text.`;
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A synthesis the person did not allow: never sent, and nothing to tell a Reading's owner, who has just said no. */
export function isDeclined(problem: unknown): boolean {
  return problem instanceof SynthesisError && problem.kind === 'declined';
}

/** Before the shell has configured the gate: nothing is kept, and asking is a no. */
const UNCONFIGURED: ConsentDeps<Recipient> = {
  kept: () => false,
  keep: () => {},
  ask: async () => false,
};

let deps: ConsentDeps<Recipient> = UNCONFIGURED;

/** Where a yes is kept and how the question is put: the shell's settings and `askWithAlert`, set once as the app starts. */
export function configureConsent(next: ConsentDeps<Recipient>): void {
  deps = next;
}

/**
 * The gate every path that sends text goes through. It is one for the whole
 * app, so the Reading, a download and a lookup asking at once share one
 * question per recipient.
 */
export const consent: ConsentGate<Recipient> = createConsentGate<Recipient>({
  kept: (key) => deps.kept(key),
  keep: (key) => deps.keep(key),
  ask: (recipient) => deps.ask(recipient),
});
