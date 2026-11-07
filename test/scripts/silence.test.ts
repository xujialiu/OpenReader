import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('silence.sh and silence-observe.py fail closed (host-only Apple-tool doubles)', () => {
  const result = spawnSync('python3', ['test/scripts/silence_test.py'], {
    encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
}, 35_000);
