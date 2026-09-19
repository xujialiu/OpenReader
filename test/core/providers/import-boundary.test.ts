import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * ADR 0013 says the provider layer is "kept in its own directory that imports
 * nothing from React Native and nothing from the playback layer", and gives
 * the reason: it is what makes extracting a shared package later "a move, not
 * an archaeological dig". A rule like that is discovered broken at exactly the
 * moment someone tries to make the move — years after the import that broke
 * it — unless something checks it continuously.
 *
 * eslint.config.js checks it. This checks eslint.config.js: it lints source
 * text against the real, on-disk configuration and asserts the rule fires
 * where the ADR says it must and stays quiet where it must not. Renaming the
 * providers directory, reordering the flat config so the override is shadowed,
 * or deleting the rule all fail here rather than passing silently.
 *
 * The files linted do not exist. `lintText` takes the path it should pretend
 * the text came from, which is what lets one test cover directories that are
 * still empty.
 */

const eslint = new ESLint({ cwd: new URL('../../../', import.meta.url).pathname });

/** Every `no-restricted-imports` message ESLint reports for `code` at `path`. */
async function restrictedImports(path: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path, warnIgnored: false });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message);
}

const PROVIDER = 'src/core/providers/probe.ts';

describe('the configuration this test lints against', () => {
  // First, so that a configuration that failed to load reports itself as that
  // rather than as a confusing count of zero messages below.
  it('resolves the override onto the providers directory', async () => {
    const resolved = (await eslint.calculateConfigForFile(PROVIDER)) as {
      rules?: Record<string, unknown[]>;
    };
    const rule = resolved.rules?.['no-restricted-imports'];
    expect(rule, 'eslint.config.js did not apply no-restricted-imports to ' + PROVIDER).toBeDefined();
    expect(JSON.stringify(rule)).toContain('ADR 0013');
  });
});

describe('ADR 0013: the provider layer imports nothing from React Native', () => {
  it('rejects react-native itself', async () => {
    const messages = await restrictedImports(PROVIDER, `import { Platform } from 'react-native';\nexport default Platform;\n`);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('ADR 0013');
    expect(messages[0]).toContain('imports nothing from React Native');
  });

  it('rejects the playback library, which is where a provider is most tempted to reach', async () => {
    // The temptation is real: react-native-audio-api is what turns PCM into
    // sound, and a provider that has just produced PCM is one import away
    // from playing it itself.
    const messages = await restrictedImports(
      PROVIDER,
      `import { AudioContext } from 'react-native-audio-api';\nexport default AudioContext;\n`,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('ADR 0013');
  });

  it('rejects a deep subpath, which is how the rule is usually got round', async () => {
    const messages = await restrictedImports(
      PROVIDER,
      `import { NativeModules } from 'react-native/Libraries/BatchedBridge/NativeModules';\nexport default NativeModules;\n`,
    );
    expect(messages).toHaveLength(1);
  });

  it('rejects a type-only import too, since a type from the platform is still a coupling', async () => {
    const messages = await restrictedImports(PROVIDER, `import type { ExpoConfig } from 'expo/config';\nexport type C = ExpoConfig;\n`);
    expect(messages).toHaveLength(1);
  });

  it('rejects expo-secure-store, because the key arrives as a setting (ADR 0002)', async () => {
    const messages = await restrictedImports(
      PROVIDER,
      `import { getItemAsync } from 'expo-secure-store';\nexport default getItemAsync;\n`,
    );
    expect(messages).toHaveLength(1);
  });

  it('rejects our own playback layer by relative path', async () => {
    const messages = await restrictedImports(
      PROVIDER,
      `import { engine } from '../../playback/engine';\nexport default engine;\n`,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('nothing from the playback layer');
  });

  it('rejects the renderer and the Now Playing module too', async () => {
    for (const specifier of ['../../renderer/bridge', '../../now-playing/ios', '../../keys/store']) {
      const messages = await restrictedImports(PROVIDER, `import x from '${specifier}';\nexport default x;\n`);
      expect(messages, specifier).toHaveLength(1);
    }
  });

  it('allows what a provider legitimately needs: the platform-free core beside it', async () => {
    const messages = await restrictedImports(
      PROVIDER,
      `import { wavDataLength } from '../wav';\nimport { withTimeout } from '../timeout';\nexport default [wavDataLength, withTimeout];\n`,
    );
    expect(messages).toEqual([]);
  });

  it('allows an injected fetch, which is the whole mechanism the ADR relies on', async () => {
    const messages = await restrictedImports(
      PROVIDER,
      `export type Deps = { fetch: typeof fetch; newRequestId: () => string };\nexport const make = (deps: Deps) => deps;\n`,
    );
    expect(messages).toEqual([]);
  });
});

describe('the rest of src/core is platform-free as well', () => {
  it('holds the segmenter and sync to the same rule', async () => {
    for (const path of ['src/core/segmenter/sentences.ts', 'src/core/sync/webdav.ts', 'src/core/document/id.ts']) {
      const messages = await restrictedImports(path, `import { Platform } from 'react-native';\nexport default Platform;\n`);
      expect(messages, path).toHaveLength(1);
      expect(messages[0], path).toContain('runs under Node');
    }
  });
});

describe('the rule is scoped, not global', () => {
  it('lets the playback layer import react-native-audio-api, which is its entire job', async () => {
    const messages = await restrictedImports(
      'src/playback/engine.ts',
      `import { AudioContext } from 'react-native-audio-api';\nexport default AudioContext;\n`,
    );
    expect(messages).toEqual([]);
  });

  it('lets the renderer import the WebView', async () => {
    const messages = await restrictedImports(
      'src/renderer/epub.ts',
      `import { WebView } from 'react-native-webview';\nexport default WebView;\n`,
    );
    expect(messages).toEqual([]);
  });
});
