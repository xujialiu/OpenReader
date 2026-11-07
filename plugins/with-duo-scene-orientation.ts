import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ConfigPlugin, withAppDelegate, withDangerousMod } from 'expo/config-plugins';

const START = '// openreader-duo-orientation:start';
const END = '// openreader-duo-orientation:end';
const EMPTY_SCENE = /^class SceneDelegate\s*:\s*ExpoAppSceneDelegate\s*\{\s*(?:\/\/ Extension point for config plugins\.\s*)?\}/gm;
const EXPO_IMPORT = /^(?:internal )?import Expo[ \t]*$/m;
const OLD_APP_START = '// openreader-duo-application:start';
const OLD_APP_END = '// openreader-duo-application:end';

/** Own only the generated subclass. Expo still creates and forwards the scene. */
export function duoSceneSource(source: string, policy: string): string {
  const starts = source.split(START).length - 1;
  const ends = source.split(END).length - 1;
  if (starts !== ends || starts > 1 || (starts === 1 && source.indexOf(START) > source.indexOf(END))) {
    throw new Error('[with-duo-scene-orientation] SceneDelegate has inconsistent owned markers; inspect the other writer.');
  }
  const clean = starts === 1
    ? `${source.slice(0, source.indexOf(START))}class SceneDelegate: ExpoAppSceneDelegate {}${source.slice(source.indexOf(END) + END.length)}`
    : source;
  if (!EXPO_IMPORT.test(clean) || (clean.match(EMPTY_SCENE)?.length ?? 0) !== 1) {
    throw new Error('[with-duo-scene-orientation] Expected one empty ExpoAppSceneDelegate subclass; inspect the changed upstream template or another plugin.');
  }
  const imports = /^(?:internal )?import UIKit[ \t]*$/m.test(clean) ? clean : clean.replace(EXPO_IMPORT, '$&\nimport UIKit');
  return imports.replace(EMPTY_SCENE, () => `${START}\n${policy.trim()}\n${END}`);
}

/** Remove the unneeded beta12 experiment on non-clean prebuilds. Fresh
 * AppDelegates, their factory/lifecycle and other plugins remain untouched. */
export function withoutLegacyDuoOrientation(source: string): string {
  const starts = source.split(OLD_APP_START).length - 1;
  const ends = source.split(OLD_APP_END).length - 1;
  if (starts !== ends || starts > 1 || (starts === 1 && source.indexOf(OLD_APP_START) > source.indexOf(OLD_APP_END))) {
    throw new Error('[with-duo-scene-orientation] AppDelegate has inconsistent owned orientation markers.');
  }
  return source.replace(/^[ \t]*\/\/ openreader-duo-application:start\r?\n[\s\S]*?^[ \t]*\/\/ openreader-duo-application:end\r?\n/gm, '');
}

const withDuoSceneOrientation: ConfigPlugin = (config) => {
  config = withAppDelegate(config, (mod) => {
    mod.modResults.contents = withoutLegacyDuoOrientation(mod.modResults.contents);
    return mod;
  });
  return withDangerousMod(config, ['ios', (mod) => {
    const { projectRoot, platformProjectRoot, projectName } = mod.modRequest;
    const file = join(platformProjectRoot, projectName ?? '', 'SceneDelegate.swift');
    if (!projectName || !existsSync(file)) {
      throw new Error(`[with-duo-scene-orientation] Upstream SceneDelegate.swift is missing at ${file}; do not create a parallel scene lifecycle.`);
    }
    const policy = readFileSync(join(projectRoot, 'plugins', 'duo-scene-orientation.swift'), 'utf8');
    writeFileSync(file, duoSceneSource(readFileSync(file, 'utf8'), policy));
    return mod;
  }]);
};

export default withDuoSceneOrientation;
