import { NavigationRow, SettingsGroup, SettingsPage } from './controls';
import { useShell, type ScreenProps } from './routes';
import { PROVIDER_LABELS, PROVIDER_ORDER } from './settings';

/** Availability is reported here; it is changed only inside the provider's configuration. */
export function ProvidersScreen({ navigation }: ScreenProps<'Providers'>) {
  const { settings } = useShell();
  return (
    <SettingsPage>
      <SettingsGroup>
        {PROVIDER_ORDER.map((id) => {
          const enabled = settings.enabledProviders.includes(id);
          return <NavigationRow key={id} label={PROVIDER_LABELS[id]} checked={enabled}
            accessibilityLabel={`${PROVIDER_LABELS[id]}, ${enabled ? 'enabled' : 'disabled'}`}
            onPress={() => navigation.navigate('Provider', { id })} />;
        })}
      </SettingsGroup>
    </SettingsPage>
  );
}
