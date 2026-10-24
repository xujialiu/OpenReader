import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

import { APP_VERSION } from '../../app-version';
import { buildIdentity } from '../../build-variant';
import { inspectBundle, nativeEvidence } from '../../scripts/build/artifact';

const root = fileURLToPath(new URL('../../', import.meta.url));
const folders: string[] = [];
const temporary = () => { const dir = mkdtempSync(path.join(tmpdir(), 'openreader-artifact-')); folders.push(dir); return dir; };
const macho = (text = '') => Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.from(text)]);
afterEach(() => { for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('inspects framework and debug-dylib binaries once through internal symlinks', () => {
  const app = temporary();
  mkdirSync(path.join(app, 'Frameworks', 'Store.framework', 'Versions', 'A'), { recursive: true });
  writeFileSync(path.join(app, 'OpenReader'), macho());
  writeFileSync(path.join(app, 'OpenReader.debug.dylib'), macho());
  writeFileSync(path.join(app, 'Frameworks/Store.framework/Versions/A/Store'), macho('OpenReaderStore'));
  symlinkSync('A', path.join(app, 'Frameworks/Store.framework/Versions/Current'));
  symlinkSync('Versions/Current/Store', path.join(app, 'Frameworks/Store.framework/Store'));
  const result = nativeEvidence(app);
  expect(result.nativeBinaryCount).toBe(3);
  expect(result.nativeStoreModules).toEqual(['Frameworks/Store.framework/Versions/A/Store']);
});

it('rejects external symlinks instead of silently skipping an uninspected binary', () => {
  const app = temporary(), outside = temporary();
  writeFileSync(path.join(outside, 'Store'), macho('OpenReaderStore'));
  symlinkSync(path.join(outside, 'Store'), path.join(app, 'Store'));
  expect(() => nativeEvidence(app)).toThrow(/symlink leaves/);
});

it('checks the source inventory as well as purchase strings', () => {
  const bundle = Buffer.from(`${APP_VERSION} openreader-variant:free`);
  expect(inspectBundle(APP_VERSION, 'free', bundle, ['/src/app/purchase-free.ts']).sourceMapChecked).toBe(true);
  expect(() => inspectBundle(APP_VERSION, 'free', bundle, ['/src/purchase/products.ts'])).toThrow(/purchase graph/);
  expect(() => inspectBundle(APP_VERSION, 'free', bundle, [])).toThrow(/no modules/);
});

it('executes the bundle-check CLI through a symlink and returns a nonempty result or a nonzero failure', () => {
  const dir = temporary();
  const bundle = path.join(dir, 'main.jsbundle');
  writeFileSync(bundle, `${APP_VERSION} openreader-variant:free`);
  writeFileSync(`${bundle}.map`, JSON.stringify({ sources: ['/src/app/purchase-free.ts'] }));
  const entry = path.join(dir, 'check-bundle.ts');
  symlinkSync(path.join(root, 'scripts/verify-bundle.ts'), entry);
  const args = ['--require', 'tsx/cjs', entry, '--bundle', bundle, '--variant', 'free'];
  const result = JSON.parse(execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8' }));
  expect(result).toMatchObject({ variant: 'free', sourceMapChecked: true, paidSources: [] });
  writeFileSync(bundle, `${APP_VERSION} openreader-variant:formal`);
  const rejected = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  expect(rejected.status).not.toBe(0);
  expect(rejected.stderr).toContain('JavaScript identity');
});

it.skipIf(process.platform !== 'darwin')('executes the app verifier against a local fixture, including native metadata and the embedded bundle', () => {
  const dir = temporary(), app = path.join(dir, 'OpenReader.app');
  mkdirSync(app);
  const identity = buildIdentity(APP_VERSION, 'free');
  writeFileSync(path.join(app, 'Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict>
    <key>CFBundleIdentifier</key><string>top.xujialiu.openreader</string>
    <key>CFBundleExecutable</key><string>OpenReader</string>
    <key>CFBundleShortVersionString</key><string>${identity.version}</string>
    <key>CFBundleVersion</key><string>${identity.buildNumber}</string>
    <key>OpenReaderBuildVariant</key><string>free</string>
    <key>ITSAppUsesNonExemptEncryption</key><false/>
    <key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array>
    <key>UIRequiresFullScreen</key><false/>
    <key>NSMicrophoneUsageDescription</key><string>Not used.</string>
    <key>UIBackgroundModes</key><array><string>audio</string></array>
  </dict></plist>`);
  writeFileSync(path.join(app, 'OpenReader'), macho());
  writeFileSync(path.join(app, 'main.jsbundle'), `${APP_VERSION} openreader-variant:free`);
  const args = ['--require', 'tsx/cjs', 'scripts/verify-build.ts', '--app', app, '--variant', 'free'];
  expect(JSON.parse(execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8' }))).toMatchObject({ variant: 'free', nativeBinaryCount: 1 });
  writeFileSync(path.join(app, 'OpenReader.debug.dylib'), macho('OpenReaderStore'));
  const rejected = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  expect(rejected.status).not.toBe(0);
  expect(rejected.stderr).toContain('Native purchase module');
});
