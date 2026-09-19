/**
 * **Settings**: a list, not a panel (ADR 0019).
 *
 * Two entries. _General_ holds what is true of the whole app. _Providers_ lists
 * the voices available and opens **one at a time**, so that a Provider's key,
 * model and Voice are on a screen of their own with that Provider's name at the
 * top.
 *
 * The reason is not tidiness, and the design file states it in the owner's
 * words: the fields that do not apply are not merely clutter, they are
 * *questions the owner cannot answer and cannot tell are not being asked of
 * them*. One screen showing six Providers' fields at once asks all of them.
 *
 * What it costs is a second tap, paid every time Settings is opened. That is
 * written down in `docs/design/0019-four-screens-and-a-way-back.md` rather than
 * discovered.
 *
 * Nothing on this screen is editable, so nothing on it is a draft. The two
 * screens that do edit hold their own and commit it by being left —
 * `provider-screen.tsx` says why that is the rule.
 */

import { StyleSheet, View } from 'react-native';

import { INK, Note, SettingRow } from './controls';
import type { ScreenProps } from './routes';
import { useShell } from './routes';
import { PROVIDER_LABELS, readiness, readinessSentence } from './settings';
import { useProviderKey } from './use-provider-secrets';

export function SettingsScreen({ navigation }: ScreenProps<'Settings'>) {
  const { settings } = useShell();
  const key = useProviderKey(settings.provider);

  /**
   * The one line under _Providers_, and it is the readiness sentence rather than
   * a count.
   *
   * "Six Providers" is a fact about the app; "Fish Audio needs a Voice" is a fact
   * about whether the book can be read aloud, which is the question the owner
   * came here with. It is claimed only once the Keychain has answered — until
   * then there is nothing true to say about a key.
   */
  const ready = readiness(settings, key.presence.state === 'held');
  const providers =
    key.presence.state === 'unknown'
      ? `${PROVIDER_LABELS[settings.provider]} is the one in use.`
      : ready.ready
        ? `${PROVIDER_LABELS[settings.provider]} is ready, reading in ${settings.voice}.`
        : readinessSentence(settings.provider, ready.missing);

  return (
    <View style={styles.screen}>
      <SettingRow
        title="General"
        detail="What is true of the whole app. Almost nothing, yet."
        onPress={() => navigation.navigate('General')}
      />
      <SettingRow title="Providers" detail={providers} onPress={() => navigation.navigate('Providers')} />

      <View style={styles.foot}>
        <Note>
          Everything here but a credential is kept for as long as the app is running and no longer. Settings are shared
          between the owner&apos;s devices through their own Sync Folder, and that is not built yet; inventing a private
          store now would only be something for it to argue with later. An API key and a gateway token are the
          exception: they are in this device&apos;s Keychain, which is why they survive a relaunch when nothing else
          here does.
        </Note>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  foot: { padding: 20 },
  screen: { backgroundColor: INK.page, flex: 1 },
});
