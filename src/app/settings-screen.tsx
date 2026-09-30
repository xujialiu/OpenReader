import { APP_VERSION } from '../../app-version';
import { shownVersion } from '../debug/mode';
import { ActionRow, Footnote, NavigationRow, SettingsGroup, SettingsPage } from './controls';
import { openPrivacyPolicy } from './own-site';
import type { ScreenProps } from './routes';
import { useShell } from './routes';

/**
 * The front page of Settings: the card of settings, then a card holding the
 * privacy policy (#110) and the acknowledgements (#111), with the version under
 * it (design 0041). The version ends in `-debug` in a build with Debug Mode
 * (design 0054).
 *
 * Each row says on its right only what is true behind it now, a count or a
 * state. General says nothing: the `Theme` it used to carry described what was
 * behind the row, and stopped being the whole of it once General also held the
 * brackets.
 *
 * Neither is a setting. The privacy policy is a link, and its tinted words say
 * so, as the phone's own link rows do. The acknowledgements are a page in the
 * app, so theirs is a row like any other. Both sit in a card of their own at the
 * foot of the page, where the phone puts its own legal rows.
 */
export function SettingsScreen({ navigation }: ScreenProps<'Settings'>) {
  const { settings } = useShell();
  const version = shownVersion(APP_VERSION);
  return (
    <SettingsPage>
      <SettingsGroup>
        <NavigationRow label="General" onPress={() => navigation.navigate('General')} />
        <NavigationRow label="Word Lookup & Translation" onPress={() => navigation.navigate('Translation')} />
        <NavigationRow label="Providers" value={`${settings.enabledProviders.length} enabled`}
          onPress={() => navigation.navigate('Providers')} />
        <NavigationRow label="Sync" value={settings.sync.enabled ? 'On' : 'Off'} onPress={() => navigation.navigate('Sync')} />
      </SettingsGroup>
      <SettingsGroup footer={<Footnote accessibilityLabel={`Version ${version}`}>{version}</Footnote>}>
        <ActionRow label="Privacy Policy" onPress={openPrivacyPolicy} />
        <NavigationRow label="Acknowledgements" onPress={() => navigation.navigate('Acknowledgements')} />
      </SettingsGroup>
    </SettingsPage>
  );
}
