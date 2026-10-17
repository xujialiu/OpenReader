#!/usr/bin/env python3
"""Cooperative machine-wide iOS admission and bounded, owned process groups.

Run a whole scripted phase under `run`, not one lock per worktree. Nested
commands inherit an owner token AND must descend from the lock-owning process.
The lock inode is permanent: unlinking it would let waiters lock different files.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import json
import math
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import time

SLOT_ENV = 'OPENREADER_IOS_SLOT'
BUSY, BLOCKED = 75, 69
received_signal = None


class Interrupted(Exception):
    def __init__(self, signum):
        self.signum = signum


def interrupted(signum, _frame):
    # Do not raise between Popen creating a child and assigning its handle.
    global received_signal
    received_signal = signum


def check_interruption():
    if received_signal is not None:
        raise Interrupted(received_signal)


def positive(value):
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise argparse.ArgumentTypeError('must be a finite positive number of seconds')
    return number


def lock_path():
    return Path.home() / 'Library/Caches/OpenReader/ios-verification.lock'


def open_lock():
    path = lock_path()
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    if os.fstat(fd).st_uid != os.getuid():
        os.close(fd)
        raise RuntimeError('iOS slot belongs to another user')
    return os.fdopen(fd, 'r+')


def metadata(handle):
    handle.seek(0)
    try:
        return json.loads(handle.read(16384))
    except (ValueError, OSError):
        return {}


def descendant_of(owner):
    pid = os.getpid()
    for _ in range(64):
        if pid == owner:
            return True
        if pid <= 1:
            break
        result = subprocess.run(['ps', '-o', 'ppid=', '-p', str(pid)], capture_output=True, text=True, timeout=2)
        try:
            pid = int(result.stdout.strip())
        except ValueError:
            break
    return False


def inherited_owner(handle):
    owner = metadata(handle)
    return (bool(os.environ.get(SLOT_ENV)) and owner.get('token') == os.environ[SLOT_ENV]
            and isinstance(owner.get('pid'), int) and descendant_of(owner['pid']))


@contextmanager
def slot(wait=0):
    with open_lock() as handle:
        deadline = time.monotonic() + wait
        announced = False
        while True:
            check_interruption()
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if inherited_owner(handle):
                    yield
                    return
                if not announced:
                    owner = metadata(handle)
                    print(f"[ios-slot] BUSY: owner PID {owner.get('pid', '?')}, cwd {owner.get('cwd', '?')}", file=sys.stderr)
                    announced = True
                if time.monotonic() >= deadline:
                    raise BlockingIOError('iOS verification slot is occupied; no command started')
                time.sleep(min(.1, max(0, deadline - time.monotonic())))
        previous = os.environ.get(SLOT_ENV)
        token = secrets.token_hex(16)
        handle.seek(0)
        handle.truncate()
        json.dump({'pid': os.getpid(), 'cwd': os.getcwd(), 'token': token}, handle)
        handle.flush()
        os.environ[SLOT_ENV] = token
        try:
            yield
        finally:
            if previous is None:
                os.environ.pop(SLOT_ENV, None)
            else:
                os.environ[SLOT_ENV] = previous
            handle.seek(0)
            handle.truncate()
            handle.flush()
            fcntl.flock(handle, fcntl.LOCK_UN)


def require_owner():
    with open_lock() as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            if inherited_owner(handle):
                return
        raise RuntimeError('this command must run inside ios_guard.py run')


def group_exists(pgid):
    try:
        os.killpg(pgid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        # Darwin can answer EPERM for a group containing only reparented
        # zombies. They cannot run or be signalled; do not call them live work.
        rows = subprocess.run(['ps', '-axo', 'pgid=,stat='], capture_output=True, text=True, timeout=2, check=True)
        return any(fields[0] == str(pgid) and not fields[1].startswith('Z')
                   for fields in (line.split() for line in rows.stdout.splitlines()))


def owned_groups(process):
    """Snapshot descendants BEFORE terminating their parents. Nested guards
    have sessions of their own; killing just the outer group would miss them."""
    groups = {process.pid}
    if process.poll() is not None:
        return groups
    rows = subprocess.run(['ps', '-axo', 'pid=,ppid=,pgid='], capture_output=True, text=True, timeout=2, check=True)
    children = {}
    for line in rows.stdout.splitlines():
        pid, parent, group = map(int, line.split())
        children.setdefault(parent, []).append((pid, group))
    pending = [process.pid]
    while pending:
        for pid, group in children.get(pending.pop(), []):
            if group != os.getpgrp():
                groups.add(group)
            pending.append(pid)
    return groups


def stop_group(process, grace):
    """Only this invocation's descendants; never find targets by port/name."""
    groups = owned_groups(process)
    for sig in (signal.SIGTERM, signal.SIGKILL):
        for pgid in groups:
            if not group_exists(pgid):
                continue
            try:
                os.killpg(pgid, sig)
            except ProcessLookupError:
                pass
            except PermissionError:
                if group_exists(pgid):
                    raise
        until = time.monotonic() + grace
        while time.monotonic() < until:
            process.poll()
            if not any(group_exists(pgid) for pgid in groups):
                break
            time.sleep(.02)
    process.wait(timeout=max(1, grace))


def save_record(path, record):
    if path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(path.name + f'.{os.getpid()}.pending')
        temporary.write_text(json.dumps(record, indent=2) + '\n')
        temporary.replace(path)


def run_command(command, timeout, grace=2, record=None, stdout=None, stderr=None):
    started = time.monotonic()
    process = None
    code, outcome = 70, 'failed'
    try:
        check_interruption()
        process = subprocess.Popen(command, start_new_session=True, stdout=stdout, stderr=stderr)
        save_record(record, {'pid': process.pid, 'pgid': process.pid, 'outcome': 'running'})
        while True:
            check_interruption()
            code = process.poll()
            if code is not None:
                break
            if time.monotonic() - started >= timeout:
                raise subprocess.TimeoutExpired(command[0], timeout)
            time.sleep(.02)
        code = code if code >= 0 else 128 - code
        outcome = 'passed' if code == 0 else 'failed'
    except subprocess.TimeoutExpired:
        code, outcome = 124, 'timeout'
        print(f'[ios-guard] deadline reached ({timeout:g}s); stopping owned process group', file=sys.stderr)
    except Interrupted as error:
        code, outcome = 128 + error.signum, 'cancelled'
    except OSError as error:
        print(f'[ios-guard] cannot start command: {error}', file=sys.stderr)
        code = 127
    finally:
        # Repeated signals must not interrupt cleanup halfway through.
        handlers = {sig: signal.signal(sig, signal.SIG_IGN) for sig in (signal.SIGINT, signal.SIGTERM)}
        try:
            if process is not None:
                stop_group(process, grace)
        finally:
            for sig, handler in handlers.items():
                signal.signal(sig, handler)
        save_record(record, {'pid': process.pid if process else None, 'pgid': process.pid if process else None,
                             'outcome': outcome, 'exitCode': code, 'seconds': round(time.monotonic() - started, 3)})
    return code


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest='action', required=True)
    run = actions.add_parser('run', help='hold the shared slot through a bounded foreground command')
    run.add_argument('--timeout', type=positive, required=True)
    run.add_argument('--grace', type=positive, default=2)
    run.add_argument('--wait', type=float, default=0, help='bounded admission wait; default fail immediately if busy')
    run.add_argument('--record', type=Path)
    run.add_argument('command', nargs=argparse.REMAINDER)
    actions.add_parser('check-owner', help='verify an inherited owner; never acquire a fresh slot')
    args = parser.parse_args()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, interrupted)
    try:
        if args.action == 'check-owner':
            require_owner()
            return 0
        if not math.isfinite(args.wait) or args.wait < 0:
            parser.error('--wait must be finite and nonnegative')
        command = args.command[1:] if args.command[:1] == ['--'] else args.command
        if not command:
            parser.error('a command after -- is required')
        with slot(args.wait):
            return run_command(command, args.timeout, args.grace, args.record)
    except BlockingIOError as error:
        print(f'[ios-slot] {error}', file=sys.stderr)
        return BUSY
    except Interrupted as error:
        return 128 + error.signum
    except (RuntimeError, OSError, subprocess.TimeoutExpired) as error:
        print(f'[ios-guard] BLOCKED: {error}', file=sys.stderr)
        return BLOCKED


if __name__ == '__main__':
    sys.exit(main())
