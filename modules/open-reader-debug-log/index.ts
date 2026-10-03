import { requireOptionalNativeModule } from 'expo';

/**
 * The native half of the Debug Log (ADR 0054), used only from `src/debug/`.
 *
 * Optional rather than required: a checkout whose `ios/` has not been through
 * `pod install` since this module arrived has no such module, and the Debug Log
 * then keeps its file and says in its launch line that the system log is
 * missing, rather than the app failing to start in Debug Mode.
 */
interface DebugLogNative {
  /** `CFBundleShortVersionString`, the `x.y.z` of `APP_VERSION` at the last prebuild. */
  readonly nativeVersion: string;
  /** `CFBundleVersion`, the `(n)` of `APP_VERSION` at the last prebuild (#127). */
  readonly nativeBuild: string;
  /** One line to the system log at the default level, subsystem `top.xujialiu.openreader`, category `debug-log`, public. */
  systemLog(line: string): void;
}

export const debugLogNative = requireOptionalNativeModule<DebugLogNative>('OpenReaderDebugLog');
