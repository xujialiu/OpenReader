/** Configure while disabled; enablement locks fields. Credentials autosave only to the Keychain. */
import { useLayoutEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { ProviderId } from '../core/providers/types';
import { Action, Field, HeaderButton, INK, Note } from './controls';
import type { ScreenProps } from './routes';
import { useShell } from './routes';
import { headersAreOffered, keyIsOffered, PROVIDER_LABELS } from './settings';
import { useProviderKey, useGatewayHeaders, type ProviderSecret } from './use-provider-secrets';
import { saveProviderEdit, flushProviderEdits } from './provider-edits';
import { useProviderConnection } from './use-provider-connection';

function SecretField({ id, label, secret, locked, help }: {
  id: ProviderId; label: string; secret: ProviderSecret; locked: boolean; help: string;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const change = (next: string) => {
    if (locked) return;
    setValue(next);
    void saveProviderEdit(id, label, () => next.trim() ? secret.save(next) : secret.forget())
      .then(() => flushProviderEdits(id)).then(() => setError(null), () => setError('Could not save. Try again.'));
  };
  return <View style={styles.field}>
    <Field label={label} value={value} onChangeText={change} secure editable={!locked}
      placeholder={secret.presence.state === 'held' ? '••••••••' : 'Not set'} help={help} />
    {!locked && secret.presence.state === 'held' ? <Pressable accessibilityRole="button"
      accessibilityLabel={`Remove ${label}`} onPress={() => change('')} style={styles.remove}>
      <Text style={styles.removeLabel}>Remove</Text>
    </Pressable> : null}
    {error ? <Note attention>{error}</Note> : null}
    {secret.presence.state === 'refused' ? <Note attention>Credential unavailable. Unlock the device and try again.</Note> : null}
  </View>;
}
function Source({ label, checked, disabled, onChange }: {
  label: string; checked: boolean; disabled: boolean; onChange(): void;
}) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label}
    accessibilityState={{ checked, disabled }} disabled={disabled} onPress={onChange}
    style={[styles.source, disabled && styles.locked]}>
    <View style={[styles.checkbox, checked && styles.checked]}>
      {checked ? <Text style={styles.checkmark}>✓</Text> : null}
    </View><Text style={styles.sourceLabel}>{label}</Text>
  </Pressable>;
}
export function ProviderScreen({ route, navigation }: ScreenProps<'Provider'>) {
  const { id } = route.params;
  const { settings, setSettings } = useShell();
  const connection = useProviderConnection(id);
  const key = useProviderKey(id), headers = useGatewayHeaders(id);
  const locked = connection.enabled || connection.busy;
  useLayoutEffect(() => {
    navigation.setOptions({ title: PROVIDER_LABELS[id], headerBackTitle: 'Providers',
      headerRight: () => <HeaderButton title="?" label="Provider help" onPress={() => Alert.alert('Provider setup',
        'Changes save automatically. Enable tests the connection and locks the fields. Disable to edit again. Choose voices in the player.')} /> });
  }, [id, navigation]);
  const model = id === 'openai-official' ? settings.openai.model : settings.compatible.model;
  return <ScrollView style={styles.screen} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
    <View style={styles.enable}>
      <Text style={styles.enableLabel}>{connection.busy ? 'Testing…' : connection.enabled ? 'Enabled' : 'Disabled'}</Text>
      <Switch accessibilityLabel={`Enable ${PROVIDER_LABELS[id]}`} value={connection.enabled}
        disabled={connection.busy} onValueChange={connection.toggle} />
    </View>
    {id === 'local' || id === 'compatible' ? <Field label="Address" value={settings[id].baseURL}
      onChangeText={(baseURL) => setSettings((previous) => ({ ...previous, [id]: { ...previous[id], baseURL } }))}
      editable={!locked} keyboard="url" placeholder="https://" /> : null}
    {keyIsOffered(id) ? <SecretField id={id} label="API key" secret={key} locked={locked}
      help={id === 'compatible' ? 'Optional if your server does not require a key.' : 'Enter a key from your provider account. It stays in this device’s secure storage.'} /> : null}
    {id === 'openai-official' || id === 'compatible' ? <Field label="Model" value={model} editable={!locked}
      placeholder={id === 'openai-official' ? 'gpt-4o-mini-tts' : 'tts-1'}
      onChangeText={(next) => setSettings((previous) => id === 'openai-official'
        ? { ...previous, openai: { model: next } } : { ...previous, compatible: { ...previous.compatible, model: next } })} /> : null}
    {headersAreOffered(id) ? <SecretField id={id} label="Extra headers" secret={headers} locked={locked}
      help="Optional. Enter Name: value pairs separated by semicolons. Sent only to this provider’s address." /> : null}
    {id === 'fish' ? <View style={styles.sources}>
      <Text style={styles.sourceHeading}>Voice sources</Text>
      {([['includeOfficial', 'Official voices'], ['includeOwn', 'Your voices'], ['includeManual', 'Manual voices']] as const).map(([source, label]) =>
        <Source key={source} label={label} checked={settings.fish[source]} disabled={locked}
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
  field: { gap: 4 },
  remove: { alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center' },
  removeLabel: { color: INK.quiet, fontSize: 14 },
  actions: { flexDirection: 'row' },
  sources: { gap: 4 },
  sourceHeading: { color: INK.text, fontSize: 14, fontWeight: '600', marginBottom: 6 },
  source: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 44 },
  sourceLabel: { color: INK.text, fontSize: 16 },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 1, borderColor: INK.quiet, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: INK.text, borderColor: INK.text },
  checkmark: { color: INK.page, fontWeight: '700', fontSize: 16 },
  locked: { opacity: 0.5 },
});
