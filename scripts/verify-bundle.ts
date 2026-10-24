/** Usage: node --require tsx/cjs scripts/verify-bundle.ts --bundle FILE --variant formal|free|debug */
import { readFileSync } from 'node:fs';

import { APP_VERSION } from '../app-version';
import { resolveBuildVariant } from '../build-variant';
import { inspectBundle } from './build/artifact';

export function main(argv: string[]): void {
  if (argv.length !== 4 || argv[0] !== '--bundle' || argv[2] !== '--variant') {
    throw new Error('Usage: verify-bundle --bundle FILE --variant formal|free|debug (requires FILE.map)');
  }
  const variant = resolveBuildVariant({ variant: argv[3] });
  const map = JSON.parse(readFileSync(`${argv[1]}.map`, 'utf8')) as { sources?: unknown };
  if (!Array.isArray(map.sources) || !map.sources.every((source): source is string => typeof source === 'string')) {
    throw new Error('The source map has no valid source inventory.');
  }
  console.log(JSON.stringify(inspectBundle(APP_VERSION, variant, readFileSync(argv[1]), map.sources), null, 2));
}

if (typeof require !== 'undefined' && require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (problem) { console.error(String(problem)); process.exitCode = 1; }
}
