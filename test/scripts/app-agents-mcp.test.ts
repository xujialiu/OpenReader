import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const configPath = '.mobilebuildmcp/config.yaml';
const config = readFileSync(new URL(`../../${configPath}`, import.meta.url), 'utf8');

// HOST configuration contracts only. Actual MCP tools/list parity and the
// configured app-agent startup need their separate registration-only smoke.
describe('portable app-agent MCP workflow configuration', () => {
  it('keeps the project configuration outside the local-artifact ignore rule', () => {
    const result = spawnSync('git', ['check-ignore', '--no-index', '--', configPath], {
      cwd: root, encoding: 'utf8', timeout: 5000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(1);
    expect(result.stdout).toBe('');
  });

  it('continues to ignore local automation artifacts and extra configuration', () => {
    const paths = ['.mobilebuildmcp/artifacts/test.log', '.mobilebuildmcp/config.local.yaml'];
    const result = spawnSync('git', ['check-ignore', '--no-index', '--', ...paths], {
      cwd: root, encoding: 'utf8', timeout: 5000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual(paths);
  });

  it('enables the same simulator, UI, debug and management workflows in fresh checkouts', () => {
    expect(config).toMatch(/^schemaVersion: 1$/m);
    const workflows = JSON.parse(config.match(/^enabledWorkflows:\s*(\[[^\n]+\])$/m)?.[1] ?? 'null');
    expect(workflows).toEqual(['simulator', 'ui-automation', 'debugging', 'simulator-management']);
    expect(config).toMatch(/^sentryDisabled: true$/m);
  });

  it('contains only portable project defaults, not a selected device or host path', () => {
    const defaults = config.split(/^sessionDefaults:\s*$/m)[1];
    expect(defaults).toBeDefined();
    expect(defaults?.trim().split('\n').map((line) => line.trim())).toEqual([
      'workspacePath: "./ios/OpenReader.xcworkspace"',
      'scheme: "OpenReader"',
      'bundleId: "top.xujialiu.openreader"',
    ]);
  });
});
