/**
 * The Voices the owner can actually choose from (ADR 0020).
 *
 * Two questions, and they are different enough to be two halves of this file.
 *
 * **Which Providers are set up**, which is a question for the Keychain and the
 * settings and costs nothing. `configuredProviders` decides it; this looks up the
 * one thing that function cannot, which is whether a key is saved for each
 * Provider rather than for the one in use. Five lookups, at mount and again
 * whenever a credential is written.
 *
 * **What Voices each one has**, which is a question for the server and costs a
 * request against the owner's own account. So it is asked when the owner opens the
 * list for a Provider and **cached for the session** — never re-fetched per open,
 * because Speechify paginates its list and Fish merges up to three sources
 * (ADR 0020). It is never asked on the reader's behalf in the background:
 * philosophy rule 4 is no silent spending, and a list fetched because a screen
 * appeared is a request the owner did not make.
 *
 * The credentials pass through `providerSettings` and nowhere else (ADR 0002).
 * Nothing here holds a key, and the only thing that reaches React state is whether
 * there is one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createProvider } from '../core/providers/factory';
import type { ProviderId, VoiceInfo } from '../core/providers/types';
import { withTimeout } from '../core/timeout';
import { readGatewayHeaders, readProviderKey } from '../keys/store';

import { useShell } from './routes';
import {
  configuredProviders,
  headersAreOffered,
  keyIsOffered,
  PROVIDER_LABELS,
  PROVIDER_ORDER,
  providerDeps,
  providerSettings,
  type AppSettings,
} from './settings';

/** Philosophy rule 1: a request that never settles is a spinner that never stops. The same number the Provider screen uses. */
const ASK_TIMEOUT_MS = 15_000;

export interface VoiceLists {
  /**
   * The Providers the owner has set up, in `PROVIDER_ORDER`, or **null while the
   * Keychain is still being asked**.
   *
   * Null is not the empty list and the sheet must not draw it as one: "no Provider
   * is configured" is a claim, and making it before the Keychain has answered is
   * the kind of confidently wrong statement this project treats as a defect.
   */
  configured: readonly ProviderId[] | null;
  /** What the Keychain refused to answer for, in its own words. Shown, never folded into "no key" (`src/keys/refusal.ts`). */
  refusals: readonly string[];
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
  const { secretsWritten } = useShell();
  /** Which Providers the Keychain holds a key for, and what it refused to say. Null until it has answered. */
  const [keys, setKeys] = useState<{ held: ReadonlySet<ProviderId>; refusals: readonly string[] } | null>(null);
  const [lists, setLists] = useState<Readonly<Partial<Record<ProviderId, readonly VoiceInfo[]>>>>({});
  const [asking, setAsking] = useState<ProviderId | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all(
      PROVIDER_ORDER.map(async (provider) => {
        if (!keyIsOffered(provider)) return { provider, held: false, refusal: null };
        const lookup = await readProviderKey(provider);
        return {
          provider,
          held: lookup.outcome === 'found',
          // A refusal is not an absence. It is the one the screen has to show, because
          // it is what happens with the device locked and it looks exactly like "you
          // have not entered a key" if it is flattened into one.
          refusal:
            lookup.outcome === 'refused'
              ? `The Keychain would not say whether ${PROVIDER_LABELS[provider]} has a key: ${lookup.refusal.message}`
              : null,
        };
      }),
    ).then((answers) => {
      if (!alive) return;
      setKeys({
        held: new Set(answers.filter((one) => one.held).map((one) => one.provider)),
        refusals: answers.map((one) => one.refusal).filter((one): one is string => one !== null),
      });
    });
    return () => {
      alive = false;
    };
    // `secretsWritten` and not the settings: a key being saved is the only thing that
    // changes this answer, and it happens on another screen (`routes.ts` says why).
  }, [secretsWritten]);

  /**
   * The settings as they are, for the ask below, which runs after an await and must
   * not read a value from the render that started it.
   */
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const configured = useMemo(
    () => (keys ? configuredProviders(settings, (provider) => keys.held.has(provider)) : null),
    [keys, settings],
  );

  const voicesOf = useCallback((provider: ProviderId) => lists[provider] ?? null, [lists]);

  const ask = useCallback(
    (provider: ProviderId) => {
      if (asking) return;
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
          setLists((was) => ({ ...was, [provider]: listed }));
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

  return { configured, refusals: keys?.refusals ?? [], voicesOf, asking, note, ask };
}
