import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

// Real locks, process groups and CLI entries; Apple tools are test doubles.
// Each suite has its own HOME, so it never takes the real machine's iOS slot.
for (const file of ['ios_guard_test.py', 'ios_ready_test.py', 'run_probe_test.py']) {
  it(`host-only iOS guard: ${file}`, () => {
    const result = spawnSync('python3', [`test/scripts/${file}`], {
      encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
  }, 35_000);
}
