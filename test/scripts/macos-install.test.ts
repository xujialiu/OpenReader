import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('Mac installer checks identity, platform, signing scope and explicit replacement permission without a device', () => {
  const result = spawnSync('python3', ['test/scripts/macos_install_test.py'], {
    encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
}, 35_000);
