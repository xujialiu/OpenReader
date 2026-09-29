// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

/**
 * The platform, in import-specifier form. `src/core/` may not reach any of it.
 *
 * These are matched against the text of the import, not against a resolved
 * path, which is why React Native's own subpaths and every `react-native-*`
 * package are listed separately.
 */
const PLATFORM = [
  'react',
  'react/**',
  'react-dom',
  'react-dom/**',
  'react-native',
  'react-native/**',
  'react-native-*',
  'react-native-*/**',
  '@react-native/**',
  '@react-native-community/**',
  '@epubjs-react-native/**',
  'expo',
  'expo/**',
  'expo-*',
  'expo-*/**',
  '@expo/**',
  // The local Expo module of ADR 0016 is native too.
  '**/modules/open-reader-now-playing',
  '**/modules/open-reader-now-playing/**',
];

/** The layers above core, by whatever relative path is used to reach them. */
const ABOVE_CORE = [
  '**/playback',
  '**/playback/**',
  '**/renderer',
  '**/renderer/**',
  '**/now-playing',
  '**/now-playing/**',
  '**/keys',
  '**/keys/**',
];

module.exports = defineConfig([
  expoConfig,

  { ignores: ['dist/*', 'ios/*', 'android/*', '.worktrees/'] },

  /**
   * ADR 0054. Any module may write a Debug Log line, the ones the suite runs
   * under Node included, so the half of `src/debug/` they import takes the
   * platform — the file system, the system log, AppState — as injected
   * dependencies. `install.ts` is the half that holds it, run once from
   * `launch.ts`. test/debug/import-boundary.test.ts checks this rule fires.
   */
  {
    files: ['src/debug/**/*.{ts,tsx}'],
    ignores: ['src/debug/install.ts', 'src/debug/launch.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...PLATFORM, '**/modules/**'],
              message:
                'ADR 0054: src/debug/ is imported by modules the suite runs under Node. Take the platform in install.ts and hand it to createDebugLog.',
            },
          ],
        },
      ],
    },
  },

  /**
   * `src/core/` is the part of OpenReader that runs under Node. That is not a
   * tidiness preference: it is what lets the Zotero-TTS plugin's provider
   * suite — about 3,200 lines driven entirely by fake `fetch` implementations
   * and injected dependencies — run here unchanged, and what keeps the
   * platform-free half of the app testable without a simulator.
   *
   * Anything the platform provides enters through an injected dependency, the
   * way `createProvider(id, settings, deps)` already takes
   * `{ fetch, getWebSocket, newRequestId, ... }`.
   */
  {
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: PLATFORM,
              message:
                'src/core/ runs under Node: no React, React Native or Expo imports. Take what you need as an injected dependency instead.',
            },
            {
              group: ABOVE_CORE,
              message: 'src/core/ may not import from the layers above it. Dependencies point inwards.',
            },
          ],
        },
      ],
    },
  },

  /**
   * ADR 0013, enforced: the provider layer is "kept in its own directory that
   * imports nothing from React Native and nothing from the playback layer".
   *
   * The ADR's reason for the rule is that it is what makes extracting a shared
   * package later "a move, not an archaeological dig". A rule nothing checks
   * would be found broken at exactly the moment that move is attempted, so it
   * is checked here and the check itself is tested — see
   * test/core/providers/import-boundary.test.ts, which fails if this override
   * ever stops firing.
   */
  {
    files: ['src/core/providers/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: PLATFORM,
              message:
                'ADR 0013: the provider layer imports nothing from React Native. Inject it (createProvider takes { fetch, getWebSocket, newRequestId, ... }).',
            },
            {
              group: ABOVE_CORE,
              message:
                'ADR 0013: the provider layer imports nothing from the playback layer. It returns PCM and a sample rate; what plays them is not its concern.',
            },
            {
              group: ['**/segmenter', '**/segmenter/**', '**/document', '**/document/**', '**/sync', '**/sync/**'],
              message:
                'ADR 0013: the provider layer answers to one contract — text in, PCM and word timings out. It knows nothing about documents, segmentation or sync.',
            },
          ],
        },
      ],
    },
  },
]);
