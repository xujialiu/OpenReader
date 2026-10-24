/** Usage: node --require tsx/cjs scripts/verify-build.ts --app PATH.app --variant formal|free|debug */
import { APP_VERSION } from '../app-version';
import { resolveBuildVariant } from '../build-variant';
import { verifyArtifact } from './build/artifact';

export function main(argv: string[]): void {
  if (argv.length !== 4 || argv[0] !== '--app' || argv[2] !== '--variant' || !argv[1].endsWith('.app')) {
    throw new Error('Usage: verify-build --app PATH.app --variant formal|free|debug');
  }
  const variant = resolveBuildVariant({ variant: argv[3] });
  console.log(JSON.stringify(verifyArtifact(argv[1], APP_VERSION, variant), null, 2));
}

if (typeof require !== 'undefined' && require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (problem) { console.error(String(problem)); process.exitCode = 1; }
}
