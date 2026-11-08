import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';

const require = createRequire(import.meta.url);
const { installObserver } = require('./install-observer.cjs');
const plist = require('@expo/plist').default;
const xcode = require('xcode');
const revision = '88bee0cb5f8857477fbd0f296c9d8d6b43065f65';
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

// A HOST-ONLY generated-project fixture, parsed/written by the real xcode and
// plist libraries. No Expo prebuild, CocoaPods, Apple frameworks or native tool.
const project = `// !$*UTF8*$!
{
 archiveVersion = 1; classes = {}; objectVersion = 46;
 objects = {
 /* Begin PBXBuildFile section */
 /* End PBXBuildFile section */
 /* Begin PBXFileReference section */
 A00000000000000000000001 = {isa = PBXFileReference; explicitFileType = wrapper.application; path = OpenReader.app; sourceTree = BUILT_PRODUCTS_DIR; };
 /* End PBXFileReference section */
 /* Begin PBXGroup section */
 A00000000000000000000002 = {isa = PBXGroup; children = (A00000000000000000000003,); sourceTree = "<group>"; };
 A00000000000000000000003 = {isa = PBXGroup; children = (); name = OpenReader; path = OpenReader; sourceTree = "<group>"; };
 /* End PBXGroup section */
 /* Begin PBXNativeTarget section */
 A00000000000000000000004 = {isa = PBXNativeTarget; buildConfigurationList = A00000000000000000000008; buildPhases = (A00000000000000000000005 /* Sources */,); buildRules = (); dependencies = (); name = OpenReader; productName = OpenReader; productReference = A00000000000000000000001; productType = "com.apple.product-type.application"; };
 /* End PBXNativeTarget section */
 /* Begin PBXProject section */
 A00000000000000000000006 = {isa = PBXProject; buildConfigurationList = A00000000000000000000008; compatibilityVersion = "Xcode 3.2"; mainGroup = A00000000000000000000002; targets = (A00000000000000000000004,); };
 /* End PBXProject section */
 /* Begin PBXSourcesBuildPhase section */
 A00000000000000000000005 /* Sources */ = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
 /* End PBXSourcesBuildPhase section */
 /* Begin XCBuildConfiguration section */
 A00000000000000000000007 = {isa = XCBuildConfiguration; buildSettings = { INFOPLIST_FILE = OpenReader/Info.plist; }; name = Debug; };
 A00000000000000000000009 = {isa = XCBuildConfiguration; buildSettings = { INFOPLIST_FILE = OpenReader/Info.plist; }; name = Release; };
 /* End XCBuildConfiguration section */
 /* Begin XCConfigurationList section */
 A00000000000000000000008 = {isa = XCConfigurationList; buildConfigurations = (A00000000000000000000007, A00000000000000000000009,); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };
 /* End XCConfigurationList section */
 }; rootObject = A00000000000000000000006;
}
`;

function fixture(variant = 'debug') {
  const root = mkdtempSync(join(tmpdir(), 'openreader-pcm-installer-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const snapshot = join(root, 'snapshot');
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(snapshot, path)), { recursive: true });
    writeFileSync(join(snapshot, path), text);
  };
  write('ios/OpenReader.xcodeproj/project.pbxproj', project);
  write('ios/OpenReader/Info.plist', plist.build({ OpenReaderBuildVariant: variant,
    CFBundleShortVersionString: '1.0.4', CFBundleVersion: '32', unchanged: 'control' }));
  write('node_modules/react-native-audio-api/package.json', JSON.stringify({ version: '0.13.5' }));
  write('node_modules/expo/package.json', JSON.stringify({ version: '58.0.23' }));
  for (const path of ['src/playback/audio-graph.ts', 'patches/react-native-audio-api+0.13.5.patch',
    'node_modules/react-native-audio-api/ios/audioapi/ios/system/AudioEngine.h',
    'node_modules/react-native-audio-api/ios/audioapi/ios/core/NativeAudioPlayer.m']) write(path, 'host fixture: ' + path);
  const tools = join(snapshot, 'test/manual-test/duo-verification/native-pcm');
  mkdirSync(tools, { recursive: true });
  for (const file of ['NativePCMObserver.mm', 'CaptureBuffer.hpp', 'install-observer.cjs']) {
    cpSync(join(__dirname, file), join(tools, file));
  }
  return { snapshot, sourceRevision: revision, receiptPath: join(root, 'receipt.json'), optIn: '1' };
}

describe('install-observer opt-in isolation (HOST ONLY)', () => {
  it('does absolutely nothing when absent/0, including for nonexistent project paths', () => {
    for (const optIn of [undefined, '0']) {
      expect(installObserver({ snapshot: '/nonexistent/never-touch', optIn })).toEqual({ enabled: false, modified: false });
    }
  });
  it('keeps default configuration and production source undiscovering the observer even if the env is set', () => {
    const root = resolve(__dirname, '../../../..');
    for (const file of ['app.config.ts', 'package.json', 'index.ts', 'src/playback/audio-graph.ts']) {
      const content = readFileSync(join(root, file), 'utf8');
      expect(content).not.toMatch(/NativePCMObserver|native-pcm|OPENREADER_NATIVE_PCM_OBSERVER/);
    }
  });
  it('denies formal/free before modifying any generated project or Info.plist', () => {
    for (const variant of ['formal', 'free']) {
      const options = fixture(variant);
      const file = join(options.snapshot, 'ios/OpenReader.xcodeproj/project.pbxproj');
      const before = hash(readFileSync(file));
      expect(() => installObserver(options)).toThrow('Formal/free');
      expect(hash(readFileSync(file))).toBe(before);
      expect(existsSync(options.receiptPath)).toBe(false);
    }
  });
  it('adds only the isolated generated source/header and private flags/receipt, not versions or playback', () => {
    const options = fixture();
    const graph = join(options.snapshot, 'src/playback/audio-graph.ts');
    const before = hash(readFileSync(graph));
    const result = installObserver(options);
    expect(result).toMatchObject({ enabled: true, build: { testOnly: true, variant: 'debug', sourceRevision: revision } });
    expect(result.before.projectSHA256).not.toBe(result.after.projectSHA256);
    const info = plist.parse(readFileSync(join(options.snapshot, 'ios/OpenReader/Info.plist'), 'utf8'));
    expect(info).toMatchObject({ CFBundleShortVersionString: '1.0.4', CFBundleVersion: '32', unchanged: 'control',
      OpenReaderNativePCMObserver: { compileGate: 'TARGET_OS_SIMULATOR && DEBUG && OPENREADER_PCM_TEST_ONLY' } });
    expect(hash(readFileSync(graph))).toBe(before);
    const generated = readFileSync(join(options.snapshot, 'ios/OpenReader/NativePCMObserver/NativePCMObserver.mm'));
    expect(generated.equals(readFileSync(join(__dirname, 'NativePCMObserver.mm')))).toBe(true);
    const file = join(options.snapshot, 'ios/OpenReader.xcodeproj/project.pbxproj');
    const parsed = xcode.project(file); parsed.parseSync();
    const buildFiles = Object.entries(parsed.pbxBuildFileSection()).filter(([key]) => !key.endsWith('_comment'));
    expect(buildFiles).toHaveLength(1);
    expect(buildFiles[0][1]).toMatchObject({ settings: { COMPILER_FLAGS: '"-DOPENREADER_PCM_TEST_ONLY=1 -std=c++17"' } });
    expect(() => installObserver({ ...options, receiptPath: options.receiptPath + '.again' })).toThrow('Already instrumented');
  });
  it('rejects a source checkout, in-tree receipt, unknown switch and mismatched archived tools', () => {
    expect(() => installObserver({ snapshot: resolve(__dirname, '../../../..'), sourceRevision: revision,
      receiptPath: '/tmp/unused-pcm-receipt', optIn: '1' })).toThrow('external source archive');
    expect(() => installObserver({ optIn: 'yes' })).toThrow('exactly 1');
    const options = fixture();
    expect(() => installObserver({ ...options, receiptPath: join(options.snapshot, 'receipt.json') })).toThrow('external file');
    writeFileSync(join(options.snapshot, 'test/manual-test/duo-verification/native-pcm/CaptureBuffer.hpp'), 'wrong revision');
    expect(() => installObserver(options)).toThrow('same final source revision');
    const nested = fixture();
    writeFileSync(join(dirname(nested.snapshot), '.git'), 'host-only parent-checkout marker');
    expect(() => installObserver(nested)).toThrow('external source archive');
  });
  it('uses only the verified public selector, nil connected-bus format and fixed expiring command protocol', () => {
    const native = readFileSync(join(__dirname, 'NativePCMObserver.mm'), 'utf8');
    expect(native).toContain('#if TARGET_OS_SIMULATOR && DEBUG && OPENREADER_PCM_TEST_ONLY');
    expect(native).toContain('installTapOnBus:0');
    expect(native).toContain('format:nil error:&error block:');
    expect(native).toContain('expected.sampleRate * .1');
    expect(native).toContain('systemUptime + 120');
    expect(native).toContain('if (!lease) return;');
    expect(native).not.toMatch(/\b(?:NSLog|printf|eval|method_exchangeImplementations|setActive|setCategory|setVolume|startAndReturnError)\s*\(/);
    expect(native).not.toMatch(/\[\s*_engine\s+(?:stop|reset|pause|start)/);
  });
});
