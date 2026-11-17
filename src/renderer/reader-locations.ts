import type { Reader } from '@epubjs-react-native/core';
import type { ComponentProps } from 'react';

/** @epubjs-react-native/core interpolates this value as JavaScript source,
 * despite declaring initialLocations as a CFI array. [] itself stringifies to
 * an empty string and emits invalid `const initialLocations = ;`. The JSON
 * source below emits a truthy empty array, so locations.load([]) replaces the
 * default whole-spine locations.generate(1600) scan. Neither the visible Reader
 * nor the Download indexer uses that index. See ADRs 0011/0027 and the installed
 * template regressions in test/renderer and test/offline. */
export const EMPTY_LOCATIONS_SOURCE = '[]';

// One stable compatibility boundary for both readers, not a new array at render.
export const EMPTY_LOCATIONS = EMPTY_LOCATIONS_SOURCE as unknown as NonNullable<ComponentProps<typeof Reader>['initialLocations']>;
