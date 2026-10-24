import { withPodfile, withPodfileProperties, type ConfigPlugin } from 'expo/config-plugins';

import type { BuildVariant } from '../build-variant';

/** SDK 57 use_expo_modules! forwards exclude to resolution AND the native module provider. */
export function podfileForVariant(podfile: string, variant: BuildVariant): string {
  const generated = /^([ \t]*)# openreader-variant:(?:formal|free|debug)\r?\n\1use_expo_modules!\(\{ exclude: \[(?:"open-reader-store")?\] \}\)/gm;
  const clean = podfile.replace(generated, '$1use_expo_modules!');
  const calls = clean.match(/^[ \t]*use_expo_modules!.*$/gm) ?? [];
  if (calls.length !== 1 || !/^[ \t]*use_expo_modules![ \t]*\r?$/.test(calls[0])) {
    throw new Error('[with-release-variant] Podfile must have exactly one unmodified use_expo_modules! call; find the other writer or changed template.');
  }
  const exclude = variant === 'formal' ? [] : ['open-reader-store'];
  return clean.replace(/^([ \t]*)use_expo_modules![ \t]*\r?$/m,
    (_, indent: string) => `${indent}# openreader-variant:${variant}\n${indent}use_expo_modules!({ exclude: ${JSON.stringify(exclude)} })`);
}

const withReleaseVariant: ConfigPlugin<{ variant: BuildVariant }> = (config, { variant }) => {
  config = withPodfileProperties(config, (mod) => {
    mod.modResults['openReader.variant'] = variant;
    return mod;
  });
  return withPodfile(config, (mod) => {
    mod.modResults.contents = podfileForVariant(mod.modResults.contents, variant);
    return mod;
  });
};

export default withReleaseVariant;
