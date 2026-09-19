/**
 * **Providers**: the list, which opens one at a time (ADR 0019).
 *
 * Every Provider the app can speak through, in the order `settings.ts` offers
 * them, each a row that opens a screen of its own. One of them is the one the
 * reading uses and its row says so; the rest say what is behind them, because a
 * row whose only claim is its own name tells the owner nothing they did not
 * already know from the word "Providers".
 *
 * What a row does **not** do is select. Tapping to look at a Provider must not
 * change which one reads the book — the one act the owner would not be able to
 * undo without noticing it had happened. Choosing is a deliberate press on the
 * Provider's own screen, where what it needs is visible at the same moment.
 */

import { FlatList, StyleSheet, View } from 'react-native';

import { INK, Note, SettingRow } from './controls';
import type { ScreenProps } from './routes';
import { useShell } from './routes';
import {
  andList,
  PROVIDER_LABELS,
  PROVIDER_ORDER,
  providerFields,
  readiness,
  readinessSentence,
} from './settings';
import { useProviderKey } from './use-provider-secrets';

export function ProvidersScreen({ navigation }: ScreenProps<'Providers'>) {
  const { settings } = useShell();
  const key = useProviderKey(settings.provider);

  /**
   * The row for the Provider in use carries `readiness`, which is the only row
   * that can: it is the only one whose key has been looked up, and claiming
   * anything about the other five would mean five more Keychain calls to say
   * something the owner learns by opening the row anyway.
   */
  const ready = readiness(settings, key.presence.state === 'held');

  return (
    <View style={styles.screen}>
      <FlatList
        data={PROVIDER_ORDER}
        keyExtractor={(provider) => provider}
        renderItem={({ item }) => (
          <SettingRow
            title={PROVIDER_LABELS[item]}
            detail={
              item === settings.provider
                ? key.presence.state === 'unknown'
                  ? 'In use.'
                  : `In use. ${readinessSentence(item, ready.ready ? [] : ready.missing)}`
                : `Holds ${andList([...providerFields(item)])}.`
            }
            onPress={() => navigation.navigate('Provider', { id: item })}
          />
        )}
        ListFooterComponent={
          <View style={styles.foot}>
            <Note>
              One Provider reads the book at a time, and the Voice belongs to it. The others keep whatever address and
              credential you have given them, so switching back does not mean typing them again.
            </Note>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  foot: { padding: 20 },
  screen: { backgroundColor: INK.page, flex: 1 },
});
