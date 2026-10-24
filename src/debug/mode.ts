import { buildIdentity, type BuildVariant } from '../../build-variant';
import { BUILD_VARIANT } from '../build/variant';

/** A fixed role, not __DEV__, controls Debug Mode even with Metro (#324). */
export const DEBUG_MODE: boolean = BUILD_VARIANT === 'debug';

export function buildVersion(version: string, variant: BuildVariant = BUILD_VARIANT): string {
  return buildIdentity(version, variant).versionLine;
}

export function shownVersion(version: string, variant: BuildVariant = BUILD_VARIANT): string {
  return buildIdentity(version, variant).shownVersion;
}
