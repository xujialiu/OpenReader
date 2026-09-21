import { StyleSheet, View } from 'react-native';
import { INK, SettingRow } from './controls';
import type { ScreenProps } from './routes';
import { useShell } from './routes';

export function SettingsScreen({ navigation }: ScreenProps<'Settings'>) {
  const { settings } = useShell();
  return (
    <View style={styles.screen}>
      <SettingRow title="General" detail="Theme" onPress={() => navigation.navigate('General')} />
      <SettingRow title="Providers" detail={`${settings.enabledProviders.length} enabled`}
        onPress={() => navigation.navigate('Providers')} />
      <SettingRow title="Sync" detail={settings.sync.enabled ? 'On' : 'Off'} onPress={() => navigation.navigate('Sync')} />
    </View>
  );
}
const styles = StyleSheet.create({ screen: { backgroundColor: INK.page, flex: 1 } });
