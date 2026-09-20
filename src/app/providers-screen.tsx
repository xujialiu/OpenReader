import { ActivityIndicator, FlatList, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import type { ProviderId } from '../core/providers/types';
import { INK, Note } from './controls';
import { Icon } from './icon';
import type { ScreenProps } from './routes';
import { PROVIDER_LABELS, PROVIDER_ORDER } from './settings';
import { useProviderConnection } from './use-provider-connection';

function ProviderRow({ id, open }: { id: ProviderId; open(): void }) {
  const connection = useProviderConnection(id);
  return <View style={styles.item}>
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${PROVIDER_LABELS[id]} settings`}
        onPress={open} disabled={connection.busy} style={styles.name}>
        <Text style={styles.label}>{PROVIDER_LABELS[id]}</Text>
        <Icon name="next" size={16} color={INK.quiet} />
      </Pressable>
      {connection.busy ? <ActivityIndicator accessibilityLabel="Testing connection" /> : null}
      <Switch accessibilityLabel={`Enable ${PROVIDER_LABELS[id]}`} value={connection.enabled}
        disabled={connection.busy} onValueChange={connection.toggle} />
    </View>
    {connection.note && connection.note !== 'Connection successful' ? <Note attention>{connection.note}</Note> : null}
  </View>;
}
export function ProvidersScreen({ navigation }: ScreenProps<'Providers'>) {
  return <FlatList style={styles.screen} data={PROVIDER_ORDER} keyExtractor={(id) => id}
    renderItem={({ item }) => <ProviderRow id={item} open={() => navigation.navigate('Provider', { id: item })} />} />;
}
const styles = StyleSheet.create({
  screen: { backgroundColor: INK.page, flex: 1 },
  item: { paddingHorizontal: 20, paddingVertical: 8, borderBottomColor: INK.line, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  label: { color: INK.text, fontSize: 17, flex: 1 },
});
