import { BUILD_MARKER, BUILD_VARIANT } from './variant';

/** A stale native shell must not run a bundle with another purchase policy. */
export function assertNativeVariant(nativeVariant: string | undefined): void {
  if (nativeVariant !== BUILD_VARIANT) {
    throw new Error(
      `${BUILD_MARKER}: native variant '${nativeVariant ?? 'missing'}' does not match the bundle. ` +
      `Rebuild the app and start Metro with EXPO_PUBLIC_OPENREADER_VARIANT=${BUILD_VARIANT}.`,
    );
  }
}
