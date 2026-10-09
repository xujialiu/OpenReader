import { useEffect } from 'react';

import { ActionRow, Footnote, SettingsGroup, SettingsPage } from './controls';
import { purchases, UNAVAILABLE } from './purchase';
import type { ScreenProps } from './routes';
import { usePurchases } from './use-purchases';

/**
 * Settings → Purchase (#148, ADR 0075): where the Unlock can be bought before
 * the Trial ends, and restored on a new phone.
 *
 * Before the Trial it also offers the Trial, through the same alert a press of
 * Play puts up, which says how long it lasts, what stops when it ends and what
 * it costs afterwards (Guideline 3.1.1). Unlock goes straight to the App
 * Store's own sheet, which names the price and asks to confirm, so the app adds
 * no question of its own. Without a price yet the row says only Unlock; a press
 * then asks the App Store again, and says so if it cannot be reached.
 *
 * The days left are on the row that opens this page, so they are not said
 * again here. Once the Unlock is owned there is nothing left to do here, and
 * the page closes.
 */
export function PurchaseScreen({ navigation }: ScreenProps<'Purchase'>) {
  const { access, price, unavailable } = usePurchases();
  const done = !access || access.kind === 'unlocked' || access.kind === 'off';
  useEffect(() => {
    if (done && navigation.canGoBack()) navigation.goBack();
  }, [done, navigation]);
  return (
    <SettingsPage>
      <SettingsGroup footer={unavailable && !price ? <Footnote>{UNAVAILABLE.message}</Footnote> : undefined}>
        {access?.kind === 'not-started' ? <ActionRow label="Start Free Trial" onPress={() => void purchases.startTrial()} /> : null}
        <ActionRow label={price ? `Unlock for ${price}` : 'Unlock'} onPress={() => void purchases.unlock()} />
        <ActionRow label="Restore Purchase" onPress={() => void purchases.restore()} />
      </SettingsGroup>
    </SettingsPage>
  );
}
