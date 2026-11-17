/** @epubjs-react-native/core interpolates this value as JavaScript source,
 * despite declaring initialLocations as a CFI array. [] itself stringifies to
 * an empty string and emits invalid `const initialLocations = ;`. The JSON
 * source below emits a truthy empty array, so locations.load([]) replaces the
 * default whole-spine locations.generate(1600) scan. Neither the visible Reader
 * nor the Download indexer uses that index. See ADRs 0011/0027 and the installed
 * template regressions in test/renderer and test/offline. */
export const EMPTY_LOCATIONS_SOURCE = '[]';

// The published CFI type is string[]. Keep this pure adapter independent of
// React/the native library, and keep one stable value rather than a render-time array.
export const EMPTY_LOCATIONS = EMPTY_LOCATIONS_SOURCE as unknown as string[];
