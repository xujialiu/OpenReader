import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';

const require = createRequire(import.meta.url);
const { installObserver } = require('./install-observer.cjs');
const { snapshotSources, ORIGINAL, EDITS } = require('./snapshot-accessor.cjs');
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
  const podProject = project.replaceAll('OpenReader', 'RNAudioAPI')
    .replace('/* End PBXBuildFile section */', 'A00000000000000000000010 /* AudioEngine.mm in Sources */ = {isa = PBXBuildFile; fileRef = A00000000000000000000011; };\n /* End PBXBuildFile section */')
    .replace('/* End PBXFileReference section */', 'A00000000000000000000011 = {isa = PBXFileReference; lastKnownFileType = sourcecode.cpp.objcpp; path = audioapi/ios/system/AudioEngine.mm; sourceTree = "<group>"; };\n /* End PBXFileReference section */')
    .replace('files = ();', 'files = (A00000000000000000000010 /* AudioEngine.mm in Sources */,);');
  write('ios/Pods/Pods.xcodeproj/project.pbxproj', podProject);
  write('ios/OpenReader/Info.plist', plist.build({ OpenReaderBuildVariant: variant,
    CFBundleShortVersionString: '1.0.4', CFBundleVersion: '32', unchanged: 'control' }));
  write('node_modules/react-native-audio-api/package.json', JSON.stringify({ version: '0.13.5' }));
  write('node_modules/expo/package.json', JSON.stringify({ version: '58.0.23' }));
  for (const path of ['src/playback/audio-graph.ts', 'patches/react-native-audio-api+0.13.5.patch',
    'node_modules/react-native-audio-api/ios/audioapi/ios/core/NativeAudioPlayer.m']) write(path, 'host fixture: ' + path);
  for (const extension of ['h', 'mm']) {
    const file = `node_modules/react-native-audio-api/ios/audioapi/ios/system/AudioEngine.${extension}`;
    write(file, readFileSync(resolve(__dirname, '../../../..', file), 'utf8'));
  }
  const tools = join(snapshot, 'test/manual-test/duo-verification/native-pcm');
  mkdirSync(tools, { recursive: true });
  for (const file of ['NativePCMObserver.mm', 'CaptureBuffer.hpp', 'install-observer.cjs', 'snapshot-accessor.cjs']) {
    cpSync(join(__dirname, file), join(tools, file));
  }
  return { snapshot, sourceRevision: revision, receiptPath: join(root, 'receipt.json'), optIn: '1' };
}

function treeHashes(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  function visit(directory: string, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = join(prefix, entry.name), file = join(directory, entry.name);
      if (entry.isSymbolicLink()) result[name] = 'link:' + readlinkSync(file);
      else if (entry.isDirectory()) { result[name] = 'directory'; visit(file, name); }
      else result[name] = hash(readFileSync(file));
    }
  }
  visit(root); return result;
}

describe('install-observer opt-in isolation (HOST ONLY)', () => {
  it.each(['pbx', 'plist', 'source-parent'])('rejects %s symlink escape before ANY target file changes', (kind) => {
    const options = fixture();
    const root = dirname(options.snapshot), ordinary = join(root, 'ordinary-fixture');
    mkdirSync(ordinary);
    writeFileSync(join(ordinary, '.git'), 'HOST fake ordinary project; no real checkout touched');
    const pbx = join(options.snapshot, 'ios/OpenReader.xcodeproj/project.pbxproj');
    const info = join(options.snapshot, 'ios/OpenReader/Info.plist');
    if (kind === 'source-parent') {
      // Keep Info.plist separately owned, so only the source-destination parent
      // guard (not the plist guard) can prevent this redirect.
      const metadata = join(options.snapshot, 'ios/Metadata');
      mkdirSync(metadata); cpSync(info, join(metadata, 'Info.plist'));
      writeFileSync(pbx, readFileSync(pbx, 'utf8').replaceAll('OpenReader/Info.plist', 'Metadata/Info.plist'));
      const parent = dirname(info), redirected = join(ordinary, 'OpenReader');
      cpSync(parent, redirected, { recursive: true });
      rmSync(parent, { recursive: true }); symlinkSync(redirected, parent);
    } else {
      const target = kind === 'pbx' ? pbx : info;
      const redirected = join(ordinary, kind === 'pbx' ? 'project.pbxproj' : 'Info.plist');
      cpSync(target, redirected); rmSync(target); symlinkSync(redirected, target);
    }
    const before = treeHashes(root);
    let refusal: unknown;
    try { installObserver(options); } catch (error) { refusal = error; }
    expect(treeHashes(root)).toEqual(before);
    expect(refusal).toBeInstanceOf(Error);
    expect(String(refusal)).toContain('owned external');
  });
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
    expect(result.build.testBuildSnapshot.originalSHA256).toEqual(ORIGINAL);
    const engine = 'node_modules/react-native-audio-api/ios/audioapi/ios/system/AudioEngine.mm';
    const patched = readFileSync(join(options.snapshot, engine), 'utf8');
    expect(hash(patched)).toBe(result.build.testBuildSnapshot.patchedSHA256.source);
    expect(patched).toContain('std::scoped_lock lock(owner->_engineLock)');
    expect(hash(readFileSync(resolve(__dirname, '../../../..', engine)))).toBe(ORIGINAL.source);
    const pods = xcode.project(join(options.snapshot, 'ios/Pods/Pods.xcodeproj/project.pbxproj'));
    pods.parseSync();
    const flags = Object.entries(pods.pbxBuildFileSection()).filter(([key]) => !key.endsWith('_comment'));
    expect(flags).toHaveLength(1);
    expect(flags[0][1]).toMatchObject({ settings: { COMPILER_FLAGS: '"-DOPENREADER_PCM_TEST_ONLY=1"' } });
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
  it('holds external source drift or missing Pod layout before writing source/project changes', () => {
    for (const change of ['source', 'pod-target']) {
      const options = fixture();
      const engine = join(options.snapshot, 'node_modules/react-native-audio-api/ios/audioapi/ios/system/AudioEngine.mm');
      const appProject = join(options.snapshot, 'ios/OpenReader.xcodeproj/project.pbxproj');
      const beforeProject = hash(readFileSync(appProject));
      if (change === 'source') writeFileSync(engine, readFileSync(engine, 'utf8') + '\n');
      else {
        const podFile = join(options.snapshot, 'ios/Pods/Pods.xcodeproj/project.pbxproj');
        writeFileSync(podFile, readFileSync(podFile, 'utf8').replaceAll('RNAudioAPI', 'unexpected-layout'));
      }
      const beforeEngine = hash(readFileSync(engine));
      expect(() => installObserver(options)).toThrow(change === 'source' ? 'source/version/layout mismatch' : 'RNAudioAPI Pod target');
      expect(hash(readFileSync(engine))).toBe(beforeEngine);
      expect(hash(readFileSync(appProject))).toBe(beforeProject);
      expect(existsSync(options.receiptPath)).toBe(false);
    }
  });
  it('refuses shared dependency symlinks rather than patching the checkout installation', () => {
    const options = fixture();
    const library = join(options.snapshot, 'node_modules/react-native-audio-api');
    rmSync(library, { recursive: true });
    symlinkSync(resolve(__dirname, '../../../../node_modules/react-native-audio-api'), library);
    expect(() => installObserver(options)).toThrow('no shared dependency symlink');
    expect(existsSync(options.receiptPath)).toBe(false);
  });
  it('adds only guarded snapshot/publication code, with retained owner + engine and unlock before return/tap', () => {
    const base = resolve(__dirname, '../../../../node_modules/react-native-audio-api/ios/audioapi/ios/system/AudioEngine');
    const header = readFileSync(base + '.h', 'utf8');
    const source = readFileSync(base + '.mm', 'utf8');
    const patched = snapshotSources(header, source);
    expect(patched.source).toContain('static __weak AudioEngine *ORPCMTestSnapshotOwner = nil');
    expect(patched.source).toContain('__attribute__((objc_precise_lifetime)) AudioEngine *owner = ORPCMTestSnapshotOwner;');
    expect(patched.source).toContain('__attribute__((objc_precise_lifetime)) AVAudioEngine *snapshot = nil;');
    expect(patched.source).toMatch(/std::scoped_lock lock\(owner->_engineLock\);\s+snapshot = owner.audioEngine;\s+}\s+\/\/[^\n]+\s+return snapshot;/);
    expect(patched.source).toContain('#if !__has_feature(objc_arc)');
    for (const [kind, original] of [['header', header], ['source', source]] as const) {
      let restored = patched[kind];
      for (const [before, after] of [...EDITS[kind]].reverse()) restored = restored.replace(after, before);
      expect(restored).toBe(original); // every production method/statement is otherwise byte-identical
    }
    expect(() => snapshotSources(header, source + '\n')).toThrow('source/version/layout mismatch');
  });
  it('binds arm to a retained description token rather than pointer strings alone', () => {
    const native = readFileSync(join(__dirname, 'NativePCMObserver.mm'), 'utf8');
    expect(native).toContain('AVAudioEngine *_describedEngine;');
    expect(native).toContain('AVAudioSourceNode *_describedSource;');
    expect(native).toContain('descriptionToken');
    expect(native).toContain('currentEngine != _describedEngine');
    expect(native).toContain('[self soleSource:currentEngine] != _describedSource');
    expect(native).toContain('descriptionState->invalidate()');
    expect(native).not.toContain('![[self describe] isEqual:description]');
    const describeSource = native.slice(native.indexOf('- (NSDictionary *)describe {'), native.indexOf('- (NSDictionary *)arm:'));
    expect(describeSource.indexOf('addObserverForName')).toBeLessThan(describeSource.indexOf('_describedEngine = [AudioEngine'));
    expect(describeSource).toContain('@"validForSeconds": @5');
    const armSource = native.slice(native.indexOf('- (NSDictionary *)arm:'), native.indexOf('- (void)removeGraphObservers {'));
    expect(armSource.indexOf('_configurationObserver =')).toBeLessThan(armSource.indexOf('_descriptionState->consume('));
    expect(armSource.indexOf('_descriptionState->consume(')).toBeLessThan(armSource.indexOf('installTapOnBus:0'));
    expect(armSource).not.toContain('[self describe]');
  });
  it('uses a bounded borrowed public-getter adapter, not an owning Objective-C RT temporary', () => {
    const native = readFileSync(join(__dirname, 'NativePCMObserver.mm'), 'utf8');
    expect(native).toContain('AVAudioFormat *__unsafe_unretained actualFormat');
    expect(native).toContain('const AVAudioFrameCount frames = pcm.frameLength;');
    expect(native).toContain('ORPCMCopyPublicTap(*storage, pcm, when, expectedASBD)');
    expect(native).not.toContain('AVAudioFormat *format = pcm.format;');
    const adapter = native.slice(native.indexOf('static void ORPCMCopyPublicTap('), native.indexOf('static NSString *const ORPCMSchema'));
    expect(adapter.match(/\b(?:pcm|when|actualFormat)\.\w+/g)?.sort()).toEqual([
      'actualFormat.streamDescription', 'pcm.audioBufferList', 'pcm.format', 'pcm.frameLength',
      'when.hostTime', 'when.hostTimeValid', 'when.sampleRate', 'when.sampleTime', 'when.sampleTimeValid',
    ].sort());
    expect(adapter).not.toMatch(/\b(?:retain|release|autorelease|alloc|new|NSLog|dispatch|printf|fwrite|mutex|lock|shared_ptr)\b/);
    expect(adapter).not.toMatch(/\[(?:self|NSString|NSArray|NSDictionary|AVAudioEngine)\b/);
  });
  it('uses only the verified public selector, nil connected-bus format and fixed expiring command protocol', () => {
    const native = readFileSync(join(__dirname, 'NativePCMObserver.mm'), 'utf8');
    expect(native).toContain('#if TARGET_OS_SIMULATOR && DEBUG && OPENREADER_PCM_TEST_ONLY');
    expect(native).toContain('installTapOnBus:0');
    expect(native).toContain('format:nil error:&error block:');
    expect(native).toContain('expected.sampleRate * .1');
    expect(native).toContain('systemUptime + 120');
    expect(native).toContain('if (!lease) return;');
    expect(native).toContain('[AudioEngine or_pcmTestEngineSnapshot]');
    expect(native).toContain('OpenReaderAudioTrace');
    expect(native).not.toMatch(/AudioEngine\.sharedInstance|_owner|owner\.audioEngine/);
    expect(native).not.toMatch(/\b(?:NSLog|printf|eval|method_exchangeImplementations|setActive|setCategory|setVolume|startAndReturnError)\s*\(/);
    expect(native).not.toMatch(/\[\s*_engine\s+(?:stop|reset|pause|start)/);
  });
});
