import { useLayoutEffect } from 'react';

import { aboutLine, acknowledgement, acknowledgements } from './acknowledgements';
import { Footnote, NavigationRow, ProseRow, SettingsGroup, SettingsPage } from './controls';
import type { ScreenProps } from './routes';

/**
 * Every third-party component the app ships (#111, design 0065): one card of
 * rows, the component's name on the left and its licence on the right, as the
 * phone's own acknowledgements lists are drawn (design 0042). A row opens that
 * component's licence text.
 */
export function AcknowledgementsScreen({ navigation }: ScreenProps<'Acknowledgements'>) {
  return (
    <SettingsPage>
      <SettingsGroup>
        {acknowledgements().map((entry) => (
          <NavigationRow key={entry.name} label={entry.name} value={entry.license}
            accessibilityLabel={`${entry.name}, ${entry.license}`}
            onPress={() => navigation.navigate('Acknowledgement', { name: entry.name })} />
        ))}
      </SettingsGroup>
    </SettingsPage>
  );
}

/**
 * One component's licence, in its own words, with the version and where it came
 * from under it. The title is the component's name, which only the route knows.
 */
export function AcknowledgementScreen({ navigation, route }: ScreenProps<'Acknowledgement'>) {
  const { name } = route.params;
  const entry = acknowledgement(name);
  useLayoutEffect(() => {
    navigation.setOptions({ title: name, headerBackTitle: 'Acknowledgements' });
  }, [name, navigation]);
  if (!entry) return null;
  const about = aboutLine(entry);
  return (
    <SettingsPage>
      <SettingsGroup footer={about ? <Footnote>{about}</Footnote> : undefined}>
        <ProseRow>{entry.text}</ProseRow>
      </SettingsGroup>
    </SettingsPage>
  );
}
