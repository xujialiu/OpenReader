import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import { buildIdentity, type BuildVariant } from '../../build-variant';
import { isPurchaseSource } from './metro-resolution';

interface ArtifactEvidence {
  readonly plist: Record<string, unknown>;
  readonly bundle: Buffer;
  readonly nativeBinaryCount: number;
  readonly nativeStoreModules: readonly string[];
}

const STORE_STRINGS = ['OpenReaderStore', 'top.xujialiu.openreader.trial', 'top.xujialiu.openreader.unlock'];

/** Production bytecode and its source map must agree on one purchase policy. */
export function inspectBundle(versionLine: string, variant: BuildVariant, bundle: Buffer, sources?: readonly string[], root = process.cwd()) {
  const identity = buildIdentity(versionLine, variant);
  const require = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
  require(bundle.includes(versionLine), 'The embedded bundle does not contain the current APP_VERSION.');
  for (const role of ['formal', 'free', 'debug'] as const) {
    require(bundle.includes(`openreader-variant:${role}`) === (role === variant), `Embedded JavaScript identity is not exclusively ${variant}.`);
  }
  for (const token of STORE_STRINGS) {
    require(bundle.includes(token) === identity.purchases, `Purchase JavaScript '${token}' must be ${identity.purchases ? 'present' : 'absent'} in ${variant}.`);
  }
  if (!identity.purchases) {
    for (const token of ['purchase.json', 'purchase-debug.json', 'Restore Purchase', 'Start Free Trial']) {
      require(!bundle.includes(token), `Purchase UI/cache '${token}' leaked into ${variant}.`);
    }
  }
  const paidSources = (sources ?? []).filter(source => {
    const relative = source.startsWith(`${root}${path.sep}`) ? path.relative(root, source) : source.replace(/^\/+/, '');
    return isPurchaseSource(relative.split(path.sep).join('/'));
  });
  if (sources !== undefined) {
    require(sources.length > 0, 'The source map contains no modules.');
    require((paidSources.length > 0) === identity.purchases, 'Source map purchase graph does not match the build role.');
  }
  return { variant, embeddedVersion: versionLine, bytes: bundle.length, sourceMapChecked: sources !== undefined, paidSources };
}

/** Check evidence, not the shell switches used to request a build. No upload or data-container access. */
export function inspectArtifact(versionLine: string, variant: BuildVariant, evidence: ArtifactEvidence) {
  const identity = buildIdentity(versionLine, variant);
  const { plist, bundle, nativeBinaryCount, nativeStoreModules } = evidence;
  const require = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
  require(plist.CFBundleIdentifier === 'top.xujialiu.openreader', 'Wrong app identity.');
  require(plist.CFBundleShortVersionString === identity.version, 'Native Version does not match APP_VERSION.');
  require(plist.CFBundleVersion === identity.buildNumber, 'Native Build Number does not match the requested role.');
  require(plist.OpenReaderBuildVariant === variant, 'Native build variant does not match the requested role.');
  require(plist.ITSAppUsesNonExemptEncryption === false, 'Export-compliance declaration is missing.');
  require(JSON.stringify(plist.UIDeviceFamily) === '[1,2]', 'iPhone/iPad device families changed.');
  require(plist.UIRequiresFullScreen === false, 'Resizable iPad/Mac support is missing.');
  require(typeof plist.NSMicrophoneUsageDescription === 'string' && plist.NSMicrophoneUsageDescription.length > 0, 'Required microphone purpose string is missing.');
  require(Array.isArray(plist.UIBackgroundModes) && plist.UIBackgroundModes.includes('audio'), 'Background audio mode is missing.');
  require(nativeBinaryCount > 0, 'No Mach-O binary was inspected.');
  require((nativeStoreModules.length > 0) === identity.purchases, `Native purchase module must be ${identity.purchases ? 'present' : 'absent'} in ${variant}.`);
  inspectBundle(versionLine, variant, bundle);
  return { ...identity, nativeBinaryCount, nativeStoreModules: [...nativeStoreModules], embeddedVersion: versionLine };
}

/** Native code can live in the executable, a .debug.dylib or embedded frameworks. */
export function nativeEvidence(app: string) {
  const root = realpathSync(app);
  const visited = new Set<string>();
  const nativeFiles: string[] = [];
  const nativeStoreModules: string[] = [];
  const visit = (file: string) => {
    const real = realpathSync(file);
    const relative = path.relative(root, real);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Artifact symlink leaves the app: ${path.relative(root, file)}`);
    }
    if (visited.has(real)) return;
    visited.add(real);
    const stat = statSync(real);
    if (stat.isDirectory()) {
      for (const name of readdirSync(real)) visit(path.join(real, name));
    } else if (stat.isFile()) {
      const header = Buffer.alloc(4);
      const fd = openSync(real, 'r');
      let count: number;
      try { count = readSync(fd, header, 0, 4, 0); } finally { closeSync(fd); }
      if (count < 4 || ![0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(header.readUInt32BE(0))) return;
      nativeFiles.push(relative);
      if (readFileSync(real).includes('OpenReaderStore')) nativeStoreModules.push(relative);
    }
  };
  visit(root);
  return { nativeBinaryCount: nativeFiles.length, nativeStoreModules, nativeFiles };
}

export function verifyArtifact(app: string, versionLine: string, variant: BuildVariant) {
  const plist = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', path.join(app, 'Info.plist')], { encoding: 'utf8' })) as Record<string, unknown>;
  const native = nativeEvidence(app);
  if (typeof plist.CFBundleExecutable !== 'string' || !native.nativeFiles.includes(plist.CFBundleExecutable)) {
    throw new Error('The app executable is missing or was not inspected.');
  }
  return inspectArtifact(versionLine, variant, { plist, bundle: readFileSync(path.join(app, 'main.jsbundle')), ...native });
}
