// External diagnostic build only. Never patch the checkout's installed package.
// Exact source hashes make an upstream/local layout change a blocking decision.
const { createHash } = require('node:crypto');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const unquote = value => String(value).replace(/^"|"$/g, '');
const GUARD = '#if defined(OPENREADER_PCM_TEST_ONLY) && TARGET_OS_SIMULATOR && DEBUG';
const ORIGINAL = {
  header: '04950f2514b3b6cf659c7cadbdc75900bc24597aa7dc148294ef2a3763fb4ef5',
  source: 'c2ac1fd676fc230ac156466b5d67a7c899eada74f890c6719b549663804d1eca',
};

const ACCESSOR = `${GUARD}
#if !__has_feature(objc_arc)
#error "Test-only PCM snapshot requires ARC zeroing-weak/strong retain semantics."
#endif
// A zeroing-weak load retains a strong owner before touching its instance mutex.
// Never load/retain the nonatomic production singleton to acquire this snapshot.
// Precise ARC lifetimes keep the owner/mutex alive through lock destruction.
static __weak AudioEngine *ORPCMTestSnapshotOwner = nil;

+ (AVAudioEngine *)or_pcmTestEngineSnapshot
{
  __attribute__((objc_precise_lifetime)) AudioEngine *owner = ORPCMTestSnapshotOwner;
  if (owner == nil) return nil;
  __attribute__((objc_precise_lifetime)) AVAudioEngine *snapshot = nil;
  {
    std::scoped_lock lock(owner->_engineLock);
    snapshot = owner.audioEngine;
  }
  // Existing library mutex is released before return and any AVAudioNode API.
  return snapshot;
}
#endif
`;
const PUBLISH = `${GUARD}
  if (self != nil) {
    std::scoped_lock lock(_engineLock);
    ORPCMTestSnapshotOwner = self;
  }
#endif
`;
const EDITS = {
  header: [
    ['#import <Foundation/Foundation.h>\n', '#import <Foundation/Foundation.h>\n#import <TargetConditionals.h>\n'],
    ['+ (instancetype)sharedInstance;\n', `+ (instancetype)sharedInstance;\n${GUARD}\n+ (AVAudioEngine *)or_pcmTestEngineSnapshot;\n#endif\n`],
  ],
  source: [
    ['static AudioEngine *_sharedInstance = nil;\n', `static AudioEngine *_sharedInstance = nil;\n\n${ACCESSOR}`],
    ['  _sharedInstance = self;\n  return self;\n', `  _sharedInstance = self;\n${PUBLISH}  return self;\n`],
  ],
};

function snapshotSources(header, source) {
  if (hash(header) !== ORIGINAL.header || hash(source) !== ORIGINAL.source) {
    throw new Error('Test snapshot source/version/layout mismatch; no unsafe accessor fallback');
  }
  const patched = { header: String(header), source: String(source) };
  for (const kind of ['header', 'source']) {
    for (const [before, after] of EDITS[kind]) {
      if (patched[kind].split(before).length !== 2) throw new Error('Test snapshot anchor is not unique');
      patched[kind] = patched[kind].replace(before, () => after);
    }
  }
  return { ...patched, manifest: { originalSHA256: ORIGINAL,
    patchedSHA256: { header: hash(patched.header), source: hash(patched.source) },
    patchSHA256: hash(JSON.stringify(EDITS)),
    guard: GUARD, accessor: 'or_pcmTestEngineSnapshot',
    lifetime: 'ARC zeroing-weak publication -> retained strong owner -> existing recursive mutex -> retained engine; unlock before tap',
    changes: 'Test-only weak publication and retained snapshot only; no graph/render/route/volume mutation' } };
}

function snapshotBuildFlag(project) {
  const targets = Object.entries(project.pbxNativeTargetSection()).filter(([key, target]) =>
    !key.endsWith('_comment') && unquote(target.name) === 'RNAudioAPI');
  if (targets.length !== 1) throw new Error('Expected one existing RNAudioAPI Pod target');
  const phase = project.pbxSourcesBuildPhaseObj(targets[0][0]);
  if (!phase) throw new Error('RNAudioAPI Sources build phase missing');
  const files = phase.files.map(entry => {
    const key = typeof entry === 'string' ? entry : entry.value;
    const build = project.pbxBuildFileSection()[key];
    const ref = project.pbxFileReferenceSection()[build?.fileRef];
    return { key, build, path: unquote(ref?.path) };
  }).filter(file => /(?:^|\/)AudioEngine\.mm$/.test(file.path));
  if (files.length !== 1) throw new Error('Expected one existing AudioEngine.mm source in RNAudioAPI');
  const file = files[0];
  const before = file.build.settings?.COMPILER_FLAGS ?? '""';
  if (typeof before !== 'string' || before.includes('OPENREADER_PCM_TEST_ONLY')) {
    throw new Error('Stale/unknown AudioEngine source build flags');
  }
  const after = JSON.stringify((unquote(before) + ' -DOPENREADER_PCM_TEST_ONLY=1').trim());
  file.build.settings = { ...file.build.settings, COMPILER_FLAGS: after };
  return { target: 'RNAudioAPI', file: file.path, beforeCompilerFlags: before, afterCompilerFlags: after,
    gate: 'Only the existing AudioEngine.mm source receives the opt-in macro; Simulator+Debug+ARC required in source' };
}

module.exports = { snapshotSources, snapshotBuildFlag, ORIGINAL, EDITS };
