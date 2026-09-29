import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * AGENTS.md, "Sub-worktrees": an agent's sub-worktrees live in `./.worktrees/`
 * of the worktree it runs in. Each is a whole checkout with its own
 * `node_modules` (about 840 MB), and each tool that walks this project must
 * leave them alone. Measured on 2026-09-29 with a sub-worktree holding a file
 * with a type error and a lint error: without its exclusion ESLint reported
 * the file (1 error), and Metro bundled `.worktrees/probe/index` (HTTP 200,
 * 10.3 MB) where with `metro.config.js` it answered 404. `tsc` needs nothing:
 * its default include skips directories whose names start with a dot, and a
 * tsconfig without the `.worktrees` exclusion still reported 0 errors.
 */
const root = path.resolve(__dirname, '..');
const inside = path.join(root, '.worktrees', 'some-task', 'src', 'app', 'shell.tsx');

describe('the sub-worktrees in ./.worktrees are outside this project', () => {
  it('are ignored by git', () => {
    // Exit status 0 means ignored; execFileSync throws otherwise.
    expect(() => execFileSync('git', ['check-ignore', '-q', '.worktrees/some-task/src/app/shell.tsx'], { cwd: root })).not.toThrow();
  });

  it('are not among the files tsc checks', async () => {
    const ts = (await import('typescript')).default;
    const directory = path.join(root, '.worktrees', `tsc-rule-${process.pid}`);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'probe.ts'), 'export const probe: number = 1;\n');
    try {
      const read = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
      expect(parsed.fileNames.some((file) => file.includes('/src/app/shell.tsx'))).toBe(true);
      // This project's own `.worktrees`, not any `/.worktrees/`: a sub-worktree's
      // checkout has that in every path of its own (found running this suite
      // inside one, 2026-09-29).
      const own = path.join(root, '.worktrees') + path.sep;
      expect(parsed.fileNames.filter((file) => path.resolve(file).startsWith(own))).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('are ignored by ESLint', async () => {
    const { ESLint } = await import('eslint');
    const eslint = new ESLint({ cwd: root });
    expect(await eslint.isPathIgnored(inside)).toBe(true);
    expect(await eslint.isPathIgnored(path.join(root, 'src', 'app', 'shell.tsx'))).toBe(false);
  });

  it('are blocked from Metro by this project, and only by this project', () => {
    const require = createRequire(import.meta.url);
    const config = require(path.join(root, 'metro.config.js')) as { resolver: { blockList: RegExp | RegExp[] } };
    const blocked = (file: string) => ([] as RegExp[]).concat(config.resolver.blockList).some((pattern) => pattern.test(file));
    // Absolute, as Metro resolves, and project-relative, as Expo's file map crawls.
    expect(blocked(inside)).toBe(true);
    expect(blocked('.worktrees')).toBe(true);
    expect(blocked(path.join(root, 'src', 'app', 'shell.tsx'))).toBe(false);
    // A sub-worktree running its own Metro has `/.worktrees/` in every path of
    // its own project, so the pattern is anchored at the root of the project
    // that loads it, not at any `.worktrees` directory.
    expect(blocked(path.join(path.dirname(root), 'another-checkout', '.worktrees', 'task', 'src', 'app', 'shell.tsx'))).toBe(false);
  });
});
