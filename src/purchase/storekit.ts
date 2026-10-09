import { storeNative } from '../../modules/open-reader-store';
import type { Store } from './store';

/**
 * The App Store itself, through our own StoreKit 2 module (#148, ADR 0075).
 * Without the module, which only a build for another platform lacks, every
 * product is out of reach and nothing is owned.
 */
export function storeKitStore(): Store {
  const native = storeNative;
  if (!native) {
    const missing = () => Promise.reject(new Error('This build has no StoreKit module.'));
    return {
      products: missing,
      purchase: missing,
      entitlements: async () => [],
      revoked: async () => [],
      sync: missing,
      listen: () => () => {},
    };
  }
  return {
    products: (ids) => native.products([...ids]),
    purchase: (id) => native.purchase(id),
    entitlements: () => native.entitlements(),
    revoked: (ids) => native.revoked([...ids]),
    sync: () => native.sync(),
    listen(listener) {
      const subscription = native.addListener('transaction', listener);
      return () => subscription.remove();
    },
  };
}

/** For the Debug Log: what StoreKit says this copy of the app was installed from. */
export function storeEnvironment(): Promise<string> {
  return storeNative ? storeNative.environment() : Promise.resolve('no StoreKit module');
}
