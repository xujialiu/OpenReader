#!/usr/bin/env node
/* global __dirname */
// Post-prebuild, opt-in only. This edits ONLY a generated project in a private
// external source snapshot; normal Expo config and all worktree ios/ stay out.
const { Buffer } = require('node:buffer');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const xcode = require('xcode');
const plist = require('@expo/plist').default;
const { snapshotSources, snapshotBuildFlag } = require('./snapshot-accessor.cjs');

const SCHEMA = 'OpenReaderNativePCM-v1';
const FILES = ['NativePCMObserver.mm', 'CaptureBuffer.hpp'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const unquote = value => String(value).replace(/^"|"$/g, '');
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
const canonical = file => fs.existsSync(file) ? fs.realpathSync(file)
  : path.join(canonical(path.dirname(file)), path.basename(file));
function inCheckout(directory) {
  for (;;) {
    if (fs.existsSync(path.join(directory, '.git'))) return true;
    const parent = path.dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
}

function ownedExisting(root, file) {
  const actual = fs.realpathSync(file);
  if (!inside(root, actual) || inCheckout(actual)) throw new Error('Write target must be owned external snapshot content');
  return actual;
}
function mustBeNew(file) {
  try { fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('New owned external destination required');
}

function installObserver({ snapshot, sourceRevision, receiptPath, optIn = process.env.OPENREADER_NATIVE_PCM_OBSERVER }) {
  // Absence is a strict no-op: not even mkdir/read/stat against the project.
  if (optIn === undefined || optIn === '0') return { enabled: false, modified: false };
  if (optIn !== '1') throw new Error('OPENREADER_NATIVE_PCM_OBSERVER must be absent, 0 or exactly 1');
  if (!/^[a-f0-9]{40}$/.test(sourceRevision ?? '')) throw new Error('An exact committed source revision is required');
  const root = fs.realpathSync(snapshot);
  if (inCheckout(root)) {
    throw new Error('Use an external source archive, never a checkout or its ordinary generated ios/');
  }
  const receipt = canonical(path.resolve(receiptPath));
  if (inside(root, receipt) || fs.existsSync(receipt) || inCheckout(receipt)) throw new Error('Receipt must be a new external file outside the snapshot');
  mustBeNew(receipt);
  const ios = fs.realpathSync(path.join(root, 'ios'));
  if (!inside(root, ios)) throw new Error('Generated ios/ must not be a symlink outside the snapshot');
  const names = fs.readdirSync(ios).filter(name => name.endsWith('.xcodeproj'));
  if (names.length !== 1) throw new Error('Expected exactly one generated Xcode project');
  const requestedProject = path.join(ios, names[0], 'project.pbxproj');
  const projectFile = ownedExisting(ios, requestedProject);
  const beforeProject = fs.readFileSync(projectFile);
  const project = xcode.project(projectFile); project.parseSync();
  const targets = Object.entries(project.pbxNativeTargetSection()).filter(([key, target]) =>
    !key.endsWith('_comment') && unquote(target.productType) === 'com.apple.product-type.application');
  if (targets.length !== 1) throw new Error('Expected exactly one application target');
  const [targetID, target] = targets[0];
  const list = project.pbxXCConfigurationList()[target.buildConfigurationList];
  const configs = list.buildConfigurations.map(entry => project.pbxXCBuildConfigurationSection()[typeof entry === 'string' ? entry : entry.value]);
  if (!configs.length || configs.some(config => !config?.buildSettings)) throw new Error('Missing target build configurations');
  const infoPaths = new Set(configs.map(config => unquote(config.buildSettings.INFOPLIST_FILE)));
  if (infoPaths.size !== 1) throw new Error('Application configurations must share one generated Info.plist');
  const requestedInfo = path.resolve(ios, [...infoPaths][0]);
  const infoFile = ownedExisting(ios, requestedInfo);
  const beforeInfo = fs.readFileSync(infoFile);
  const info = plist.parse(beforeInfo.toString());
  if (info.OpenReaderBuildVariant !== 'debug') throw new Error('Formal/free capture is forbidden, even with opt-in');
  if (info.OpenReaderNativePCMObserver || beforeProject.includes(Buffer.from('NativePCMObserver'))) {
    throw new Error('Already instrumented or stale project: regenerate a fresh external snapshot');
  }
  const audioRoot = fs.realpathSync(path.join(root, 'node_modules/react-native-audio-api'));
  if (!inside(root, audioRoot)) throw new Error('Diagnostic snapshot must own its installed Audio API; no shared dependency symlink');
  if (JSON.parse(fs.readFileSync(path.join(audioRoot, 'package.json'))).version !== '0.13.5') {
    throw new Error('This observer must be re-reviewed against a changed Audio API version');
  }
  if (!JSON.parse(fs.readFileSync(path.join(root, 'node_modules/expo/package.json'))).version.startsWith('58.')) {
    throw new Error('Keep the installed SDK58; no diagnostic downgrade');
  }
  const fingerprints = {};
  for (const file of ['src/playback/audio-graph.ts', 'patches/react-native-audio-api+0.13.5.patch',
    'node_modules/react-native-audio-api/ios/audioapi/ios/system/AudioEngine.h',
    'node_modules/react-native-audio-api/ios/audioapi/ios/system/AudioEngine.mm',
    'node_modules/react-native-audio-api/ios/audioapi/ios/core/NativeAudioPlayer.m']) {
    fingerprints[file] = hash(fs.readFileSync(path.join(root, file)));
  }
  const toolDirectory = path.join(root, 'test/manual-test/duo-verification/native-pcm');
  for (const file of [...FILES, 'install-observer.cjs', 'snapshot-accessor.cjs']) {
    fingerprints[file] = hash(fs.readFileSync(path.join(toolDirectory, file)));
    if (fingerprints[file] !== hash(fs.readFileSync(path.join(__dirname, file)))) {
      throw new Error('Installer and archived observer must be from the same final source revision');
    }
  }
  const requestedHeader = path.join(audioRoot, 'ios/audioapi/ios/system/AudioEngine.h');
  const requestedEngine = path.join(audioRoot, 'ios/audioapi/ios/system/AudioEngine.mm');
  const headerFile = ownedExisting(audioRoot, requestedHeader);
  const engineFile = ownedExisting(audioRoot, requestedEngine);
  const snapshotPatch = snapshotSources(fs.readFileSync(headerFile), fs.readFileSync(engineFile));
  const requestedPods = path.join(ios, 'Pods/Pods.xcodeproj/project.pbxproj');
  const podsFile = ownedExisting(ios, requestedPods);
  const beforePods = fs.readFileSync(podsFile);
  const pods = xcode.project(podsFile); pods.parseSync();
  const sourceBuildFlag = snapshotBuildFlag(pods);
  const afterPods = pods.writeSync();
  const build = { schema: SCHEMA, testOnly: true, variant: 'debug', optIn: 'OPENREADER_NATIVE_PCM_OBSERVER=1',
    sourceRevision, requiredSDK: 'iOS Simulator 27+', compileGate: 'TARGET_OS_SIMULATOR && DEBUG && OPENREADER_PCM_TEST_ONLY', fingerprints,
    testBuildSnapshot: { ...snapshotPatch.manifest, sourceBuildFlag, beforePodsSHA256: hash(beforePods), afterPodsSHA256: hash(afterPods) } };
  const name = unquote(target.name);
  const group = project.findPBXGroupKey({ name }) ?? project.findPBXGroupKey({ path: name });
  if (!group) throw new Error('Expected the generated application source group');
  const requestedParent = path.join(ios, name);
  const sourceParent = ownedExisting(ios, requestedParent);
  const destination = path.join(sourceParent, 'NativePCMObserver');
  mustBeNew(destination);
  if (!project.addSourceFile('NativePCMObserver/NativePCMObserver.mm',
    { target: targetID, compilerFlags: '-DOPENREADER_PCM_TEST_ONLY=1 -std=c++17' }, group) ||
      !project.addHeaderFile('NativePCMObserver/CaptureBuffer.hpp', {}, group)) {
    throw new Error('Cannot register isolated observer source/header');
  }
  info.OpenReaderNativePCMObserver = build;
  const afterProject = project.writeSync();
  const afterInfo = plist.build(info);
  // Revalidate every existing write target and destination parent after all
  // parsing/preparation, before ANY filesystem write. The snapshot must remain
  // exclusively owned (this is not an adversarial concurrent-path sandbox).
  const writeTargets = [[root, path.join(root, 'ios'), ios], [ios, requestedProject, projectFile],
    [ios, requestedInfo, infoFile], [ios, requestedPods, podsFile],
    [audioRoot, requestedHeader, headerFile], [audioRoot, requestedEngine, engineFile],
    [ios, requestedParent, sourceParent]];
  for (const [owner, requested, expected] of writeTargets) {
    if (ownedExisting(owner, requested) !== expected) throw new Error('Changed owned external write target');
  }
  if (canonical(path.resolve(receiptPath)) !== receipt || inCheckout(path.dirname(receipt))) {
    throw new Error('Changed owned external receipt parent');
  }
  mustBeNew(destination); mustBeNew(receipt);
  fs.mkdirSync(path.dirname(receipt), { recursive: true, mode: 0o700 });
  fs.mkdirSync(destination, { mode: 0o700 });
  for (const file of FILES) fs.copyFileSync(path.join(toolDirectory, file), path.join(destination, file), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(headerFile, snapshotPatch.header);
  fs.writeFileSync(engineFile, snapshotPatch.source);
  fs.writeFileSync(podsFile, afterPods);
  fs.writeFileSync(projectFile, afterProject);
  fs.writeFileSync(infoFile, afterInfo);
  const result = { enabled: true, modified: true, build, sourceFiles: FILES,
    before: { projectSHA256: hash(beforeProject), infoSHA256: hash(beforeInfo) },
    after: { projectSHA256: hash(afterProject), infoSHA256: hash(afterInfo) },
    qualification: 'NOT_COMPILED_OR_RUN; actual SDK/header/link/load and default-absence artifacts need ios-tester',
    cleanup: 'Discard this external generated snapshot; never reuse its native product for ordinary Debug delivery' };
  fs.writeFileSync(receipt, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return result;
}

if (require.main === module) {
  try {
    const [snapshot, sourceRevision, receiptPath] = process.argv.slice(2);
    const result = installObserver({ snapshot, sourceRevision, receiptPath });
    // No samples, content, paths or settings in stdout; full receipt is private.
    console.log(JSON.stringify({ enabled: result.enabled, modified: result.modified }));
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
module.exports = { installObserver, SCHEMA };
