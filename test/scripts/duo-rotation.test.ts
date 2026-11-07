import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('distinguishes missing simulator input from a delivered event with an unrotated window', () => {
  const result = spawnSync('python3', ['test/scripts/duo_rotation_test.py'], {
    encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
});
