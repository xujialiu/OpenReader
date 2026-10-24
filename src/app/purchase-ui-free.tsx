import type { PurchaseSettingsRow as PaidRow, purchaseScreen as paidScreen } from './purchase-ui';

/** No Purchase row or navigation route is registered in free/Debug. Type imports are erased. */
export const PurchaseSettingsRow: typeof PaidRow = () => null;
export const purchaseScreen: typeof paidScreen = () => null;
