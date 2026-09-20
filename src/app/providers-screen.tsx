import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { INK } from './controls';
import { Icon } from './icon';
import { useShell, type ScreenProps } from './routes';
import { PROVIDER_LABELS, PROVIDER_ORDER } from './settings';

/** Availability is reported here; it is changed only inside the provider's configuration. */
export function ProvidersScreen({ navigation }: ScreenProps<'Providers'>) {
  const { settings } = useShell();
  return <FlatList style={styles.screen} data={PROVIDER_ORDER} keyExtractor={(id) => id}
    renderItem={({ item }) => {
      const enabled = settings.enabledProviders.includes(item);
      return <Pressable accessibilityRole="button"
        accessibilityLabel={`${PROVIDER_LABELS[item]}, ${enabled ? 'enabled' : 'disabled'}`}
        onPress={() => navigation.navigate('Provider', { id: item })}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <Text style={styles.label}>{PROVIDER_LABELS[item]}</Text>
        <View style={styles.status} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {enabled ? <Icon name="check" color={INK.text} size={20} /> : null}
        </View>
        <Icon name="next" size={16} color={INK.quiet} />
      </Pressable>;
    }} />;
}
const styles = StyleSheet.create({
  screen: { backgroundColor: INK.page, flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60,
    paddingHorizontal: 20, paddingVertical: 14, borderBottomColor: INK.line, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { color: INK.text, fontSize: 17, flex: 1 },
  status: { width: 20, alignItems: 'center' },
  pressed: { opacity: 0.65 },
});
