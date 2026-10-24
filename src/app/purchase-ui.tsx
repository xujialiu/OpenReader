import type { createNativeStackNavigator, NativeStackNavigationOptions } from '@react-navigation/native-stack';
import type { ReactElement } from 'react';

import { DetailRow, NavigationRow } from './controls';
import { PURCHASE, purchaseValue } from './purchase';
import { PurchaseScreen } from './purchase-screen';
import type { RootStackParamList, ScreenProps } from './routes';
import { usePurchases } from './use-purchases';

/** The existing paid row and route stay together, so Metro can exclude the entire purchase UI. */
export function PurchaseSettingsRow({ navigation }: { navigation: ScreenProps<'Settings'>['navigation'] }) {
  const { access, now } = usePurchases();
  const value = purchaseValue(access, now) ?? '';
  if (access?.kind === 'unlocked') return <DetailRow label={PURCHASE} value={value} />;
  return access && access.kind !== 'off'
    ? <NavigationRow label={PURCHASE} value={value} tint onPress={() => navigation.navigate('Purchase')} />
    : null;
}

export function purchaseScreen(Stack: ReturnType<typeof createNativeStackNavigator<RootStackParamList>>, options: NativeStackNavigationOptions): ReactElement | null {
  return <Stack.Screen name="Purchase" component={PurchaseScreen} options={{ title: PURCHASE, headerBackTitle: 'Settings', ...options }} />;
}
