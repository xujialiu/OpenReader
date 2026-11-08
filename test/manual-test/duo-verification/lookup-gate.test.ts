import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { LookupGateSnapshot, LookupGateStatus } from '../../../src/app/walkthrough-lookup-gate';

/** HOST ONLY: actual atomic sender against temporary files and fake app replies.
 * The app-runtime seam is separately exercised by walkthrough-lookup-gate.test.ts.
 */
const { sendGateCommand, waitForHeld, readStatus } = createRequire(import.meta.url)('./lookup-gate.cjs') as {
  sendGateCommand(documents: string, sequence: string, floor: number, run: string, action: string): Promise<LookupGateStatus>;
  waitForHeld(documents: string, sequence: string, run: string): Promise<LookupGateStatus>;
  readStatus(documents: string): LookupGateStatus | null;
};
let directory: string, documents: string, sequence: string;
const floor = 1_794_090_813_387_149;
const run = 'host-file-control';
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const harness = () => read(path.join(documents, 'harness.json')) as { seq: number; do: string; action: LookupGateStatus['command']['action'] };
const statusFile = () => path.join(documents, 'lookup-gate-status.json');
const send = (action: string) => sendGateCommand(documents, sequence, floor, run, action);
function emptyGate(): LookupGateSnapshot {
  return { run, service: 'free-dictionary', installed: true, installedAt: Date.now(), expiresAt: Date.now() + 120_000,
    count: 0, pending: 0, held: 0, overflow: false, stoppedBy: null, requests: [] };
}
function heldGate(): LookupGateSnapshot {
  return { ...emptyGate(), count: 1, pending: 1, held: 1, requests: [{ id: 1, query: 'chapter', state: 'held', startedAt: Date.now(),
    deadlineAt: Date.now() + 12_000, heldAt: Date.now(), releasedAt: null, abortedAt: null }] };
}
function ack(gate = emptyGate(), changes: Partial<LookupGateStatus['command']> = {}) {
  const command = harness();
  const status: LookupGateStatus = { version: 1, observedAt: Date.now(), command: {
    seq: command.seq, action: command.action, run, ok: true, error: null, released: 0, ...changes,
  }, gate };
  fs.writeFileSync(statusFile(), JSON.stringify(status));
  return status;
}
async function settle<T>(promise: Promise<T>) { await vi.advanceTimersByTimeAsync(80); return promise; }

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_794_090_813_400);
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lookup-gate-host-'));
  documents = path.join(directory, 'Documents'); fs.mkdirSync(documents);
  sequence = path.join(directory, 'private-sequence.json');
});
afterEach(() => { vi.useRealTimers(); fs.rmSync(directory, { recursive: true, force: true }); });

it('sends hold/state/release/restore with fresh acknowledgements and atomic monotone noop cleanup, without Debug Log waits', async () => {
  let gate = emptyGate();
  const numbers: number[] = [];
  for (const action of ['hold', 'state', 'release', 'restore']) {
    if (action === 'release') {
      gate = heldGate();
      const last = read(statusFile()) as LookupGateStatus;
      fs.writeFileSync(statusFile(), JSON.stringify({ ...last, observedAt: Date.now(), gate }));
    }
    const pending = send(action);
    const command = harness(); numbers.push(command.seq);
    if (action === 'hold') expect(read(path.join(documents, 'harness.json'))).toEqual({ seq: command.seq, do: 'lookupgate', action, run, service: 'free-dictionary' });
    if (action === 'release') {
      gate = { ...gate, held: 0, pending: 0, requests: gate.requests.map(request => ({ ...request, state: 'released', releasedAt: Date.now() })) };
    }
    if (action === 'restore') gate = { ...gate, installed: false, stoppedBy: 'restore' };
    ack(gate, { released: action === 'release' ? 1 : 0 });
    const result = await settle(pending);
    expect(result.command).toMatchObject({ ok: true, seq: command.seq, action });
    expect(harness().do).toBe('noop'); expect(harness().seq).toBeGreaterThan(command.seq);
    expect(read(sequence)).toMatchObject({ seq: harness().seq, gateSeq: command.seq, run, action });
    expect(fs.existsSync(path.join(documents, '.lookup-gate-sender.lock'))).toBe(false);
  }
  expect(numbers.every((number, i) => number > (numbers[i - 1] ?? floor))).toBe(true);
  expect(Date.now() - 1_794_090_813_400).toBeLessThan(1000);
  expect(fs.readdirSync(documents).sort()).toEqual(['harness.json', 'lookup-gate-status.json']);
});

it('does not reset the saved sequence after harness deletion or a backwards wall clock', async () => {
  const first = send('hold'); ack(); await settle(first);
  const spent = harness().seq;
  fs.unlinkSync(path.join(documents, 'harness.json'));
  vi.setSystemTime(Date.now() - 60_000);
  const second = send('state');
  expect(harness().seq).toBeGreaterThan(spent); ack(); await settle(second);
  expect(harness().seq).toBeGreaterThan(spent);
});

it('also honors a newer existing harness sequence and explicit higher consumed floor', async () => {
  const higher = Date.now() * 1000 + 9_000;
  fs.writeFileSync(path.join(documents, 'harness.json'), JSON.stringify({ seq: higher, do: 'noop' }));
  const pending = sendGateCommand(documents, sequence, higher + 10, run, 'hold');
  expect(harness().seq).toBe(higher + 11); ack(); await settle(pending);
});

it('refuses concurrent senders even with a different external sequence file and leaves the first lock alone', async () => {
  const first = send('hold');
  await expect(sendGateCommand(documents, sequence + '.other', floor, run, 'hold')).rejects.toMatchObject({ code: 'EEXIST' });
  expect(fs.existsSync(path.join(documents, '.lookup-gate-sender.lock'))).toBe(true);
  ack(); await settle(first);
  expect(fs.existsSync(path.join(documents, '.lookup-gate-sender.lock'))).toBe(false);
});

it('never accepts an old/stale sequence answer, even if it says hold succeeded, and cleans up its command on timeout', async () => {
  const pending = send('hold').catch(error => error);
  const sent = harness().seq;
  const status = ack(); status.command.seq -= 1;
  fs.writeFileSync(statusFile(), JSON.stringify(status));
  await vi.advanceTimersByTimeAsync(2000);
  expect((await pending).message).toContain('No fresh matching gate acknowledgement');
  expect(harness().do).toBe('noop'); expect(harness().seq).toBeGreaterThan(sent);
  expect(fs.existsSync(path.join(documents, '.lookup-gate-sender.lock'))).toBe(false);
});

it('retries partial status JSON rather than reading a Debug Log or overwriting the protocol file', async () => {
  const pending = send('hold');
  fs.writeFileSync(statusFile(), '{'); await vi.advanceTimersByTimeAsync(120);
  ack(); expect((await settle(pending)).command.ok).toBe(true);
});

it('wait-held uses unsolicited immediate transition status, not another command/poll/Debug Log flush', async () => {
  const pending = send('hold'); ack(); await settle(pending);
  const before = harness().seq;
  const waiting = waitForHeld(documents, sequence, run);
  const status = read(statusFile()) as LookupGateStatus;
  fs.writeFileSync(statusFile(), JSON.stringify({ ...status, observedAt: Date.now(), gate: heldGate() }));
  expect((await settle(waiting)).gate?.held).toBe(1);
  expect(harness().seq).toBe(before);
});

it.each(['duplicate', 'late', 'aborted'] as const)('wait-held rejects an invalid %s control instead of reporting native success', async failure => {
  const pending = send('hold'); ack(); await settle(pending);
  const status = read(statusFile()) as LookupGateStatus;
  const gate = heldGate();
  if (failure === 'duplicate') gate.count = 2;
  if (failure === 'late') gate.requests[0]!.startedAt -= 2500;
  if (failure === 'aborted') { gate.installed = false; gate.stoppedBy = 'aborted'; }
  fs.writeFileSync(statusFile(), JSON.stringify({ ...status, observedAt: Date.now(), gate }));
  await expect(waitForHeld(documents, sequence, run)).rejects.toThrow();
});

it('refuses a release at 11s before writing a new command, leaving margin below the real 12s control deadline', async () => {
  const pending = send('hold'); ack(heldGate()); await settle(pending);
  const before = harness();
  vi.setSystemTime(Date.now() + 11_000);
  await expect(send('release')).rejects.toThrow('too old');
  expect(harness()).toEqual(before);
});

it('reports command refusal and failed restoration truthfully', async () => {
  let pending = send('hold').catch(error => error);
  ack(emptyGate(), { ok: false, error: 'fetch-observer-present' });
  expect((await settle(pending)).message).toContain('fetch-observer-present');
  pending = send('restore').catch(error => error); ack(emptyGate());
  expect((await settle(pending)).message).toContain('did not restore');
});

it('projects only whitelisted test fields and rejects unbounded or credential-shaped status values', async () => {
  const pending = send('hold');
  const status = ack();
  fs.writeFileSync(statusFile(), JSON.stringify({ ...status, headers: 'private-value', gate: { ...status.gate, body: 'private-body' } }));
  expect(JSON.stringify(readStatus(documents))).not.toContain('private');
  await settle(pending);
  const hostile = { ...status, gate: heldGate() };
  hostile.gate.requests[0]!.query = 'Authorization: private-value';
  fs.writeFileSync(statusFile(), JSON.stringify(hostile)); expect(readStatus(documents)).toBeNull();
  fs.writeFileSync(statusFile(), 'x'.repeat(25_001)); expect(() => readStatus(documents)).toThrow('exceeds');
});

it('refuses malformed existing sender/harness state and unsafe input rather than resetting the seen floor', async () => {
  fs.writeFileSync(sequence, '{');
  await expect(send('hold')).rejects.toThrow('Invalid saved sender sequence');
  fs.unlinkSync(sequence);
  fs.writeFileSync(path.join(documents, 'harness.json'), '{');
  await expect(send('hold')).rejects.toThrow('Invalid existing harness sequence');
  await expect(sendGateCommand(documents, sequence, Number.MAX_SAFE_INTEGER, run, 'hold')).rejects.toThrow();
  await expect(sendGateCommand('relative', sequence, floor, run, 'hold')).rejects.toThrow('absolute paths');
  await expect(sendGateCommand(documents, sequence, floor, 'bad run', 'hold')).rejects.toThrow();
});

it.each(['missing-gate', 'missing-request', 'missing-release-time'] as const)('rejects a nominal successful release with %s evidence', async missing => {
  const held = heldGate();
  const first = send('hold'); ack(held); await settle(first);
  const pending = send('release').catch(error => error);
  const gate: LookupGateSnapshot = { ...held, held: 0, pending: 0,
    requests: held.requests.map(request => ({ ...request, state: 'released', releasedAt: Date.now() })) };
  const status = ack(gate, { released: 1 });
  if (missing === 'missing-gate') status.gate = null;
  if (missing === 'missing-request') gate.requests.length = 0;
  if (missing === 'missing-release-time') gate.requests[0]!.releasedAt = null;
  fs.writeFileSync(statusFile(), JSON.stringify(status));
  expect((await settle(pending)).message).toMatch(/No timely single|no matching control/);
});
