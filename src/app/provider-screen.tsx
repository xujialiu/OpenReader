/**
 * Configure while disabled; enablement locks fields. Credentials autosave only to the Keychain.
 *
 * Laid out as design 0041 lays out every setting that freezes others: the switch
 * first, its label fixed at `Enabled` with what is happening now on the line
 * under it, `Test connection` beside it in the same card, and the outcome of
 * either under that card. Enabling and testing end in the same result, so the
 * result sits directly beneath both. The fields follow as rows of their own card,
 * and then Downloads (#64), which the switch does not freeze.
 */
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { ProviderId } from '../core/providers/types';
import { ActionRow, FieldRow, Footnote, HeaderButton, SettingsGroup, SettingsPage, SwitchRow, TextRow, ValueRow, type Choice } from './controls';
import type { ScreenProps } from './routes';
import { useShell } from './routes';
import { headersAreOffered, keyIsOffered, PROVIDER_LABELS, SENTENCES_AT_ONCE } from './settings';
import { useProviderKey, useGatewayHeaders, type ProviderSecret } from './use-provider-secrets';
import { useSecretInput } from './use-secret-input';
import { useProviderConnection } from './use-provider-connection';

/** The Sentences at once menu (#64): the bare number, as the pause menus show theirs. */
const AT_ONCE_CHOICES: readonly Choice<number>[] = SENTENCES_AT_ONCE.map((value) => ({ value, label: String(value) }));

/**
 * A credential as a field row. Its error, if saving or reading it failed, is
 * handed up rather than drawn here: it is said under the fields' card, named
 * after the field it is about (design 0041).
 */
function SecretField({ id, label, secret, locked, placeholder, onError }: {
  id: ProviderId; label: string; secret: ProviderSecret; locked: boolean; placeholder: string;
  onError(label: string, error: string | null): void;
}) {
  const input = useSecretInput(id, label, secret, locked);
  const [revealed, setRevealed] = useState(false);
  useFocusEffect(useCallback(() => () => setRevealed(false), []));
  useEffect(() => { onError(label, input.error); }, [label, input.error, onError]);
  return <FieldRow label={label} value={input.value} onChangeText={input.change} secure={!revealed} editable={input.editable}
    placeholder={placeholder}
    accessory={label === 'API key' ? <HeaderButton label={revealed ? 'Hide API key' : 'Show API key'}
      icon={revealed ? 'eyeOff' : 'eye'} onPress={() => setRevealed((previous) => !previous)} /> : undefined} />;
}

export function ProviderScreen({ route, navigation }: ScreenProps<'Provider'>) {
  const { id } = route.params;
  const { settings, setSettings } = useShell();
  const connection = useProviderConnection(id);
  const key = useProviderKey(id), headers = useGatewayHeaders(id);
  const locked = connection.enabled || connection.busy;
  const [secretErrors, setSecretErrors] = useState<Readonly<Record<string, string | null>>>({});
  const reportSecretError = useCallback((label: string, error: string | null) => {
    setSecretErrors((was) => (was[label] ?? null) === error ? was : { ...was, [label]: error });
  }, []);
  useLayoutEffect(() => {
    navigation.setOptions({ title: PROVIDER_LABELS[id], headerBackTitle: 'Providers', headerRight: undefined });
  }, [id, navigation]);
  const model = id === 'openai-official' ? settings.openai.model : settings.compatible.model;
  const failures = Object.entries(secretErrors).flatMap(([label, error]) => error ? [`${label}: ${error}`] : []);
  return <SettingsPage>
    <SettingsGroup footer={connection.note
      ? <Footnote attention={connection.note !== 'Connection successful'}>{connection.note}</Footnote> : undefined}>
      <SwitchRow label="Enabled" accessibilityLabel={`Enable ${PROVIDER_LABELS[id]}`} value={connection.enabled}
        disabled={connection.busy} onChange={connection.toggle}
        note={connection.busy ? 'Testing…' : connection.enabled ? 'Turn off to edit.' : undefined} />
      <ActionRow label="Test connection" disabled={connection.busy} onPress={() => void connection.test()} />
    </SettingsGroup>
    <SettingsGroup footer={failures.length ? <>{failures.map((line) => <Footnote key={line} attention>{line}</Footnote>)}</> : undefined}>
      {id === 'local' || id === 'compatible' ? <FieldRow label="Address" value={settings[id].baseURL}
        onChangeText={(baseURL) => setSettings((previous) => ({ ...previous, [id]: { ...previous[id], baseURL } }))}
        editable={!locked} keyboard="url" placeholder="https://" /> : null}
      {keyIsOffered(id) ? <SecretField key={`${id}:key`} id={id} label="API key" secret={key} locked={locked}
        placeholder="Not set" onError={reportSecretError} /> : null}
      {id === 'azure' ? <FieldRow label="Region" value={settings.azure.region} editable={!locked} placeholder="eastasia"
        onChangeText={(region) => setSettings((previous) => ({ ...previous, azure: { region } }))} /> : null}
      {id === 'openai-official' || id === 'compatible' ? <FieldRow label="Model" value={model} editable={!locked}
        placeholder={id === 'openai-official' ? 'gpt-4o-mini-tts' : 'tts-1'}
        onChangeText={(next) => setSettings((previous) => id === 'openai-official'
          ? { ...previous, openai: { model: next } } : { ...previous, compatible: { ...previous.compatible, model: next } })} /> : null}
      {headersAreOffered(id) ? <SecretField key={`${id}:headers`} id={id} label="Extra headers" secret={headers} locked={locked}
        placeholder="Name: value; Name: value" onError={reportSecretError} /> : null}
    </SettingsGroup>
    {/* Never frozen: it changes how fast a download goes and nothing about the
        connection the switch above checked. */}
    <SettingsGroup title="Downloads">
      <ValueRow label="Sentences at once" choices={AT_ONCE_CHOICES} chosen={settings.sentencesAtOnce[id]}
        onChoose={(count) => setSettings((previous) => ({ ...previous, sentencesAtOnce: { ...previous.sentencesAtOnce, [id]: count } }))} />
    </SettingsGroup>
    {id === 'fish' ? <SettingsGroup title="Voice sources">
      {([['includeOfficial', 'Official voices'], ['includeOwn', 'Your voices'], ['includeManual', 'Manual voices']] as const).map(([source, label]) =>
        <SwitchRow key={source} label={label} value={settings.fish[source]} disabled={locked}
          onChange={() => setSettings((previous) => ({ ...previous, fish: { ...previous.fish, [source]: !previous.fish[source] } }))} />)}
      {settings.fish.includeManual ? <TextRow label="Voices" value={settings.fish.voices} editable={!locked}
        placeholder="IDs or links, separated by spaces or commas"
        onChangeText={(voices) => setSettings((previous) => ({ ...previous, fish: { ...previous.fish, voices } }))} /> : null}
    </SettingsGroup> : null}
  </SettingsPage>;
}
