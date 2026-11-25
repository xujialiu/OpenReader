import fs from 'node:fs';
import path from 'node:path';

import { DOMParser } from '@xmldom/xmldom';
import { withDangerousMod, type ConfigPlugin } from 'expo/config-plugins';

/**
 * Point the generated scheme's Run action at `storekit/OpenReader.storekit`
 * (#148, ADR 0075), so that a run Xcode itself launches buys from that file
 * rather than from the App Store's sandbox.
 *
 * The file holds the two products as App Store Connect has them: the "30-day
 * Trial" at 0 and the Unlock at 4.99. `ios/` is generated, so the reference is
 * written at every prebuild rather than kept in the scheme by hand.
 *
 * Only Xcode reads it. A run started by `xcodebuild`, `npx expo run:ios` or
 * `simctl launch` ignores the scheme's StoreKit configuration (ADR 0075), and an
 * archive never carries it, so no build that leaves the Mac buys from a file.
 *
 * The identifier is relative to the `.xcodeproj` package, as Xcode writes it
 * (`../Simplenote/TestConfiguration.storekit` beside `Simplenote.xcodeproj` in
 * Automattic/simplenote-ios): `ios/OpenReader.xcodeproj` is two levels below
 * the repository's root.
 *
 * A repeated prebuild accepts the same Run configuration. A conflicting
 * path or a reference outside the Run action requires inspection.
 */
const STOREKIT_FILE = 'storekit/OpenReader.storekit';

export function withStoreKitReference(scheme: string, identifier: string): string {
  const document = new DOMParser().parseFromString(scheme, 'application/xml');
  const actions = document.getElementsByTagName('LaunchAction');
  if (!actions.length) throw new Error('[with-storekit-configuration] The generated scheme has no LaunchAction.');
  if (actions.length !== 1) throw new Error('[with-storekit-configuration] Expected exactly one LaunchAction.');
  const references = Array.from(document.getElementsByTagName('StoreKitConfigurationFileReference'));
  if (references.length) {
    const [reference] = references;
    if (references.length === 1 && reference.parentNode === actions[0] && reference.getAttribute('identifier') === identifier) return scheme;
    const paths = references.map(ref => ref.getAttribute('identifier') ?? '(missing identifier)');
    throw new Error(`[with-storekit-configuration] Found StoreKit reference(s) ${JSON.stringify(paths)}. Expected one LaunchAction reference to ${identifier}.`);
  }
  const end = scheme.indexOf('</LaunchAction>');
  if (end < 0) throw new Error('[with-storekit-configuration] Expected a closing LaunchAction tag in the generated scheme.');
  const reference =
    '      <StoreKitConfigurationFileReference\n' +
    `         identifier = "${identifier}">\n` +
    '      </StoreKitConfigurationFileReference>\n';
  const line = scheme.lastIndexOf('\n', end) + 1;
  const insert = scheme.slice(line, end).trim() ? end : line;
  return scheme.slice(0, insert) + reference + scheme.slice(insert);
}

const withStoreKitConfiguration: ConfigPlugin = (config) =>
  withDangerousMod(config, [
    'ios',
    (modConfig) => {
      const root = modConfig.modRequest.projectRoot;
      const ios = modConfig.modRequest.platformProjectRoot;
      if (!fs.existsSync(path.join(root, STOREKIT_FILE))) {
        throw new Error(`[with-storekit-configuration] ${STOREKIT_FILE} is missing.`);
      }
      const project = fs.readdirSync(ios).find((name) => name.endsWith('.xcodeproj'));
      if (!project) throw new Error('[with-storekit-configuration] The generated ios/ folder has no .xcodeproj.');
      const schemes = path.join(ios, project, 'xcshareddata', 'xcschemes');
      const name = `${project.replace(/\.xcodeproj$/, '')}.xcscheme`;
      const file = path.join(schemes, name);
      if (!fs.existsSync(file)) throw new Error(`[with-storekit-configuration] The generated scheme ${name} is missing.`);
      const identifier = path.relative(path.join(ios, project), path.join(root, STOREKIT_FILE)).split(path.sep).join('/');
      fs.writeFileSync(file, withStoreKitReference(fs.readFileSync(file, 'utf8'), identifier));
      return modConfig;
    },
  ]);

export default withStoreKitConfiguration;
