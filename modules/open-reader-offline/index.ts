import { requireOptionalNativeModule } from 'expo';

/** The continued task's progress, and the phone's thermal state (0 nominal to 3 critical) and Low Power Mode, as it ended. */
export interface ContinuedEnded {
  cancelled: boolean;
  fraction: number;
  completed: number;
  total: number;
  thermalState: number;
  lowPower: boolean;
}

interface OfflineNative {
  writeJson(uri: string, contents: string): void;
  excludeFromBackup(uri: string): void;
  compress(input: string, output: string, rate: number): Promise<void>;
  beginBackground(): Promise<boolean>;
  endBackground(): Promise<void>;
  /**
   * The continued processing task of ADR 0053, iOS 26 and later: whether the
   * phone runs it now. False below iOS 26 and on any refusal, which the module
   * logs; the bounded background time is then what is left.
   */
  submitContinued(title: string, subtitle: string, completed: number, total: number): Promise<boolean>;
  updateContinued(title: string, subtitle: string, completed: number, total: number): Promise<void>;
  finishContinued(success: boolean): Promise<void>;
  addListener(event: 'connectivity', listener: (event: { connected: boolean }) => void): { remove(): void };
  addListener(event: 'expired', listener: () => void): { remove(): void };
  /**
   * The phone ended the continued task: under pressure, or the owner stopped it
   * in the Live Activity, which it cannot tell apart (ADR 0053). With what was
   * publicly visible as it ended, also logged, for a future comparison of the two.
   */
  addListener(event: 'continuedExpired', listener: (event: ContinuedEnded) => void): { remove(): void };
}
export const offlineNative = requireOptionalNativeModule<OfflineNative>('OpenReaderOffline');
