/**
 * Whether this build sells read-aloud (#148, ADR 0075): a property of the
 * build, read as `DEBUG_MODE` is (`src/debug/mode.ts`, ADR 0054).
 *
 * On unless the JavaScript was bundled with `EXPO_PUBLIC_OPENREADER_UNLOCKED=1`
 * in the environment. babel-preset-expo replaces the read below with the value
 * as the bundle is made, and `metro.config.js` puts every `EXPO_PUBLIC_` value in
 * Metro's cache key. Exactly `1` turns it off; anything else, and a build made
 * without thinking about it, keeps the lock. So a build for the App Store cannot
 * go out unlocked because a flag was forgotten.
 *
 * Off, there is no gate, no alert, no Settings row and no StoreKit call. The
 * README names the variable for whoever builds from source.
 */
export const PURCHASE_LOCK: boolean = process.env.EXPO_PUBLIC_OPENREADER_UNLOCKED !== '1';
