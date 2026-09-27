import { requireOptionalNativeModule } from 'expo';

interface OfflineNative {
  writeJson(uri: string, contents: string): void;
  excludeFromBackup(uri: string): void;
  compress(input: string, output: string, rate: number): Promise<void>;
  beginBackground(): Promise<boolean>;
  endBackground(): Promise<void>;
  /**
   * The continued processing task of ADR 0052, iOS 26 and later: whether the
   * phone runs it now. False below iOS 26 and on any refusal, which the module
   * logs; the bounded background time is then what is left.
   */
  submitContinued(title: string, subtitle: string, completed: number, total: number): Promise<boolean>;
  updateContinued(title: string, subtitle: string, completed: number, total: number): Promise<void>;
  finishContinued(success: boolean): Promise<void>;
  addListener(event: 'connectivity', listener: (event: { connected: boolean }) => void): { remove(): void };
  addListener(event: 'expired', listener: () => void): { remove(): void };
  /** The phone ended the continued task: under pressure, or the owner stopped it in the Live Activity. */
  addListener(event: 'continuedExpired', listener: () => void): { remove(): void };
}
export const offlineNative = requireOptionalNativeModule<OfflineNative>('OpenReaderOffline');
