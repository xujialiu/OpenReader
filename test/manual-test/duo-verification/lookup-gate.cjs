#!/usr/bin/env node
// Narrow standalone Debug file sender. No CDP, app-runtime eval, native input,
// listener, server, settings/keys access or network request is performed here.
const fs = require('node:fs');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const actions = ['hold', 'state', 'release', 'restore'];
const states = ['requested', 'held', 'released', 'aborted', 'deadline', 'cancelled', 'failed'];
const stops = ['restore', 'unbreakfetch', 'unmounted', 'aborted', 'deadline', 'expired', 'failed', 'overflow', 'status-write-failed', 'observer-changed'];
const errors = ['invalid-command', 'unsupported-service', 'fetch-observer-present', 'gate-run-mismatch', 'gate-not-installed', 'no-held-response'];
const safeInteger = value => Number.isSafeInteger(value) && value >= 0;
const safeRun = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
function readJSON(file, bound) {
  try {
    if (fs.statSync(file).size > bound) throw new Error('Test protocol file exceeds its bound');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}
function atomicJSON(file, value) {
  const temporary = `${file}.lookup-gate-${process.pid}.tmp`;
  let created = false;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    created = true;
    try { fs.writeFileSync(fd, JSON.stringify(value)); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
  } finally { if (created && fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
/** Project only the app's bounded test fields, even if an unrelated file was
 * substituted. Never print arbitrary JSON, protocol errors or request values.
 */
function readStatus(documents) {
  const status = readJSON(path.join(documents, 'lookup-gate-status.json'), 25_000);
  if (!status || status.version !== 1 || !safeInteger(status.observedAt)) return null;
  const c = status.command;
  if (!c || !safeInteger(c.seq) || !actions.includes(c.action) || !safeRun(c.run) || typeof c.ok !== 'boolean' ||
      (c.error !== null && !errors.includes(c.error)) || !safeInteger(c.released)) return null;
  let gate = null;
  const g = status.gate;
  if (g) {
    if (!safeRun(g.run) || g.service !== 'free-dictionary' || typeof g.installed !== 'boolean' ||
        ![g.installedAt, g.expiresAt, g.count, g.pending, g.held].every(safeInteger) || typeof g.overflow !== 'boolean' ||
        (g.stoppedBy !== null && !stops.includes(g.stoppedBy)) || !Array.isArray(g.requests) || g.requests.length > 64) return null;
    const requests = [];
    for (const r of g.requests) {
      if (!safeInteger(r.id) || !states.includes(r.state) || !safeInteger(r.startedAt) || !safeInteger(r.deadlineAt) ||
          ![r.heldAt, r.releasedAt, r.abortedAt].every(value => value === null || safeInteger(value)) ||
          (r.query !== null && !(typeof r.query === 'string' && r.query.length <= 80 && /^[a-z]+(?:['’\u002d][a-z]+)*$/i.test(r.query)))) return null;
      requests.push({ id: r.id, query: r.query, state: r.state, startedAt: r.startedAt, deadlineAt: r.deadlineAt,
        heldAt: r.heldAt, releasedAt: r.releasedAt, abortedAt: r.abortedAt });
    }
    gate = { run: g.run, service: g.service, installed: g.installed, installedAt: g.installedAt, expiresAt: g.expiresAt,
      count: g.count, pending: g.pending, held: g.held, overflow: g.overflow, stoppedBy: g.stoppedBy, requests };
  }
  return { version: 1, observedAt: status.observedAt,
    command: { seq: c.seq, run: c.run, action: c.action, ok: c.ok, error: c.error, released: c.released }, gate };
}
function sequenceState(file) {
  if (!fs.existsSync(file)) return null;
  const value = readJSON(file, 1024);
  if (!value || !safeInteger(value.seq) || !safeInteger(value.gateSeq) || !safeInteger(value.sentAt) || !safeRun(value.run) || !actions.includes(value.action)) {
    throw new Error('Invalid saved sender sequence; preserve it and investigate, never reset it');
  }
  return value;
}
function nextSequence(floor, saved, harness) {
  const sequence = Math.max(floor, saved ?? 0, harness ?? 0, Date.now() * 1000) + 1;
  if (!safeInteger(sequence)) throw new Error('Sequence exceeds the safe integer range');
  return sequence;
}
function requireSingleHeld(status, run, maxAge) {
  const gate = status?.gate;
  if (!gate || gate.run !== run || !gate.installed || gate.count !== 1 || gate.pending !== 1 || gate.held !== 1 || gate.overflow || gate.stoppedBy ||
      gate.requests.length !== 1 || gate.requests[0].state !== 'held' || gate.requests[0].heldAt === null) throw new Error('Not one live held real response');
  const age = Date.now() - gate.requests[0].startedAt;
  if (age < 0 || age >= maxAge) throw new Error('Held response is too old for the unchanged lookup deadline');
}
async function sendGateCommand(documents, sequenceFile, floor, run, action) {
  if (!path.isAbsolute(documents) || !path.isAbsolute(sequenceFile) || !safeInteger(floor) || !safeRun(run) || !actions.includes(action)) {
    throw new Error('Explicit absolute paths, safe known sequence floor, run token and gate action required');
  }
  const lock = path.join(documents, '.lookup-gate-sender.lock');
  fs.mkdirSync(lock); // Refuse concurrent senders, never remove another sender's lock.
  const harnessFile = path.join(documents, 'harness.json');
  let sent = null;
  try {
    const saved = sequenceState(sequenceFile);
    const previous = readJSON(harnessFile, 16_384);
    if (fs.existsSync(harnessFile) && (!previous || !safeInteger(previous.seq))) throw new Error('Invalid existing harness sequence; do not delete/reset it');
    if (action === 'release') requireSingleHeld(readStatus(documents), run, 11_000); // Leave a poll/readback margin before 12s.
    const seq = nextSequence(floor, saved?.seq, previous?.seq);
    sent = { version: 1, seq, gateSeq: seq, run, action, sentAt: Date.now() };
    atomicJSON(sequenceFile, sent); // Spend the number before delivery, even on failure.
    atomicJSON(harnessFile, { seq, do: 'lookupgate', run, action, ...(action === 'hold' ? { service: 'free-dictionary' } : {}) });
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const status = readStatus(documents);
      if (status?.command.seq === seq && status.command.run === run && status.command.action === action &&
          status.observedAt >= sent.sentAt && status.observedAt <= Date.now() + 1000) {
        if (!status.command.ok) {
          if (status.command.error !== null) throw new Error(`Gate command refused: ${status.command.error}`);
          await delay(40); // A complete transition receipt can precede command finalization.
          continue;
        }
        const gate = status.gate;
        if (!gate || gate.run !== run) throw new Error('Gate acknowledgement has no matching control');
        if (action === 'release') {
          const request = gate.requests[0];
          if (status.command.released !== 1 || !gate.installed || gate.count !== 1 || gate.pending || gate.held || gate.overflow || gate.stoppedBy ||
              gate.requests.length !== 1 || request.state !== 'released' || request.heldAt === null || request.releasedAt === null || request.abortedAt !== null ||
              request.startedAt > request.heldAt || request.heldAt > request.releasedAt || request.releasedAt >= request.deadlineAt) {
            throw new Error('No timely single real response release');
          }
        }
        if (action === 'hold' && (!gate.installed || gate.stoppedBy)) throw new Error('Gate did not install');
        if (action === 'restore' && (gate.installed || gate.pending)) throw new Error('Gate did not restore');
        return status;
      }
      await delay(40); // Immediate status file, not the two-second Debug Log batch.
    }
    throw new Error('No fresh matching gate acknowledgement within 2s; native control BLOCKED');
  } finally {
    try {
      // A command must not replay on a newly mounted poller or next app launch.
      // Preserve gateSeq for wait-held while spending a new monotone noop seq.
      const current = readJSON(harnessFile, 16_384);
      if (sent && current?.seq === sent.gateSeq) {
        sent.seq = nextSequence(floor, sent.seq, current.seq);
        atomicJSON(sequenceFile, sent);
        atomicJSON(harnessFile, { seq: sent.seq, do: 'noop' });
      }
    } finally { fs.rmdirSync(lock); }
  }
}
async function waitForHeld(documents, sequenceFile, run) {
  const sent = sequenceState(sequenceFile);
  if (!sent || sent.run !== run) throw new Error('No matching acknowledged gate command in the retained sender sequence');
  const deadline = Date.now() + 120_000; // Native selection preparation, NOT a network delay/timeout extension.
  while (Date.now() < deadline) {
    const status = readStatus(documents);
    if (status?.command.seq === sent.gateSeq && status.command.run === run && status.observedAt >= sent.sentAt) {
      if (!status.command.ok || !status.gate?.installed || status.gate.stoppedBy || status.gate.overflow || status.gate.count > 1) {
        throw new Error('Held-response control invalid, stopped or duplicated');
      }
      if (status.gate.held) { requireSingleHeld(status, run, 2500); return status; }
      if (status.gate.requests.length && Date.now() - status.gate.requests[0].startedAt >= 2500) throw new Error('Real response did not arrive within the resize preparation budget');
    }
    await delay(40);
  }
  throw new Error('No held real response in the bounded native preparation window');
}
module.exports = { sendGateCommand, waitForHeld, readStatus };
if (require.main === module) {
  const [documents, sequenceFile, floor, run, action] = process.argv.slice(2);
  if (process.argv.length !== 7 || ![...actions, 'wait-held'].includes(action)) {
    console.error('Usage: lookup-gate.cjs ABS_DOCUMENTS ABS_PRIVATE_SEQUENCE_FILE KNOWN_SEQ_FLOOR RUN_TOKEN hold|state|wait-held|release|restore');
    process.exitCode = 2;
  } else {
    const command = action === 'wait-held' ? waitForHeld(documents, sequenceFile, run) : sendGateCommand(documents, sequenceFile, Number(floor), run, action);
    command.then(status => console.log(JSON.stringify(status)), error => { console.error(error.message); process.exitCode = 2; });
  }
}
