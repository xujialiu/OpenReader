import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * ADR 0054: any module may write a Debug Log line, and the suite imports many
 * of them under Node, so the half of `src/debug/` they import holds no platform
 * import; `install.ts` holds it. eslint.config.js says so, and this checks that
 * it does, the way test/core/providers/import-boundary.test.ts checks ADR 0013.
 */
const eslint = new ESLint({ cwd: new URL('../../', import.meta.url).pathname });

async function restrictedImports(path: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path, warnIgnored: false });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message);
}

describe('ADR 0054: the Debug Log that call sites import runs under Node', () => {
  it('refuses React Native, Expo and the local native modules in the writer', async () => {
    for (const specifier of ['react-native', 'expo-file-system', '../../modules/open-reader-debug-log']) {
      const messages = await restrictedImports('src/debug/debug-log.ts', `import * as probe from '${specifier}';\nexport default probe;\n`);
      expect(messages, specifier).toHaveLength(1);
      expect(messages[0]).toContain('ADR 0054');
    }
  });

  it('lets install.ts hold the platform', async () => {
    expect(await restrictedImports('src/debug/install.ts', `import { AppState } from 'react-native';\nexport default AppState;\n`)).toEqual([]);
  });
});
