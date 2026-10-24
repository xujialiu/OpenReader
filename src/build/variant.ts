import { resolveBuildVariant } from '../../build-variant';

/** Node/test fallback. Metro replaces this module with one static role before traversing dependencies. */
export const BUILD_VARIANT = resolveBuildVariant({
  variant: process.env.EXPO_PUBLIC_OPENREADER_VARIANT,
  debugMode: process.env.EXPO_PUBLIC_OPENREADER_DEBUG_MODE,
  unlocked: process.env.EXPO_PUBLIC_OPENREADER_UNLOCKED,
});
export const BUILD_MARKER = `openreader-variant:${BUILD_VARIANT}`;
