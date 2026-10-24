import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { ExpoConfig } from 'expo/config';

import type { BuildVariant } from '../../build-variant';

/** Read the actual config in a fresh Node process, independent of Vitest's default free gate. */
export function prebuiltConfig(variant: BuildVariant, switches: Partial<NodeJS.ProcessEnv> = {}, versionLine?: string): ExpoConfig {
  const override = versionLine === undefined ? '' :
    `const version = require.resolve('./app-version.ts'); require(version); require.cache[version].exports = { APP_VERSION: ${JSON.stringify(versionLine)} };`;
  return JSON.parse(execFileSync(process.execPath, ['--require', 'tsx/cjs', '-e',
    `${override} process.stdout.write(JSON.stringify(require('./app.config.ts').default));`], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    env: { ...process.env, EXPO_PUBLIC_OPENREADER_VARIANT: variant,
      EXPO_PUBLIC_OPENREADER_DEBUG_MODE: '0', EXPO_PUBLIC_OPENREADER_UNLOCKED: '0', ...switches },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }));
}
