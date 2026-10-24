/** One release identity shared by native configuration, Metro and version lines (#324, ADR 0086). */
export type BuildVariant = 'formal' | 'free' | 'debug';

export interface BuildEnvironment {
  readonly variant?: string;
  readonly debugMode?: string;
  readonly unlocked?: string;
}

/** Missing switches keep the paid copy; legacy source-build commands select a whole role, not a runtime bypass. */
export function resolveBuildVariant({ variant, debugMode, unlocked }: BuildEnvironment): BuildVariant {
  if (variant !== undefined && variant !== 'formal' && variant !== 'free' && variant !== 'debug') {
    throw new Error(`Unknown OpenReader variant '${variant}'; use formal, free or debug.`);
  }
  if (variant !== undefined) {
    if ((debugMode === '1' && variant !== 'debug') || (unlocked === '1' && variant === 'formal')) {
      throw new Error('Conflicting OpenReader build switches; choose one variant before prebuild and bundling.');
    }
    return variant;
  }
  return debugMode === '1' ? 'debug' : unlocked === '1' ? 'free' : 'formal';
}

export function buildIdentity(versionLine: string, variant: BuildVariant) {
  if (variant !== 'formal' && variant !== 'free' && variant !== 'debug') throw new Error(`Unknown build variant '${variant}'.`);
  const match = /^(\d+\.\d+\.\d+) \(([1-9]\d*)\)(-beta[1-9]\d*)?$/.exec(versionLine);
  if (!match) throw new Error(`APP_VERSION '${versionLine}' is neither 'x.y.z (n)' nor 'x.y.z (n)-betaN'.`);
  const base = Number(match[2]);
  if (!Number.isSafeInteger(base) || base > Number.MAX_SAFE_INTEGER - 2) {
    throw new Error(`APP_VERSION '${versionLine}' has an unsafe Build Number.`);
  }
  const offset = { formal: 0, free: 1, debug: 2 }[variant];
  const buildNumber = String(base + offset);
  const line = `${match[1]} (${buildNumber})${match[3] ?? ''}`;
  return {
    variant,
    version: match[1],
    buildNumber,
    versionLine: line,
    shownVersion: `${line}${variant === 'formal' ? '' : `-${variant}`}`,
    debugMode: variant === 'debug',
    purchases: variant === 'formal',
  };
}
