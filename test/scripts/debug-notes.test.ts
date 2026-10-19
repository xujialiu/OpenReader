import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

// The kit's Debug Note scripts (#305) over a Debug Log in a temporary folder; no device.
it('kit: debug-notes.py and debug-log-timeline.py --around', () => {
  const result = spawnSync('python3', ['test/scripts/debug_notes_test.py'], {
    encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
}, 35_000);
