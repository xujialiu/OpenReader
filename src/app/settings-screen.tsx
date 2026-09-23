import { APP_VERSION } from '../../app-version';
import { Footnote, NavigationRow, SettingsGroup, SettingsPage } from './controls';
import type { ScreenProps } from './routes';
import { useShell } from './routes';

/**
 * The front page of Settings: one card, and the version under it (design 0041).
 *
 * Each row says on its right only what is true behind it now, a count or a
 * state. General says nothing: the `Theme` it used to carry described what was
 * behind the row, and stopped being the whole of it once General also held the
 * brackets.
 */
export function SettingsScreen({ navigation }: ScreenProps<'Settings'>) {
  const { settings } = useShell();
  return (
    <SettingsPage>
      <SettingsGroup footer={<Footnote accessibilityLabel={`Version ${APP_VERSION}`}>{APP_VERSION}</Footnote>}>
        <NavigationRow label="General" onPress={() => navigation.navigate('General')} />
        <NavigationRow label="Providers" value={`${settings.enabledProviders.length} enabled`}
          onPress={() => navigation.navigate('Providers')} />
        <NavigationRow label="Sync" value={settings.sync.enabled ? 'On' : 'Off'} onPress={() => navigation.navigate('Sync')} />
      </SettingsGroup>
    </SettingsPage>
  );
}
