import { requireOptionalNativeModule } from 'expo';

interface OfflineNative {
  writeJson(uri: string, contents: string): void;
  excludeFromBackup(uri: string): void;
  compress(input: string, output: string, rate: number): Promise<void>;
  beginBackground(): Promise<boolean>;
  endBackground(): Promise<void>;
  addListener(event: 'connectivity', listener: (event: { connected: boolean }) => void): { remove(): void };
  addListener(event: 'expired', listener: () => void): { remove(): void };
}
export const offlineNative = requireOptionalNativeModule<OfflineNative>('OpenReaderOffline');
