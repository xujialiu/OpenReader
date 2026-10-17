import { requireOptionalNativeModule } from 'expo';
import type { StoreProduct, StorePurchase, StoreSnapshot, StoreTransaction } from '../../src/purchase/store';

/** Only verified transactions cross this native seam; source identifiers stay on the device. */
interface StoreNative {
  products(ids: string[]): Promise<StoreProduct[]>;
  purchase(id: string): Promise<StorePurchase>;
  snapshot(ids: string[]): Promise<StoreSnapshot>;
  sync(): Promise<'restored' | 'cancelled'>;
  environment(): Promise<string>;
  addListener(event: 'transaction', listener: (transaction: StoreTransaction) => void): { remove(): void };
}
export const storeNative = requireOptionalNativeModule<StoreNative>('OpenReaderStore');
