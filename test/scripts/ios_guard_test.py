"""Host-only process/lock regressions. No Xcode, simulator, or network calls."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
GUARD = ROOT / 'test/manual-test/kit/ios_guard.py'


def alive(pid):
    result = subprocess.run(['ps', '-o', 'stat=', '-p', str(pid)], capture_output=True, text=True)
    return result.returncode == 0 and result.stdout.strip() and not result.stdout.strip().startswith('Z')


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)
        self.env = dict(os.environ, HOME=str(self.path))
        self.env.pop('OPENREADER_IOS_SLOT', None)
        self.children = []

    def tearDown(self):
        for child in self.children:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
            if child.stdout:
                child.stdout.close()
            if child.stderr:
                child.stderr.close()
        self.temp.cleanup()

    def command(self, code, *options):
        return [sys.executable, str(GUARD), 'run', '--timeout', '15', '--grace', '0.2', *options,
                '--', sys.executable, '-c', code]

    def spawn(self, command, **kwargs):
        child = subprocess.Popen(command, env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, **kwargs)
        self.children.append(child)
        return child

    def wait_file(self, name):
        path = self.path / name
        until = time.monotonic() + 5
        while time.monotonic() < until:
            if path.exists():
                return path
            time.sleep(.01)
        self.fail(f'{name} was not created')

    def holder(self):
        return self.spawn(self.command(f"from pathlib import Path; import time; Path({str(self.path / 'ready')!r}).touch(); time.sleep(60)"))

    def test_exclusion_across_working_directories_and_release(self):
        holder = self.holder()
        self.wait_file('ready')
        other = self.path / 'other-worktree'
        other.mkdir()
        refused = subprocess.run(self.command('print("should not start")'), cwd=other, env=self.env, capture_output=True, text=True, timeout=3)
        self.assertEqual(refused.returncode, 75, refused.stderr)
        self.assertNotIn('should not start', refused.stdout)
        holder.terminate()
        holder.wait(timeout=3)
        accepted = subprocess.run(self.command('print("admitted")'), cwd=other, env=self.env, capture_output=True, text=True, timeout=3)
        self.assertEqual(accepted.returncode, 0, accepted.stderr)
        self.assertIn('admitted', accepted.stdout)

    def test_waiter_runs_only_after_the_holder_releases(self):
        holder = self.holder()
        self.wait_file('ready')
        waiter = self.spawn(self.command(f"from pathlib import Path; Path({str(self.path / 'second')!r}).touch()", '--wait', '4'))
        time.sleep(.1)
        self.assertFalse((self.path / 'second').exists())
        holder.terminate()
        holder.wait(timeout=3)
        self.assertEqual(waiter.wait(timeout=3), 0)
        self.assertTrue((self.path / 'second').exists())

    def test_nested_guard_does_not_deadlock(self):
        nested = self.command('print("nested")')
        result = subprocess.run(self.command(f'import subprocess; raise SystemExit(subprocess.call({nested!r}))'), env=self.env, capture_output=True, text=True, timeout=4)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('nested', result.stdout)

    def test_copied_token_cannot_bypass_another_process_owner(self):
        holder = self.holder()
        self.wait_file('ready')
        lock = self.path / 'Library/Caches/OpenReader/ios-verification.lock'
        token = json.loads(lock.read_text())['token']
        env = dict(self.env, OPENREADER_IOS_SLOT=token)
        result = subprocess.run(self.command('print("bypassed")'), env=env, capture_output=True, text=True, timeout=3)
        self.assertEqual(result.returncode, 75, result.stderr)
        self.assertNotIn('bypassed', result.stdout)
        holder.terminate()

    def process_tree(self, timeout='2'):
        pids = self.path / 'pids.json'
        grandchild = 'import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(60)'
        code = f'import os,json,subprocess,sys,time; from pathlib import Path; p=subprocess.Popen([sys.executable,"-c",{grandchild!r}]); Path({str(pids)!r}).write_text(json.dumps([os.getpid(),p.pid])); time.sleep(60)'
        return self.spawn(self.command(code, '--timeout', timeout, '--record', str(self.path / 'result.json')))

    def test_timeout_stops_descendants_and_preserves_unrelated_process(self):
        unrelated = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
        self.children.append(unrelated)
        job = self.process_tree()
        pids = json.loads(self.wait_file('pids.json').read_text())
        self.assertEqual(job.wait(timeout=4), 124)
        self.assertTrue(alive(unrelated.pid))
        self.assertTrue(all(not alive(pid) for pid in pids))
        record = json.loads((self.path / 'result.json').read_text())
        self.assertEqual(record['outcome'], 'timeout')
        self.assertEqual(record['exitCode'], 124)

    def test_sigterm_stops_the_owned_process_tree(self):
        job = self.process_tree('30')
        pids = json.loads(self.wait_file('pids.json').read_text())
        job.send_signal(signal.SIGTERM)
        self.assertEqual(job.wait(timeout=4), 143, job.stderr.read())
        self.assertTrue(all(not alive(pid) for pid in pids))

    def test_normal_exit_also_reaps_leftover_background_children(self):
        pid_file = self.path / 'background'
        code = f'import subprocess,sys; from pathlib import Path; p=subprocess.Popen([sys.executable,"-c","import time; time.sleep(60)"]); Path({str(pid_file)!r}).write_text(str(p.pid))'
        job = self.spawn(self.command(code))
        pid = int(self.wait_file('background').read_text())
        self.assertEqual(job.wait(timeout=3), 0, job.stderr.read())
        self.assertFalse(alive(pid))

    def test_outer_timeout_also_stops_a_nested_guard_and_its_job(self):
        pid_file = self.path / 'nested-pid'
        inner_code = f'import os,time,signal; from pathlib import Path; signal.signal(signal.SIGTERM, signal.SIG_IGN); Path({str(pid_file)!r}).write_text(str(os.getpid())); time.sleep(60)'
        inner = self.command(inner_code, '--timeout', '30')
        job = self.spawn(self.command(f'import subprocess; raise SystemExit(subprocess.call({inner!r}))', '--timeout', '2'))
        pid = int(self.wait_file('nested-pid').read_text())
        try:
            self.assertEqual(job.wait(timeout=4), 124, job.stderr.read())
            self.assertFalse(alive(pid))
        finally:
            if alive(pid):
                os.kill(pid, signal.SIGKILL)

    def test_nonzero_exit_is_not_reported_as_success(self):
        result = subprocess.run(self.command('raise SystemExit(65)', '--record', str(self.path / 'result.json')), env=self.env, capture_output=True, text=True, timeout=3)
        self.assertEqual(result.returncode, 65)
        self.assertEqual(json.loads((self.path / 'result.json').read_text())['outcome'], 'failed')


if __name__ == '__main__':
    unittest.main()
