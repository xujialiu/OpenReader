/**
 * **Settings**: which **Provider**, its key, its address, and the **Voice**.
 *
 * A screen, not a sheet (ADR 0019). What is here is what the sheet held, moved
 * across and given the platform's navigation bar; the split ADR 0019 describes —
 * _General_ for what is true of the whole app, _Providers_ listing the voices
 * available and opening one at a time so that a Provider's key, model and Voice
 * are on a screen of their own — is the next piece of work and is deliberately
 * not half-built here. The seam it needs is two more routes in `routes.ts` and
 * this file split along the `Section` boundaries it already has.
 *
 * ## The draft is committed by leaving
 *
 * The sheet had a Done button and the screen has a back arrow, and those are not
 * the same thing: a back gesture that discarded what the owner typed would be a
 * new way to lose an API key. So the draft is written back when the screen goes
 * away, whichever way it went away. It is a draft rather than the live settings
 * for a reason that is not tidiness — `use-reading.ts` disposes the engine and
 * the audio session whenever `engineIdentity(settings)` changes, so editing the
 * address live would tear the player down once per keystroke.
 *
 * ## What is deliberately not here (ADR 0017)
 *
 * There is **no tappable route to any Provider's signup, pricing or key
 * console**, and no pricing at all. Every instruction below is static text, which
 * is exactly what the one rejection in this category with a documented resolution
 * asked for: the directive was to remove the "Get API Key" link from the binary,
 * and the app that complied kept its key field, its save action, its provider
 * picker, its model picker and every bit of the plumbing. **The credential field
 * was never the problem.** So the fields are all here and the links are all
 * absent — including `LOCAL_ENGINES[].site.url`, which the desktop plugin opens
 * and this app only ever shows as text.
 *
 * It will look like an omission to anyone who later tries to improve onboarding.
 * ADR 0017 says in as many words that it is not.
 *
 * ## What it asks the server, and why that is a button
 *
 * The Voice list and the model list are the server's own, so they are fetched
 * rather than hardcoded — and behind a button rather than on open, because
 * every request is against the owner's own account (ADR 0002, philosophy rule 4:
 * no silent spending). Listing voices is also the cheapest honest check that an
 * address and a key work together at all.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { APP_NAME } from '../../app-name';
import { createProvider } from '../core/providers/factory';
import { LOCAL_ENGINES } from '../core/providers/local/registry';
import type { ProviderId, VoiceInfo } from '../core/providers/types';
import { withTimeout } from '../core/timeout';

import { Action, Choice, Field, INK, Note, Section } from './controls';
import {
  keyIsOffered,
  keyIsRequired,
  PROVIDER_LABELS,
  PROVIDER_ORDER,
  providerDeps,
  providerSettings,
  type AppSettings,
} from './settings';
import { useShell } from './routes';
import { useProviderKey, type KeyPresence } from './use-provider-key';

/** Philosophy rule 1: a request that never settles is a spinner that never stops. */
const ASK_TIMEOUT_MS = 15_000;

function describe(problem: unknown): string {
  return problem instanceof Error ? problem.message : String(problem);
}

function keyLine(presence: KeyPresence, provider: ProviderId): string {
  switch (presence.state) {
    case 'unknown':
      return 'Looking in the Keychain…';
    case 'not-offered':
      return 'This Provider has no API key.';
    case 'held':
      return `A key is in this device's Keychain for ${PROVIDER_LABELS[provider]}.`;
    case 'absent':
      return keyIsRequired(provider) ? 'No key saved, so nothing can be spoken yet.' : 'No key saved.';
    case 'refused':
      return `The Keychain would not say whether a key is saved: ${presence.message}`;
  }
}

export function SettingsScreen() {
  const { settings, setSettings } = useShell();
  const [draft, setDraft] = useState<AppSettings>(settings);

  /**
   * What the owner typed, written back when they leave.
   *
   * Through refs, because this runs in an unmount cleanup and a cleanup closes
   * over the render it was created in — the draft from the first render, which
   * is the settings unchanged. The comparison is by `JSON.stringify` and that is
   * enough here: `AppSettings` is three nested objects of strings and numbers
   * with a fixed key order, and the only thing the comparison decides is whether
   * to skip a `setState` that would re-render the Reader underneath for nothing.
   */
  const draftRef = useRef(draft);
  const settingsRef = useRef(settings);
  const commitRef = useRef(setSettings);
  useEffect(() => {
    draftRef.current = draft;
    settingsRef.current = settings;
    commitRef.current = setSettings;
  }, [draft, settings, setSettings]);

  useEffect(
    () => () => {
      if (JSON.stringify(draftRef.current) !== JSON.stringify(settingsRef.current)) commitRef.current(draftRef.current);
    },
    [],
  );

  const key = useProviderKey(draft.provider);
  /** What is being typed into the key field. It goes to the Keychain and is not kept here after that. */
  const [typing, setTyping] = useState('');
  const [voices, setVoices] = useState<readonly VoiceInfo[] | null>(null);
  const [models, setModels] = useState<readonly string[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  /** A Voice belongs to exactly one Provider (CONTEXT.md), so choosing another Provider gives up the Voice with it. */
  const chooseProvider = useCallback((provider: ProviderId) => {
    setVoices(null);
    setModels(null);
    setTyping('');
    setNote(null);
    setDraft((was) => ({ ...was, provider, voice: '' }));
  }, []);

  const chooseEngine = useCallback((engine: string) => {
    const adapter = LOCAL_ENGINES.find((candidate) => candidate.id === engine);
    setVoices(null);
    setNote(null);
    setDraft((was) => ({
      ...was,
      voice: '',
      local: { engine, baseURL: adapter ? adapter.defaultBaseURL : was.local.baseURL },
    }));
  }, []);

  const saveKey = useCallback(async () => {
    const refusal = await key.save(typing);
    setNote(refusal);
    if (!refusal) setTyping('');
  }, [key, typing]);

  const forgetKey = useCallback(async () => {
    setNote(await key.forget());
  }, [key]);

  /** The server's own Voices, and its models where it publishes them. */
  const ask = useCallback(async () => {
    setAsking(true);
    setNote(null);
    try {
      await key.withKey(async (held) => {
        const provider = createProvider(draft.provider, providerSettings(draft, held), providerDeps);
        const label = PROVIDER_LABELS[draft.provider];
        const abort = new AbortController();
        const listed = await withTimeout(
          provider.listVoices({ signal: abort.signal }),
          ASK_TIMEOUT_MS,
          () => new Error(`${label} did not answer within ${ASK_TIMEOUT_MS / 1000} seconds.`),
          () => abort.abort(),
        );
        setVoices(listed);
        if (listed.length === 0) setNote(`${label} answered, and published no Voices.`);

        // Not every OpenAI-compatible server has a model list, and one that has
        // none is not a failure — so this cannot fail the Voice list with it.
        if (provider.listModels) {
          try {
            setModels(
              await withTimeout(provider.listModels(), ASK_TIMEOUT_MS, () => new Error(`${label} did not answer with a model list in time.`)),
            );
          } catch (problem) {
            setNote(`The Voices are listed. The models are not: ${describe(problem)}`);
          }
        }
      });
    } catch (problem) {
      setNote(describe(problem));
    } finally {
      setAsking(false);
    }
  }, [draft, key]);

  const voiceLabels = new Map((voices ?? []).map((voice) => [voice.id, `${voice.label} · ${voice.locale}`]));

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Section title="Provider">
          <Choice options={PROVIDER_ORDER} value={draft.provider} onChange={chooseProvider} labelOf={(id) => PROVIDER_LABELS[id]} />
          <Note>
            No vendor is required or hard-coded, and there is no server of {APP_NAME}&apos;s: the key you save is sent to
            the Provider it belongs to and to nowhere else.
          </Note>
        </Section>

        {draft.provider === 'local' ? (
          <Section title="Your server">
            <Choice
              options={LOCAL_ENGINES.map((engine) => engine.id)}
              value={draft.local.engine}
              onChange={chooseEngine}
              labelOf={(id) => LOCAL_ENGINES.find((engine) => engine.id === id)?.label ?? id}
            />
            <Field
              label="Address"
              value={draft.local.baseURL}
              onChangeText={(baseURL) => setDraft((was) => ({ ...was, local: { ...was.local, baseURL } }))}
              placeholder={LOCAL_ENGINES[0].defaultBaseURL}
              keyboard="url"
              hint={localHint()}
            />
          </Section>
        ) : null}

        {draft.provider === 'compatible' ? (
          <Section title="The server">
            <Field
              label="Address"
              value={draft.compatible.baseURL}
              onChangeText={(baseURL) => setDraft((was) => ({ ...was, compatible: { ...was.compatible, baseURL } }))}
              placeholder="https://"
              keyboard="url"
              hint="Any server that speaks OpenAI's API at this address: a proxy, a hosted service, or one of your own."
            />
            <Field
              label="Model"
              value={draft.compatible.model}
              onChangeText={(model) => setDraft((was) => ({ ...was, compatible: { ...was.compatible, model } }))}
              placeholder="the model the server names"
              hint="Ask the server below and its own list appears here."
            />
            {models && models.length > 0 ? (
              <Choice
                options={models}
                value={draft.compatible.model}
                onChange={(model) => setDraft((was) => ({ ...was, compatible: { ...was.compatible, model } }))}
              />
            ) : null}
          </Section>
        ) : null}

        {draft.provider === 'openai-official' ? (
          <Section title="Model">
            <Field
              label="Model"
              value={draft.openai.model}
              onChangeText={(model) => setDraft((was) => ({ ...was, openai: { model } }))}
              placeholder="a speech model"
              hint="OpenAI publishes the list; ask the server below rather than have the app guess at one."
            />
            {models && models.length > 0 ? (
              <Choice options={models} value={draft.openai.model} onChange={(model) => setDraft((was) => ({ ...was, openai: { model } }))} />
            ) : null}
          </Section>
        ) : null}

        {keyIsOffered(draft.provider) ? (
          <Section title="API key">
            <Field
              label={keyIsRequired(draft.provider) ? 'Key' : 'Key, if the server wants one'}
              value={typing}
              onChangeText={setTyping}
              placeholder={key.presence.state === 'held' ? 'a key is saved; type one to replace it' : 'paste it here'}
              secure
              hint={keyHint(draft.provider)}
            />
            <View style={styles.row}>
              <Action label="Save" onPress={() => void saveKey()} disabled={typing.trim().length === 0} />
              <Action label="Forget" onPress={() => void forgetKey()} disabled={key.presence.state !== 'held'} />
            </View>
            <Note attention={key.presence.state === 'refused' || (key.presence.state === 'absent' && keyIsRequired(draft.provider))}>
              {keyLine(key.presence, draft.provider)}
            </Note>
            <Note>
              A key stays in the Keychain when the app is deleted, so Forget is the only thing that removes it. It is
              stored so that it can still be read while the screen is locked, which is when a backgrounded reader needs
              it.
            </Note>
          </Section>
        ) : null}

        <Section title="Voice">
          <View style={styles.row}>
            <Action label={asking ? 'Asking…' : 'Ask the server'} onPress={() => void ask()} disabled={asking} />
          </View>
          {voices === null ? (
            <Note>
              {draft.voice
                ? `Reading in ${draft.voice}. Ask the server for the list to change it.`
                : 'Nothing can be spoken without a Voice. Ask the server for the ones it offers.'}
            </Note>
          ) : (
            <Choice
              options={voices.map((voice) => voice.id)}
              value={draft.voice}
              onChange={(voice) => setDraft((was) => ({ ...was, voice }))}
              labelOf={(id) => voiceLabels.get(id) ?? id}
            />
          )}
          <Note>
            One Voice, and the document being read uses it. ADR 0010 gives each document a Voice of its own with this as
            the default, and that half waits on there being somewhere to remember a document — so this is the Voice, and
            changing it changes what is being read now.
          </Note>
        </Section>

        {note ? <Note attention>{note}</Note> : null}

        <Note>
          Everything here but the key is kept for as long as the app is running. Settings are shared between the
          owner&apos;s devices through their own Sync Folder, and that is not built yet; inventing a private store now
          would only be something for it to argue with later.
        </Note>
      </ScrollView>
    </View>
  );
}

/**
 * How to get a key, as static text. No address, no link, no price — ADR 0017,
 * which puts the walkthrough in the repository rather than in the binary.
 */
function keyHint(provider: ProviderId): string {
  if (provider === 'compatible') {
    return 'May be left empty: the request then goes out without an Authorization header, and a server that wanted one answers 401.';
  }
  return `Create a key in your own ${PROVIDER_LABELS[provider]} account and paste it here. It is stored in this device's Keychain and sent only to ${PROVIDER_LABELS[provider]}. The walkthrough lives in the project's repository rather than in the app.`;
}

/** The one configuration that can be checked with no credentials at all (ADR 0014). */
function localHint(): string {
  const engine = LOCAL_ENGINES[0];
  const site = engine.site ? ` (${engine.site.host})` : '';
  return `${engine.label}${site} runs on a machine of your own. It needs no API key and it reports Word Timings, which makes it the one setup that can be read aloud without credentials. The address it prints when it starts is already filled in.`;
}

const styles = StyleSheet.create({
  body: { gap: 28, paddingBottom: 64, paddingHorizontal: 20, paddingTop: 12 },
  row: { flexDirection: 'row', gap: 12 },
  screen: { backgroundColor: INK.page, flex: 1 },
  scroll: { flex: 1 },
});
