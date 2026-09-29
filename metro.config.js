// https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * Every `EXPO_PUBLIC_` value, in Metro's transform cache key (ADR 0054).
 *
 * babel-preset-expo writes such a value into a file's transformed code as the
 * bundle is made, and Metro caches that code under a key made of the file and
 * the transformer's configuration, never the environment. So a bundle made
 * without `EXPO_PUBLIC_OPENREADER_DEBUG_MODE` right after one made with it came
 * out with Debug Mode on (measured 2026-09-29, notes). The Xcode phase's
 * `--reset-cache` hides that until `CI` is set, when Expo drops the reset.
 * Everything under `transformer` is hashed into the key, so with the values
 * here a change of any of them is a different key, and the two builds never
 * share a cached file.
 */
config.transformer = {
  ...config.transformer,
  publicEnvironment: Object.keys(process.env)
    .filter((name) => name.startsWith('EXPO_PUBLIC_'))
    .sort()
    .map((name) => `${name}=${process.env[name]}`),
};

module.exports = config;
