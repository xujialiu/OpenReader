/** Usage: node --require tsx/cjs scripts/verify-bundle.ts --bundle FILE --variant formal|free|debug */
import { readFileSync } from 'node:fs';

import { APP_VERSION } from '../app-version';
import { resolveBuildVariant } from '../build-variant';
import { inspectBundle } from './build/artifact';
import { bundleSources } from './build/source-map.mjs';

export function main(argv: string[]): void {
  if (argv.length !== 4 || argv[0] !== '--bundle' || argv[2] !== '--variant') {
    throw new Error('Usage: verify-bundle --bundle FILE --variant formal|free|debug (requires FILE.map)');
  }
  const variant = resolveBuildVariant({ variant: argv[3] });
  const sources = bundleSources(JSON.parse(readFileSync(`${argv[1]}.map`, 'utf8')));
  console.log(JSON.stringify(inspectBundle(APP_VERSION, variant, readFileSync(argv[1]), sources), null, 2));
}

if (typeof require !== 'undefined' && require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (problem) { console.error(String(problem)); process.exitCode = 1; }
}
