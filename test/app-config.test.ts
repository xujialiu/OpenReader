import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IOSConfig, type ExportedConfig, type ExportedConfigWithProps, type InfoPlist } from 'expo/config-plugins';
import { afterEach, describe, expect, it, vi } from 'vitest';

import config from '../app.config';
import { APP_VERSION } from '../app-version';
import { shownVersion } from '../src/debug/mode';
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

  it('carries the microphone purpose string App Store Connect requires of the library (#108)', () => {
    // AudioSessionManager.mm in react-native-audio-api calls
    // requestRecordPermission. A binary that references it without
    // NSMicrophoneUsageDescription is rejected (ITMS-90683), called or not.
    expect(plugin('react-native-audio-api')?.iosMicrophonePermission).toEqual(expect.any(String));
  });

  it('never asks for the microphone, because OpenReader records nothing (#108)', () => {
    // iOS shows the string above only when something asks. Nothing in src/
    // requests recording permission or records, and a `playback` session
    // never prompts for the microphone.
    const root = new URL('../src/', import.meta.url);
    const sources = (readdirSync(root, { recursive: true }) as string[]).filter((path) => /\.tsx?$/.test(path));
    expect(sources.length).toBeGreaterThan(0);
    for (const path of sources) {
      const text = readFileSync(new URL(path, root), 'utf8');
      expect(text, `src/${path}`).not.toMatch(/RecordingPermissions|AudioRecorder/);
      for (const [call] of text.matchAll(/setAudioSessionOptions\(\{[^}]*\}/g)) expect(call, `src/${path}`).toMatch(/iosCategory: 'playback'/);
    }
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

describe('MEMORY/app-change.md: every app change carries a beta version (#127)', () => {
  // `x.y.z (n)` for an upload, `x.y.z (n)-betaN` for each change before it.
  const shown = /^(\d+\.\d+\.\d+) \(([1-9]\d*)\)(?:-beta([1-9]\d*))?$/.exec(APP_VERSION);

  it('shows in Settings the Version, the Build Number in brackets, and the Beta if there is one', () => {
    expect(shown, `${APP_VERSION} is neither 'x.y.z (n)' nor 'x.y.z (n)-betaN'`).not.toBeNull();
  });

  it('uploads a build as the Version it leads to, the same in app.config.ts and package.json, in a form iOS accepts (#108)', () => {
    // app.config.ts's becomes CFBundleShortVersionString: integers and dots,
    // never the bracket or the beta (ITMS-90060). It is the Version the tree
    // leads to, because a released version takes no more uploads (ITMS-90186),
    // so a beta labelled with the last release would be refused.
    expect(config.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(config.version).toBe(shown![1]);
    expect(config.version).toBe(manifest.version);
  });

  it('gives CFBundleVersion the Build Number Settings shows, so the line names the upload', () => {
    expect(config.ios?.buildNumber).toBe(shown![2]);
  });
});

describe('ADR 0083: an upload is a pair, the odd number without Debug Mode and the even one with it (#310)', () => {
  const shown = /^\d+\.\d+\.\d+ \(([1-9]\d*)\)/.exec(APP_VERSION);

  /** app.config.ts as a prebuild made with this value of Debug Mode's switch reads it. */
  async function prebuiltWith(debugSwitch: string | undefined) {
    vi.resetModules();
    vi.stubEnv('EXPO_PUBLIC_OPENREADER_DEBUG_MODE', debugSwitch as string);
    return (await import('../app.config')).default;
  }

  afterEach(() => vi.unstubAllEnvs());

  it('names the build without Debug Mode in APP_VERSION, on an odd Build Number', () => {
    expect(Number(shown![1]) % 2, `${APP_VERSION} has an even Build Number`).toBe(1);
  });

  it('stops a prebuild whose APP_VERSION has an even Build Number', async () => {
    vi.resetModules();
    vi.doMock('../app-version', () => ({ APP_VERSION: '1.0.0 (10)-beta1' }));
    await expect(import('../app.config')).rejects.toThrow(/even Build Number/);
    vi.doUnmock('../app-version');
  });

  it('writes the odd number in a prebuild made without the switch, or with anything but 1', async () => {
    for (const value of [undefined, '0', 'true', '', ' 1']) {
      expect((await prebuiltWith(value)).ios?.buildNumber, String(value)).toBe(shown![1]);
    }
  });

  it('writes the even number after it in a prebuild made with EXPO_PUBLIC_OPENREADER_DEBUG_MODE=1, the number Settings shows there', async () => {
    const debug = await prebuiltWith('1');
    expect(debug.ios?.buildNumber).toBe(String(Number(shown![1]) + 1));
    expect(shownVersion(APP_VERSION, true)).toContain(`(${debug.ios?.buildNumber})`);
    // The Version is the pair's, the same for both.
    expect(debug.version).toBe(config.version);
  });
});

describe('#108: a fresh prebuild is one App Store Connect accepts', () => {
  it('supports resizable iPad apps while retaining portrait iPhone orientation (#319)', () => {
    expect(config.ios?.supportsTablet).toBe(true);
    expect(config.ios?.requireFullScreen).toBe(false);
    expect(config.orientation).toBe('portrait');
    // The installed SDK's writers, not a second hand-written config mapping.
    const plist = IOSConfig.RequiresFullScreen.setRequiresFullScreen(config, IOSConfig.Orientation.setOrientation(config, {}));
    expect(IOSConfig.DeviceFamily.getDeviceFamilies(config)).toEqual([1, 2]);
    expect(plist.UIRequiresFullScreen).toBe(false);
    expect(plist.UISupportedInterfaceOrientations).toEqual(['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown']);
    expect(plist['UISupportedInterfaceOrientations~ipad']).toEqual([
      'UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown',
      'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight',
    ]);
  });

  it('declares no non-exempt encryption, so no upload waits on the export-compliance question', () => {
    expect(config.ios?.config?.usesNonExemptEncryption).toBe(false);
  });

  it('gives CFBundleVersion as a whole number, raised for each upload', () => {
    expect(config.ios?.buildNumber).toMatch(/^[1-9]\d*$/);
  });

  it('names the signing team, so a fresh ios/ signs without Xcode', () => {
    expect(config.ios?.appleTeamId).toMatch(/^[A-Z0-9]{10}$/);
  });
});

describe('ADR 0080: a server of the owner\'s is reached over http:// by any name (#210)', () => {
  type Ats = Record<string, unknown>;

  /** The App Transport Security dictionary of the prebuild template's Info.plist. */
  function templateAts(): Ats {
    const dir = mkdtempSync(join(tmpdir(), 'openreader-ats-'));
    let xml: string;
    try {
      const template = new URL('../node_modules/expo/template.tgz', import.meta.url).pathname;
      execFileSync('tar', ['-xzf', template, '-C', dir, 'package/ios/HelloWorld/Info.plist']);
      xml = readFileSync(join(dir, 'package/ios/HelloWorld/Info.plist'), 'utf8');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const block = /<key>NSAppTransportSecurity<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(xml)![1]!;
    const keys: Ats = {};
    for (const [, key, value] of block.matchAll(/<key>(\w+)<\/key>\s*<(true|false)\/>/g)) keys[key!] = value === 'true';
    return keys;
  }

  /**
   * What the prebuild writes: a dictionary in `ios.infoPlist` replaces the
   * template's whole, since @expo/config-plugins spreads `ios.infoPlist` over
   * the template's Info.plist at the top level (withIosBaseMods.js).
   */
  const written = (): Ats =>
    ((config.ios?.infoPlist ?? {}) as Record<string, unknown>).NSAppTransportSecurity as Ats | undefined ?? templateAts();

  it('lets plain HTTP through to a dotted domain name, such as a Tailscale or home-router name', () => {
    // Apple: NSAllowsArbitraryLoads is ignored, and NO used, while any of these
    // three is present; NSAllowsLocalNetworking alone lets through only IP
    // addresses, `.local` names and names without a dot (measured in #210:
    // -1022 for a dotted name, with either dictionary that holds it).
    const ats = written();
    expect(ats.NSAllowsArbitraryLoads).toBe(true);
    for (const overriding of ['NSAllowsLocalNetworking', 'NSAllowsArbitraryLoadsForMedia', 'NSAllowsArbitraryLoadsInWebContent']) {
      expect(ats).not.toHaveProperty(overriding);
    }
  });

  it('has the template refuse it, which is why the config says so', () => {
    // The control: the reason the key above has to be set at all.
    expect(templateAts()).toEqual({ NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true });
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

describe('ADR 0054: Debug Mode is fixed in the bundle, and no build takes another\'s', () => {
  const require = createRequire(import.meta.url);
  /** metro.config.js as Metro loads it, with `value` for the switch in the environment. */
  function metroWith(value: string | undefined) {
    const path = require.resolve('../metro.config.js');
    delete require.cache[path];
    const was = process.env.EXPO_PUBLIC_OPENREADER_DEBUG_MODE;
    if (value === undefined) delete process.env.EXPO_PUBLIC_OPENREADER_DEBUG_MODE;
    else process.env.EXPO_PUBLIC_OPENREADER_DEBUG_MODE = value;
    try {
      return require(path) as { transformer: Record<string, unknown> };
    } finally {
      if (was === undefined) delete process.env.EXPO_PUBLIC_OPENREADER_DEBUG_MODE;
      else process.env.EXPO_PUBLIC_OPENREADER_DEBUG_MODE = was;
    }
  }

  it('puts every EXPO_PUBLIC_ value in the transformer configuration, which Metro hashes into its cache key', () => {
    // babel-preset-expo writes the value into mode.ts's transformed code, and
    // Metro's key is the file and the transformer's configuration: without this,
    // a bundle made without the switch after one with it came out with Debug
    // Mode on (notes/NOTES_2026-09-29.md; Expo drops the Xcode phase's
    // --reset-cache when CI is set).
    const on = metroWith('1').transformer.publicEnvironment as string[];
    const off = metroWith(undefined).transformer.publicEnvironment as string[];
    expect(on).toContain('EXPO_PUBLIC_OPENREADER_DEBUG_MODE=1');
    expect(off.some((entry) => entry.startsWith('EXPO_PUBLIC_OPENREADER_DEBUG_MODE='))).toBe(false);
  });

  it('keeps Expo\'s own configuration under it', () => {
    // A metro.config.js that replaced rather than extended Expo's would lose its
    // transformer, and every bundle with it.
    expect(metroWith(undefined).transformer.babelTransformerPath).toMatch(/@expo\/metro-config/);
  });

  it('writes each Debug Log line to the system log at the default level, and public', () => {
    // INFO, where React Native's console lines go, is kept only while a stream is
    // attached (pitfalls/physical-iphone.md); `.notice` is the default level,
    // which the phone persists. A private argument is collected as `<private>`.
    const swift = readFileSync(new URL('../modules/open-reader-debug-log/ios/OpenReaderDebugLogModule.swift', import.meta.url), 'utf8');
    pin(swift, 'Logger(subsystem: "top.xujialiu.openreader", category: "debug-log")', 'OpenReaderDebugLogModule.swift');
    pin(swift, 'self.logger.notice("\\(line, privacy: .public)")', 'OpenReaderDebugLogModule.swift');
  });
});

describe('#83: the icon is one Icon Composer document, and every image the config names exists', () => {
  type IconDocument = {
    'fill-specializations': { appearance?: string }[];
    groups: { layers: { 'image-name': string; 'fill-specializations'?: { appearance?: string }[] }[] }[];
  };
  const root = new URL('../', import.meta.url);
  const exists = (path: string) => existsSync(new URL(path, root));

  it('gives iOS the .icon as a string, which is the only form Expo compiles as one', () => {
    // Inside the `{ light, dark, tinted }` object, withIosIcons warns and treats
    // it as an image path.
    expect(config.ios?.icon).toBe('./assets/icon/OpenReader.icon');
  });

  it('carries a dark background and a tinted fill for each layer, and every layer image it names', () => {
    const icon = './assets/icon/OpenReader.icon';
    const document = JSON.parse(readFileSync(new URL(`${icon}/icon.json`, root), 'utf8')) as IconDocument;
    const appearances = document['fill-specializations'].map((entry) => entry.appearance);
    expect(appearances).toEqual([undefined, 'dark', 'tinted']);
    const layers = document.groups.flatMap((group) => group.layers);
    expect(layers.map((layer) => layer['image-name']).sort()).toEqual(['headphones.svg', 'wave.svg']);
    for (const layer of layers) {
      expect(exists(`${icon}/Assets/${layer['image-name']}`)).toBe(true);
      expect(layer['fill-specializations']?.map((entry) => entry.appearance)).toEqual(['tinted']);
    }
  });

  it('points every other icon key at a file that is there', () => {
    // A missing path fails the prebuild only for the platform that reads it,
    // and Android's is not built yet.
    const adaptive = config.android?.adaptiveIcon;
    const paths = [config.icon, adaptive?.foregroundImage, adaptive?.monochromeImage];
    for (const path of paths) {
      expect(path).toMatch(/^\.\/assets\/icon\/[a-z-]+\.png$/);
      expect(exists(path!)).toBe(true);
    }
  });
});
