/** @epubjs-react-native/core interpolates this value as JavaScript source,
 * despite declaring initialLocations as a CFI array. [] itself stringifies to
 * an empty string and emits invalid `const initialLocations = ;`. The JSON
 * source below emits a truthy empty array, so locations.load([]) replaces the
 * default whole-spine locations.generate(1600) scan. No percentages are used
 * by the isolated preparation reader. See ADR 0027 and reader-locations.test. */
export const EMPTY_LOCATIONS_SOURCE = '[]';
