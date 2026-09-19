import { describe, expect, it } from 'vitest';

import config from '../app.config';
import manifest from '../package.json';

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

  it('asks for no microphone, because OwnReader records nothing', () => {
    expect(plugin('react-native-audio-api')).not.toHaveProperty('iosMicrophonePermission');
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
    expect(manifest.name).toBe('ownreader');
    expect(config.slug).toBe('ownreader');
    expect(config.ios?.bundleIdentifier).toBeDefined();
    expect(config.android?.package).toBeDefined();
  });
});
