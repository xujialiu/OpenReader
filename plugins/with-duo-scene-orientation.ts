import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ConfigPlugin, withAppDelegate, withDangerousMod } from "expo/config-plugins";

const START = "// openreader-duo-orientation:start";
const END = "// openreader-duo-orientation:end";
const EMPTY_SCENE =
	/^class SceneDelegate\s*:\s*ExpoAppSceneDelegate\s*\{\s*(?:\/\/ Extension point for config plugins\.\s*)?\}/gm;
const EXPO_IMPORT = /^(?:internal )?import Expo[ \t]*$/m;
const APP_START = "  // openreader-duo-application:start";
const APP_END = "  // openreader-duo-application:end";
const APP_HEAD =
	/^class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider \{/gm;
const APPLICATION_BRIDGE = `#if canImport(UIKit, _version: 9127.0.85)
  public override func application(
    _ application: UIApplication,
    supportedInterfaceOrientationsFor window: UIWindow?
  ) -> UIInterfaceOrientationMask {
    if #available(iOS 27.1, *), let scene = (window ?? self.window)?.windowScene,
      let delegate = scene.delegate as? SceneDelegate,
      let orientations = delegate.duoInterfaceOrientations(for: scene) {
#if DEBUG
      NSLog("[OpenReader orientation] legacy callback uses the confirmed hinge scene")
#endif
      return orientations
    }
    return super.application(application, supportedInterfaceOrientationsFor: window)
  }
#endif`;

/** Own only the generated subclass. Expo still creates and forwards the scene. */
export function duoSceneSource(source: string, policy: string): string {
	const starts = source.split(START).length - 1;
	const ends = source.split(END).length - 1;
	if (
		starts !== ends ||
		starts > 1 ||
		(starts === 1 && source.indexOf(START) > source.indexOf(END))
	) {
		throw new Error(
			"[with-duo-scene-orientation] SceneDelegate has inconsistent owned markers; inspect the other writer.",
		);
	}
	const clean =
		starts === 1
			? source.slice(0, source.indexOf(START)) +
				"class SceneDelegate: ExpoAppSceneDelegate {}" +
				source.slice(source.indexOf(END) + END.length)
			: source;
	if (
		!EXPO_IMPORT.test(clean) ||
		(clean.match(EMPTY_SCENE)?.length ?? 0) !== 1
	) {
		throw new Error(
			"[with-duo-scene-orientation] Expected one empty ExpoAppSceneDelegate subclass; inspect the changed upstream template or another plugin.",
		);
	}
	const imports = /^(?:internal )?import UIKit[ \t]*$/m.test(clean)
		? clean
		: clean.replace(EXPO_IMPORT, "$&\nimport UIKit");
	return imports.replace(
		EMPTY_SCENE,
		() => `${START}\n${policy.trim()}\n${END}`,
	);
}

/** Align Expo's still-implemented legacy callback only for a confirmed Duo scene. */
export function duoAppDelegateSource(source: string): string {
	const starts = source.split(APP_START).length - 1;
	const ends = source.split(APP_END).length - 1;
	if (
		starts !== ends ||
		starts > 1 ||
		(starts === 1 && source.indexOf(APP_START) > source.indexOf(APP_END))
	) {
		throw new Error(
			"[with-duo-scene-orientation] AppDelegate has inconsistent owned orientation markers.",
		);
	}
	const clean = source.replace(
		/^ {2}\/\/ openreader-duo-application:start\r?\n[\s\S]*?^ {2}\/\/ openreader-duo-application:end\r?\n/gm,
		"",
	);
	if (
		!EXPO_IMPORT.test(clean) ||
		(clean.match(APP_HEAD)?.length ?? 0) !== 1 ||
		/supportedInterfaceOrientationsFor\s+\w+\s*:/.test(clean)
	) {
		throw new Error(
			"[with-duo-scene-orientation] Expected the upstream factory AppDelegate without another orientation override.",
		);
	}
	const imports = /^(?:internal )?import UIKit[ \t]*$/m.test(clean)
		? clean
		: clean.replace(EXPO_IMPORT, "$&\nimport UIKit");
	return imports.replace(
		APP_HEAD,
		(head) => `${head}\n${APP_START}\n${APPLICATION_BRIDGE}\n${APP_END}`,
	);
}

const withDuoSceneOrientation: ConfigPlugin = (config) => {
	config = withAppDelegate(config, (mod) => {
		if (mod.modResults.language !== "swift") {
			throw new Error("[with-duo-scene-orientation] Expected Expo's Swift AppDelegate.");
		}
		mod.modResults.contents = duoAppDelegateSource(mod.modResults.contents);
		return mod;
	});
	return withDangerousMod(config, [
		"ios",
		(mod) => {
			const { projectRoot, platformProjectRoot, projectName } = mod.modRequest;
			const file = join(
				platformProjectRoot,
				projectName ?? "",
				"SceneDelegate.swift",
			);
			if (!projectName || !existsSync(file)) {
				throw new Error(
					`[with-duo-scene-orientation] Upstream SceneDelegate.swift is missing at ${file}; do not create a parallel scene lifecycle.`,
				);
			}
			const policy = readFileSync(
				join(projectRoot, "plugins", "duo-scene-orientation.swift"),
				"utf8",
			);
			writeFileSync(file, duoSceneSource(readFileSync(file, "utf8"), policy));
			return mod;
		},
	]);
};

export default withDuoSceneOrientation;
