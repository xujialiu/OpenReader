import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ExportedConfig } from 'expo/config-plugins';
import { describe, expect, it } from 'vitest';
import config from '../app.config';
import withDuoSceneOrientation, { duoSceneSource } from '../plugins/with-duo-scene-orientation';

const policy = readFileSync(new URL('../plugins/duo-scene-orientation.swift', import.meta.url), 'utf8');
const template = 'import Expo\n\nclass SceneDelegate: ExpoAppSceneDelegate {\n}\n';

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
      expect(readFileSync(join(native, 'HelloWorld.xcodeproj', 'project.pbxproj'), 'utf8')).toContain('SceneDelegate.swift in Sources');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('runs the registered file mod without changing the plist masks or AppDelegate', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'openreader-duo-mod-'));
    try {
      mkdirSync(join(directory, 'OpenReader'));
      writeFileSync(join(directory, 'OpenReader', 'SceneDelegate.swift'), template);
      writeFileSync(join(directory, 'OpenReader', 'AppDelegate.swift'), 'upstream factory/lifecycle');
      const base = { name: 'OpenReader', slug: 'openreader', ios: { infoPlist: {
        UISupportedInterfaceOrientations: ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown'],
        'UISupportedInterfaceOrientations~ipad': ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationLandscapeLeft'],
      } } };
      const before = JSON.stringify(base.ios);
      const mod = (withDuoSceneOrientation(base) as ExportedConfig).mods?.ios?.dangerous;
      if (!mod) throw new Error('Missing iOS source mod');
      await mod({ ...base, modRawConfig: base, modResults: {}, modRequest: {
        projectRoot: resolve('.'), platformProjectRoot: directory, projectName: 'OpenReader',
        modName: 'dangerous', platform: 'ios', introspect: false,
      } });
      expect(JSON.stringify(base.ios)).toBe(before);
      expect(readFileSync(join(directory, 'OpenReader', 'AppDelegate.swift'), 'utf8')).toBe('upstream factory/lifecycle');
      expect(readFileSync(join(directory, 'OpenReader', 'SceneDelegate.swift'), 'utf8')).toContain('supportedInterfaceOrientations(for windowScene:');
    } finally { rmSync(directory, { recursive: true, force: true }); }
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
