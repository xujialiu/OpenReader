/**
 * **Debug Mode** (CONTEXT.md, ADR 0054): a property of the build, and nothing
 * the owner switches at run time.
 *
 * On in every Metro build (`__DEV__`), and in a Release build only when the
 * JavaScript was bundled with `EXPO_PUBLIC_OPENREADER_DEBUG_MODE=1` in the
 * environment: babel-preset-expo replaces the `process.env` read below with the
 * value as the bundle is made, so what is decided here is fixed in the build.
 * Exactly `1`; anything else, and a build made without thinking about it, is
 * off. `metro.config.js` puts every `EXPO_PUBLIC_` value in Metro's cache key,
 * without which a cached copy of this file could carry one build's answer into
 * the next (ADR 0054, the measurement).
 *
 * `typeof` because this file is also read under Node, where there is no
 * `__DEV__`; Metro replaces the name itself, and `typeof false` is harmless.
 */
export const DEBUG_MODE: boolean =
  (typeof __DEV__ !== 'undefined' && __DEV__) || process.env.EXPO_PUBLIC_OPENREADER_DEBUG_MODE === '1';

/**
 * The version of this build (#310, ADR 0083). `APP_VERSION` names the build
 * without Debug Mode, on an odd Build Number; the same code with Debug Mode is
 * the even number after it. So `1.0.0 (9)-beta3` is `1.0.0 (10)-beta3` in
 * Debug Mode, and the upload `1.0.0 (9)` is paired with `1.0.0 (10)`.
 */
export function buildVersion(version: string, debugMode: boolean = DEBUG_MODE): string {
  return debugMode ? version.replace(/\((\d+)\)/, (_, build: string) => `(${Number(build) + 1})`) : version;
}

/** The version line Settings shows: `buildVersion` (#127, #310), and `-debug` after it in Debug Mode (#82). */
export function shownVersion(version: string, debugMode: boolean = DEBUG_MODE): string {
  return debugMode ? `${buildVersion(version, true)}-debug` : version;
}
