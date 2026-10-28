import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const owned = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const sibling = '11111111-2222-3333-4444-555555555555';
const script = resolve('test/manual-test/kit/owned-lldb.sh');
function check(pid: string, device: string, requested = owned) {
  const dir = mkdtempSync(join(tmpdir(), 'owned-lldb-'));
  try {
    const calls = join(dir, 'calls');
    const commands = join(dir, 'commands.lldb');
    writeFileSync(calls, ''); writeFileSync(commands, 'process detach\nquit\n');
    writeFileSync(join(dir, 'xcrun'), '#!/bin/bash\nprintf "%s\\n" "$*" >> "$CALLS"\nif [[ "$1" == simctl ]]; then printf "%s\\n" "$MOCK_LIST"; fi\n', { mode: 0o755 });
    writeFileSync(join(dir, 'ps'), '#!/bin/bash\nprintf "%s\\n" "$MOCK_BINARY"\n', { mode: 0o755 });
    const result = spawnSync('bash', [script, requested, commands], {
      encoding: 'utf8', timeout: 5000,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALLS: calls,
        MOCK_LIST: pid.split('\n').map((one) => `${one}\t0\tUIKitApplication:top.xujialiu.openreader[test][rb-legacy]`).join('\n'),
        MOCK_BINARY: `/Users/test/Library/Developer/CoreSimulator/Devices/${device}/data/Containers/Bundle/Application/test/OpenReader.app/OpenReader` },
    });
    return { ...result, calls: readFileSync(calls, 'utf8') };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
describe('owned-simulator LLDB target guard', () => {
  it('resolves the target within its simulator and attaches only after matching the executable path', () => {
    const result = check('123', owned);
    expect(result.status).toBe(0);
    expect(result.calls).toContain(`simctl spawn ${owned} launchctl list`);
    expect(result.calls).toContain('lldb --batch --attach-pid 123 --source');
  });
  it('refuses a PID whose executable belongs to a sibling simulator', () => {
    const result = check('123', sibling);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('does not belong');
    expect(result.calls).not.toContain('lldb');
  });
  it('refuses a missing/ambiguous PID or invalid device before attaching', () => {
    for (const pid of ['-', '0', '123\n456']) {
      const result = check(pid, owned);
      expect(result.status).toBe(2);
      expect(result.calls).not.toContain('lldb');
    }
    const invalid = check('123', owned, 'booted');
    expect(invalid.status).toBe(2);
    expect(invalid.calls).toBe('');
  });
});
