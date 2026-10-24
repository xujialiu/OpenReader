import { describe, expect, it } from 'vitest';

import { buildIdentity, type BuildVariant } from '../../build-variant';
import { inspectArtifact } from '../../scripts/build/artifact';

const source = '1.0.2 (13)-beta13';
function evidence(variant: BuildVariant) {
  const identity = buildIdentity(source, variant);
  return {
    plist: { CFBundleIdentifier: 'top.xujialiu.openreader', CFBundleShortVersionString: identity.version,
      CFBundleVersion: identity.buildNumber, OpenReaderBuildVariant: variant,
      ITSAppUsesNonExemptEncryption: false, UIDeviceFamily: [1, 2], UIRequiresFullScreen: false,
      NSMicrophoneUsageDescription: 'OpenReader does not record audio.', UIBackgroundModes: ['audio'] },
    bundle: Buffer.from(`${source}\nopenreader-variant:${variant}\n${identity.purchases ? 'OpenReaderStore top.xujialiu.openreader.trial top.xujialiu.openreader.unlock' : ''}`),
    nativeBinaryCount: 1,
    nativeStoreModules: identity.purchases ? ['OpenReader'] : [],
  };
}

describe('artifact identity and purchase footprint (#324)', () => {
  it.each(['formal', 'free', 'debug'] as const)('checks native and embedded evidence for %s', (variant) => {
    expect(inspectArtifact(source, variant, evidence(variant))).toMatchObject({ variant, nativeBinaryCount: 1 });
  });

  it('rejects a stale bundle, mixed JS identities and an uninspected native shell', () => {
    const free = evidence('free');
    expect(() => inspectArtifact(source, 'free', { ...free, bundle: Buffer.from('openreader-variant:free') })).toThrow(/APP_VERSION/);
    expect(() => inspectArtifact(source, 'free', { ...free, bundle: Buffer.concat([free.bundle, Buffer.from('openreader-variant:formal')]) })).toThrow(/JavaScript identity/);
    expect(() => inspectArtifact(source, 'free', { ...free, nativeBinaryCount: 0 })).toThrow(/Mach-O/);
  });

  it('rejects wrong native metadata even when the bundle role is correct', () => {
    const free = evidence('free');
    for (const [field, value] of Object.entries({ CFBundleIdentifier: 'demo', CFBundleShortVersionString: '1.0.1', CFBundleVersion: '13', OpenReaderBuildVariant: 'formal' })) {
      expect(() => inspectArtifact(source, 'free', { ...free, plist: { ...free.plist, [field]: value } }), field).toThrow();
    }
  });

  it.each(['free', 'debug'] as const)('rejects native, UI, controller and cache leakage into %s', (variant) => {
    const clean = evidence(variant);
    expect(() => inspectArtifact(source, variant, { ...clean, nativeStoreModules: ['OpenReader.debug.dylib'] })).toThrow(/Native purchase/);
    for (const token of ['OpenReaderStore', 'top.xujialiu.openreader.trial', 'top.xujialiu.openreader.unlock', 'purchase.json', 'purchase-debug.json', 'Restore Purchase', 'Start Free Trial']) {
      expect(() => inspectArtifact(source, variant, { ...clean, bundle: Buffer.concat([clean.bundle, Buffer.from(token)]) }), token).toThrow(/Purchase/);
    }
  });

  it('requires the formal copy to retain both sides of its real purchase capability', () => {
    const formal = evidence('formal');
    expect(() => inspectArtifact(source, 'formal', { ...formal, nativeStoreModules: [] })).toThrow(/Native purchase/);
    expect(() => inspectArtifact(source, 'formal', { ...formal, bundle: Buffer.from(`${source}\nopenreader-variant:formal`) })).toThrow(/Purchase JavaScript/);
  });
});
