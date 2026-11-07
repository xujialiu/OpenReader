import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ExportedConfig } from 'expo/config-plugins';
import { describe, expect, it } from 'vitest';
import config from '../app.config';
import withDuoSceneOrientation, { duoSceneSource, withoutLegacyDuoOrientation } from '../plugins/with-duo-scene-orientation';

const policy = readFileSync(new URL('../plugins/duo-scene-orientation.swift', import.meta.url), 'utf8');
const template = 'import Expo\n\nclass SceneDelegate: ExpoAppSceneDelegate {\n}\n';
const appTemplate = 'internal import Expo\n\n@main\nclass AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {\n  // upstream factory/lifecycle\n}\n';

describe('the Duo exception extends the upstream scene instead of broadening every phone (#346)', () => {
  it('registers the narrow policy without changing the ordinary phone or tablet configuration', () => {
    expect(config.plugins).toContain('./plugins/with-duo-scene-orientation.ts');
    expect(config.orientation).toBe('portrait');
    expect(config.ios).toMatchObject({ supportsTablet: true, requireFullScreen: false });
    expect(config.plugins).not.toContain('./plugins/with-ui-scene-lifecycle.ts');
  });

  it('updates only its owned generated subclass and is idempotent', () => {
    const once = duoSceneSource(template, policy);
    expect(duoSceneSource(once, policy)).toBe(once);
    expect(once.match(/class SceneDelegate:/g)).toHaveLength(1);
    expect(once.match(/^import UIKit$/gm)).toHaveLength(1);
    expect(once).toContain('super.scene(scene, willConnectTo: session, options: connectionOptions)');
    const updated = duoSceneSource(once, policy.replace('positive hinge evidence', 'confirmed hinge evidence'));
    expect(updated).toContain('confirmed hinge evidence');
    expect(updated).not.toContain('positive hinge evidence');
  });

  it('refuses an unexpected subclass or broken markers instead of overwriting another writer', () => {
    for (const source of [
      template.replace('ExpoAppSceneDelegate', 'UIResponder'),
      template.replace('{\n}', '{\n  func anotherPolicy() {}\n}'),
      template + '\nclass SceneDelegate: ExpoAppSceneDelegate {}\n',
      template + '\n// openreader-duo-orientation:start\n',
    ]) expect(() => duoSceneSource(source, policy)).toThrow(/Expected one empty|inconsistent owned markers/);
  });

  it('works on the exact installed Expo template and keeps its existing compiled-scene entry', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openreader-duo-template-'));
    try {
      execFileSync('tar', ['-xf', resolve('node_modules/expo/template.tgz'), '-C', directory]);
      const native = join(directory, 'package', 'ios');
      const source = readFileSync(join(native, 'HelloWorld', 'SceneDelegate.swift'), 'utf8');
      expect(duoSceneSource(source, policy)).toContain('UIHingeInteraction');
      const application = readFileSync(join(native, 'HelloWorld', 'AppDelegate.swift'), 'utf8');
      expect(withoutLegacyDuoOrientation(application)).toBe(application);
      expect(application).toContain('return super.application(application, didFinishLaunchingWithOptions: launchOptions)');
      expect(application).toContain('class ReactNativeDelegate: ExpoReactNativeFactoryDelegate');
      expect(readFileSync(join(native, 'HelloWorld.xcodeproj', 'project.pbxproj'), 'utf8')).toContain('SceneDelegate.swift in Sources');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('runs the registered file mod without changing the plist masks or upstream factory/lifecycle', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'openreader-duo-mod-'));
    try {
      mkdirSync(join(directory, 'OpenReader'));
      writeFileSync(join(directory, 'OpenReader', 'SceneDelegate.swift'), template);
      writeFileSync(join(directory, 'OpenReader', 'AppDelegate.swift'), appTemplate);
      const base = { name: 'OpenReader', slug: 'openreader', ios: { infoPlist: {
        UISupportedInterfaceOrientations: ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown'],
        'UISupportedInterfaceOrientations~ipad': ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationLandscapeLeft'],
      } } };
      const before = JSON.stringify(base.ios);
      const mods = (withDuoSceneOrientation(base) as ExportedConfig).mods?.ios;
      const mod = mods?.dangerous;
      const applicationMod = mods?.appDelegate;
      if (!mod || !applicationMod) throw new Error('Missing iOS source mods');
      await mod({ ...base, modRawConfig: base, modResults: {}, modRequest: {
        projectRoot: resolve('.'), platformProjectRoot: directory, projectName: 'OpenReader',
        modName: 'dangerous', platform: 'ios', introspect: false,
      } });
      expect(JSON.stringify(base.ios)).toBe(before);
      // AppDelegate goes through its supported mod, not a dangerous side write
      // that a later Expo writer could overwrite.
      expect(readFileSync(join(directory, 'OpenReader', 'AppDelegate.swift'), 'utf8')).toBe(appTemplate);
      const application = await applicationMod({ ...base, modRawConfig: base,
        modResults: { language: 'swift', path: join(directory, 'OpenReader', 'AppDelegate.swift'), contents: appTemplate },
        modRequest: { projectRoot: resolve('.'), platformProjectRoot: directory, projectName: 'OpenReader',
          modName: 'appDelegate', platform: 'ios', introspect: false },
      });
      expect(application.modResults.contents).toBe(appTemplate);
      expect(readFileSync(join(directory, 'OpenReader', 'SceneDelegate.swift'), 'utf8')).toContain('supportedInterfaceOrientations(for windowScene:');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('removes only the owned legacy-callback experiment on non-clean prebuilds', () => {
    const owned = '  // openreader-duo-application:start\n  func oldExperiment() {}\n  // openreader-duo-application:end\n';
    const previous = appTemplate.replace('  // upstream factory/lifecycle', `${owned}  // upstream factory/lifecycle`);
    expect(withoutLegacyDuoOrientation(previous)).toBe(appTemplate);
    expect(withoutLegacyDuoOrientation(withoutLegacyDuoOrientation(previous))).toBe(appTemplate);
    expect(() => withoutLegacyDuoOrientation(`${appTemplate}// openreader-duo-application:start`)).toThrow(/inconsistent owned/);
  });

  it('uses the same positive scene policy at the root without creating another React view', () => {
    const refresh = policy.slice(policy.indexOf('private func refreshOrientations'), policy.indexOf('private func configuredOrientations'));
    expect(refresh).toContain('guard duoInterfaceOrientations(for: scene) != nil');
    expect(refresh).toContain('if !(content is DuoOrientationContainer)');
    expect(refresh).toContain('DuoOrientationContainer(content: content)');
    expect(refresh).toContain('[weak self, weak scene, weak content]');
    expect(policy).toContain('addChild(content)');
    expect(policy).toContain('view.addSubview(hosted)');
    expect(policy).toContain('content.didMove(toParent: self)');
    expect(policy).toContain('supportedInterfaceOrientations: UIInterfaceOrientationMask { orientations() }');
    expect(policy).toContain('childForStatusBarStyle: UIViewController? { content }');
    expect(policy).toContain('childForHomeIndicatorAutoHidden: UIViewController? { content }');
    expect(policy).toContain('let tablet = UIDevice.current.userInterfaceIdiom == .pad');
    expect(policy).not.toMatch(/startReactNative|RCTRootView\(|UIWindow\(/);
  });

  it('guards the native API and requires positive scene-scoped hinge evidence', () => {
    // Source contract only. The SDK build and actual scene masks/rotation are
    // separate native gates; this does not simulate UIKit orientation policy.
    expect(policy).toContain('#if canImport(UIKit, _version: 9127.0.85)');
    expect(policy).toContain('if #available(iOS 27.1, *)');
    expect(policy).toContain('scene.traitCollection.userInterfaceIdiom == .phone');
    expect(policy).toContain('update.hinge != nil');
    expect(policy).toContain('hingeSession == windowScene.session.persistentIdentifier');
    expect(policy).toContain('fallback.union(.landscape)');
    expect(policy).toContain('UISupportedInterfaceOrientations~ipad');
    expect(policy).not.toMatch(/hinge\.angle|hinge\.status|UIScreen\.main|UIDevice\.current\.model|setValue\(/);
    expect(policy).not.toContain('startReactNative');
  });
});
