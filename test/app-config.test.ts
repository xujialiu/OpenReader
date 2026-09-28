import { readFileSync } from 'node:fs';
import type { ExportedConfig, ExportedConfigWithProps, InfoPlist } from 'expo/config-plugins';
import { describe, expect, it } from 'vitest';

import config from '../app.config';
import { APP_VERSION } from '../app-version';
import manifest from '../package.json';
import withContinuedProcessing from '../plugins/with-continued-processing';
import { pin } from './structural';

/**
 * Five ADR decisions live in app.config.ts and package.json rather than in
 * code, which means nothing would notice them being undone. Each one below is
 * cheap to undo by accident and expensive to find later:
 *
 * - the iOS floor of 17.2 (ADR 0001), which deletes a whole rendering path;
 * - background audio, without which locked-screen playback stops (ADR 0012);
 * - the New Architecture, mandatory from SDK 55 and disable-able by one line;
 * - the two playback libraries ADR 0012 rejected, whose presence is a bug;
 * - UIScene adoption (ADR 0018), without which the app does not launch.
 *
 * `plugins` entries are `string | [string, options]`, so the reads below are
 * narrowing rather than ceremony.
 */

type PluginEntry = string | [string, Record<string, unknown>?];

function plugin(name: string): Record<string, unknown> | undefined {
  const entries = (config.plugins ?? []) as PluginEntry[];
  const found = entries.find((entry) => (Array.isArray(entry) ? entry[0] : entry) === name);
  if (found === undefined) throw new Error(`app.config.ts does not use the ${name} plugin`);
  return Array.isArray(found) ? (found[1] ?? {}) : {};
}

describe('ADR 0001: the iOS floor is 17.2, above the platform minimum', () => {
  it('sets the deployment target on the built-in ios key', () => {
    // Built into ExpoConfig from SDK 56; expo-build-properties' own
    // ios.deploymentTarget is deprecated in favour of it.
    expect(config.ios?.deploymentTarget).toBeDefined();
    const [major, minor] = config.ios!.deploymentTarget!.split('.').map(Number);
    // Not 16.4, which is all SDK 57 requires. The CSS Custom Highlight API
    // arrived in Safari 17.2, and ADR 0005 says there is no fallback path to
    // write — so lowering this does not widen device support, it reintroduces
    // a per-word DOM-mutating renderer that does not exist.
    expect(major! > 17 || (major === 17 && minor! >= 2)).toBe(true);
  });
});

describe('ADR 0001: the New Architecture is not accidentally disabled', () => {
  it('carries no newArchEnabled key, because SDK 57 has no such key', () => {
    // Mandatory from SDK 55 and there is genuinely nothing to enable:
    // @expo/config-types 57.0.2 removed `newArchEnabled` from the schema and
    // no Expo plugin reads one, so `npx tsc --noEmit` rejects it outright.
    // If it ever reappears here — through a cast, or because a later SDK put
    // it back — that is a decision someone should have to defend, not a line
    // that slips in while working around something.
    expect((config as unknown as Record<string, unknown>).newArchEnabled).toBeUndefined();
  });
});

describe('ADR 0012: playback keeps going with the screen locked', () => {
  it('enables the audio background mode in the react-native-audio-api plugin', () => {
    expect(plugin('react-native-audio-api')?.iosBackgroundMode).toBe(true);
  });

  it('leaves the decode fallback in place for OpenAI-compatible servers (ADR 0013)', () => {
    // Every provider is asked for PCM, but "any server speaking that protocol"
    // includes self-hosted ones that cannot emit it.
    expect(plugin('react-native-audio-api')?.disableFFmpeg).toBe(false);
  });

  it('asks for no microphone, because OpenReader records nothing', () => {
    expect(plugin('react-native-audio-api')).not.toHaveProperty('iosMicrophonePermission');
  });
});

describe('ADR 0002: the API key is readable while the screen is locked', () => {
  it('puts no Face ID gate in front of the Keychain', () => {
    // The key is needed to synthesize the next sentence with the screen
    // locked, which a biometric prompt makes impossible. The plugin otherwise
    // ships an NSFaceIDUsageDescription nothing uses.
    expect(plugin('expo-secure-store')?.faceIDPermission).toBe(false);
  });
});

describe('ADR 0012: the rejected playback libraries stay out', () => {
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies } as Record<string, string>;

  it('does not depend on expo-audio', () => {
    // Rejected on first-hand product experience, not taste: a file player can
    // only report where it thinks it is, and the drift is what made a
    // competitor unusable for this reader.
    expect(Object.keys(dependencies)).not.toContain('expo-audio');
  });

  it('does not depend on react-native-track-player', () => {
    // v4 unmaintained since August 2025; v5 is commercial at EUR 99 a month.
    expect(Object.keys(dependencies)).not.toContain('react-native-track-player');
  });

  it('does depend on react-native-audio-api, which replaces both', () => {
    expect(dependencies['react-native-audio-api']).toBeDefined();
  });
});

describe('ADR 0001: ios/ and android/ are generated, never committed', () => {
  it('names the project so a prebuild is reproducible from config alone', () => {
    expect(manifest.name).toBe('openreader');
    expect(config.slug).toBe('openreader');
    expect(config.ios?.bundleIdentifier).toBeDefined();
    expect(config.android?.package).toBeDefined();
  });
});

/** Whether dotted version `a` comes after `b`, compared part by part. */
function isLater(a: string, b: string): boolean {
  const [x, y] = [a, b].map((version) => version.split('.').map(Number));
  const at = x!.findIndex((part, i) => part !== y![i]);
  return at >= 0 && x![at]! > y![at]!;
}

describe('AGENTS.md: every app change carries a beta version', () => {
  it('keeps one released version in app.config.ts and package.json, in a form iOS accepts', () => {
    // app.config.ts's becomes CFBundleShortVersionString: integers and dots,
    // never the beta suffix (ITMS-90060). Nothing but this reconciles the two.
    expect(config.version).toBe(manifest.version);
    expect(config.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('shows in Settings either that version or a beta of a later one', () => {
    const shown = /^(\d+\.\d+\.\d+)(?:-beta([1-9]\d*))?$/.exec(APP_VERSION);
    expect(shown, `${APP_VERSION} is neither X.Y.Z nor X.Y.Z-betaN`).not.toBeNull();
    const [, base, beta] = shown!;
    if (beta === undefined) expect(base).toBe(manifest.version);
    else expect(isLater(base!, manifest.version), `${base} is not after ${manifest.version}`).toBe(true);
  });
});

describe('ADR 0018: the app adopts the UIScene life cycle', () => {
  it('keeps the scene plugin in the config', () => {
    // Without it iOS 27 kills the app at launch, before any JavaScript, with no
    // error beyond a crash report naming
    // _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption. Nothing
    // else in this suite runs against a native build, so this line disappearing
    // would next be noticed by a person watching an app fail to open.
    expect(plugin('./plugins/with-ui-scene-lifecycle.ts')).toEqual({});
  });

  it('keeps the TypeScript loader that lets Expo require either plugin', () => {
    // Expo reads app.config.ts itself, but loads a path-resolved plugin through
    // plain `require`, which cannot read .ts. Dropping `tsx` turns the line
    // above into a plugin that is silently not found.
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies } as Record<string, string>;
    expect(dependencies['tsx']).toBeDefined();
  });
});

describe('ADR 0019: four screens, and a book can arrive from another app', () => {
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies } as Record<string, string>;

  it('keeps the plugin that declares EPUB to iOS', () => {
    // Without it the app is absent from Files' "Open in" and from every share
    // sheet. Nothing logs that absence and nothing else in this suite reaches a
    // prebuild, so this line disappearing would next be noticed by a person
    // wondering why their book will not open.
    expect(plugin('./plugins/with-epub-document-types.ts')).toEqual({});
  });

  it('depends on the native stack and on both native packages it needs', () => {
    // ADR 0019 rejected a hand-rolled screen switch on three counts, and two of
    // them — the platform back gesture and the reader not being remounted — are
    // properties of `native-stack` rendering a real UINavigationController.
    // react-native-screens and react-native-safe-area-context are native, so
    // losing either is a pod install and a rebuild rather than an npm install.
    expect(dependencies['@react-navigation/native']).toBeDefined();
    expect(dependencies['@react-navigation/native-stack']).toBeDefined();
    expect(dependencies['react-native-screens']).toBeDefined();
    expect(dependencies['react-native-safe-area-context']).toBeDefined();
  });

  it('pins the two native packages to the versions this SDK expects, not to npm latest', () => {
    // Read from the installed Expo's own bundledNativeModules.json rather than
    // written down here, so this asserts the rule ("whatever the SDK expects")
    // and not a number that would have to be edited on every upgrade.
    const expected = require('expo/bundledNativeModules.json') as Record<string, string>;
    expect(dependencies['react-native-screens']).toBe(expected['react-native-screens']);
    expect(dependencies['react-native-safe-area-context']).toBe(expected['react-native-safe-area-context']);
  });
});

describe('ADR 0053: a download goes on away from the screen as a continued processing task', () => {
  /** The plugin's Info.plist mod, run over a plain generated Info.plist with this app's own config. */
  async function run(plist: InfoPlist, ios: { bundleIdentifier?: string } = { bundleIdentifier: config.ios?.bundleIdentifier }): Promise<InfoPlist> {
    const base = { name: config.name, slug: config.slug, ios };
    const mod = (withContinuedProcessing(base) as ExportedConfig).mods?.ios?.infoPlist;
    if (!mod) throw new Error('The plugin registered no iOS Info.plist mod at all.');
    return (await mod({ ...base, modResults: plist } as ExportedConfigWithProps<InfoPlist>)).modResults;
  }

  it('keeps the plugin in the config', () => {
    // Without it the task identifier is not permitted, registration returns
    // false, and every download falls back to the bounded background time:
    // stopped within a minute of leaving the app, as in #77.
    expect(plugin('./plugins/with-continued-processing.ts')).toEqual({});
  });

  it('permits one wildcard identifier under the bundle identifier, as the SDK header asks', async () => {
    const plist = await run({});
    expect(plist.BGTaskSchedulerPermittedIdentifiers).toEqual(['top.xujialiu.openreader.download.*']);
  });

  it('is the prefix the native module submits under', () => {
    // A different prefix in the Swift is a registration refused on every download.
    const swift = readFileSync(new URL('../modules/open-reader-offline/ios/OpenReaderOfflineModule.swift', import.meta.url), 'utf8');
    pin(swift, 'let identifier = "\\(bundle).download.\\(UUID().uuidString)"', 'OpenReaderOfflineModule.swift');
  });

  it('leaves UIBackgroundModes to the audio plugin', async () => {
    const plist = await run({ UIBackgroundModes: ['audio'] });
    expect(plist.UIBackgroundModes).toEqual(['audio']);
  });

  it('fails the prebuild when something else already writes the key', async () => {
    await expect(run({ BGTaskSchedulerPermittedIdentifiers: [] })).rejects.toThrow(/already contains\s+BGTaskSchedulerPermittedIdentifiers/);
  });

  it('fails the prebuild without a bundle identifier to begin the identifier with', async () => {
    await expect(run({}, {})).rejects.toThrow(/no ios.bundleIdentifier/);
  });
});
