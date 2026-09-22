/** Configure while disabled; enablement locks fields. Credentials autosave only to the Keychain. */
import { useCallback, useLayoutEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { ProviderId } from '../core/providers/types';
import { Action, Field, HeaderButton, INK, Note, SwitchRow } from './controls';
import type { ScreenProps } from './routes';
import { useShell } from './routes';
import { headersAreOffered, keyIsOffered, PROVIDER_LABELS } from './settings';
import { useProviderKey, useGatewayHeaders, type ProviderSecret } from './use-provider-secrets';
import { useSecretInput } from './use-secret-input';
import { useProviderConnection } from './use-provider-connection';

function SecretField({ id, label, secret, locked, help }: {
  id: ProviderId; label: string; secret: ProviderSecret; locked: boolean; help?: string;
}) {
  const input = useSecretInput(id, label, secret, locked);
  const [revealed, setRevealed] = useState(false);
  useFocusEffect(useCallback(() => () => setRevealed(false), []));
  return <View style={styles.field}>
    <Field label={label} value={input.value} onChangeText={input.change} secure={!revealed} editable={input.editable}
      accessory={label === 'API key' ? <HeaderButton label={revealed ? 'Hide API key' : 'Show API key'}
        icon={revealed ? 'eyeOff' : 'eye'} onPress={() => setRevealed((previous) => !previous)} /> : undefined}
      placeholder="Not set" help={help} />
    {input.error ? <Note attention>{input.error}</Note> : null}
  </View>;
}
export function ProviderScreen({ route, navigation }: ScreenProps<'Provider'>) {
  const { id } = route.params;
  const { settings, setSettings } = useShell();
  const connection = useProviderConnection(id);
  const key = useProviderKey(id), headers = useGatewayHeaders(id);
  const locked = connection.enabled || connection.busy;
  useLayoutEffect(() => {
    navigation.setOptions({ title: PROVIDER_LABELS[id], headerBackTitle: 'Providers', headerRight: undefined });
  }, [id, navigation]);
  const model = id === 'openai-official' ? settings.openai.model : settings.compatible.model;
  return <ScrollView style={styles.screen} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
    <View style={styles.enable}>
      <View style={styles.enableText}>
        <Text style={styles.enableLabel}>{connection.busy ? 'Testing…' : connection.enabled ? 'Enabled' : 'Disabled'}</Text>
        {connection.enabled ? <Note>Disable to edit.</Note> : null}
      </View>
      <Switch accessibilityLabel={`Enable ${PROVIDER_LABELS[id]}`} value={connection.enabled}
        style={styles.switch} disabled={connection.busy} onValueChange={connection.toggle} />
    </View>
    {id === 'local' || id === 'compatible' ? <Field label="Address" value={settings[id].baseURL}
      onChangeText={(baseURL) => setSettings((previous) => ({ ...previous, [id]: { ...previous[id], baseURL } }))}
      editable={!locked} keyboard="url" placeholder="https://" /> : null}
    {keyIsOffered(id) ? <SecretField key={`${id}:key`} id={id} label="API key" secret={key} locked={locked} /> : null}
    {id === 'azure' ? <Field label="Region" value={settings.azure.region} editable={!locked} placeholder="eastasia"
      onChangeText={(region) => setSettings((previous) => ({ ...previous, azure: { region } }))} /> : null}
    {id === 'openai-official' || id === 'compatible' ? <Field label="Model" value={model} editable={!locked}
      placeholder={id === 'openai-official' ? 'gpt-4o-mini-tts' : 'tts-1'}
      onChangeText={(next) => setSettings((previous) => id === 'openai-official'
        ? { ...previous, openai: { model: next } } : { ...previous, compatible: { ...previous.compatible, model: next } })} /> : null}
    {headersAreOffered(id) ? <SecretField key={`${id}:headers`} id={id} label="Extra headers" secret={headers} locked={locked}
      help="Optional. Enter Name: value pairs separated by semicolons. Sent only to this provider’s address." /> : null}
    {id === 'fish' ? <View style={styles.sources}>
      <Text style={styles.sourceHeading}>Voice sources</Text>
      {([['includeOfficial', 'Official voices'], ['includeOwn', 'Your voices'], ['includeManual', 'Manual voices']] as const).map(([source, label]) =>
        <SwitchRow key={source} label={label} value={settings.fish[source]} disabled={locked}
          onChange={() => setSettings((previous) => ({ ...previous, fish: { ...previous.fish, [source]: !previous.fish[source] } }))} />)}
      {settings.fish.includeManual ? <Field label="Voices" value={settings.fish.voices} editable={!locked}
        placeholder="Model IDs or links" help="Paste voice model IDs or links, separated by spaces or commas."
        onChangeText={(voices) => setSettings((previous) => ({ ...previous, fish: { ...previous.fish, voices } }))} /> : null}
    </View> : null}
    <View style={styles.actions}><Action label={connection.busy ? 'Testing…' : 'Test connection'}
      disabled={connection.busy} onPress={() => void connection.test()} /></View>
    {connection.note ? <Note attention={connection.note !== 'Connection successful'}>{connection.note}</Note> : null}
  </ScrollView>;
}
const styles = StyleSheet.create({
  screen: { backgroundColor: INK.page, flex: 1 },
  body: { padding: 20, paddingBottom: 64, gap: 20 },
  enable: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  enableLabel: { color: INK.text, fontSize: 17 },
  enableText: { gap: 4, flex: 1 },
  field: { gap: 4 },
  actions: { flexDirection: 'row' },
  sources: { gap: 4 },
  sourceHeading: { color: INK.text, fontSize: 14, fontWeight: '600', marginBottom: 6 },
  switch: { alignSelf: 'center' },
  locked: { opacity: 0.5 },
});
