#!/usr/bin/env node
// PROVIDER-FAULT-SERVER — a controlled TTS-shaped HTTP server on 127.0.0.1, for
// verifying failed Provider responses (#203, #211, #204) without any cloud or
// paid call. Models the sync area's `cacheable-dav.cjs`: one process answers
// the OpenAI-compatible routes the app's `compatible` provider really speaks
// (`POST /v1/audio/speech`, `GET /v1/audio/voices`, `GET /v1/models`), plus
// plain fetch endpoints for driving the app's own native `expo/fetch` readers
// directly through CDP. Every cut shape follows the #168 rule: it writes the
// success headers **and at least some body bytes** (flushing them) before
// destroying the socket — headers alone is a fetch()-stage repro, not a body
// failure.
//
//   node test/manual-test/voices-and-providers/provider-fault-server.cjs PORT
//
// Switch behaviour while the app runs (GET or POST, both fine):
//   curl 'http://127.0.0.1:PORT/__mode?speech=cut&voices=502'
//   curl 'http://127.0.0.1:PORT/__state'
// Modes (speech): ok-pcm (complete raw PCM 24 kHz), ok-wav (complete WAV
// container), cut (headers + partial body, then socket destroyed), stall
// (headers + partial body, then held — bounded only by the client),
// json-error / html-error / text-error (complete 200 non-audio bodies),
// refuse-pcm (a request naming response_format pcm is refused 422 with
// FastAPI's literal_error body, any other format gets complete WAV — the
// #202 PCM-memory scenario; each speech request's response_format is
// journaled on /__speech), 502 / 503 / 429 / 404, and flaky-503 (each
// distinct text is answered 503 for its first `fails` requests, then complete
// raw PCM — #237's retry; `__mode?speech=flaky-503&fails=2`, 1 by default,
// counts restarting at every mode change), empty-200 (a complete 200 with no
// body and no Content-Type) / empty-204 (a 204) — a speakable sentence answered
// with no audio (#235) — and bad-mp3 (a complete 200 `audio/mpeg` whose bytes
// are not MP3 — a Clip that does not decode, #276). `delayVoice=ID&delayMs=MS`
// holds every speech answer for that one voice MS before its mode answers it,
// so one Voice can be slow while another is fast (#252); `delayVoice=` clears
// it.  Modes (voices): ok
// (fixture voices), junk (a complete 200 with no usable list — the
// documented-fallback control), 502 / 503 / 429 / 404.  Modes (models): ok
// (the fixture model, the default), 404 (publishes no model list — #209).
// A POST without a text `input` — the #209 connection probe's `{}` — is
// journaled and answered by its mode: a status mode answers that status,
// anything else answers 422 like FastAPI refusing required fields. Unknown
// mode names are refused, never guessed.
//
// Plain boundary endpoints (no provider logic; each cut every request):
//   /cut/text /cut/bytes /cut/json — 200 + Content-Length + ~200 body bytes,
//                                    then destroy after 150 ms.
//   /ok/text /ok/json /ok/bytes    — complete controls.
//   /stall                         — headers + partial body, never completes.
//   /slow/MS                       — a complete body after MS milliseconds.
// /__log dumps the request/close journal as JSON; the journal lives in memory
// only. Logs go to stdout with elapsed times; redirect them to a file.
const http = require('node:http');
const { Buffer } = require('node:buffer');
const { createHash } = require('node:crypto');

const port = Number(process.argv[2] ?? 8765);
if (!Number.isInteger(port) || port <= 0) {
  console.error('Usage: provider-fault-server.cjs PORT');
  process.exit(2);
}

const SPEECH_MODES = ['ok-pcm', 'ok-wav', 'cut', 'stall', 'json-error', 'html-error', 'text-error', 'refuse-pcm', '502', '503', '429', '404', 'flaky-503', 'empty-200', 'empty-204', 'bad-mp3'];
const VOICES_MODES = ['ok', 'junk', '502', '503', '429', '404'];
const MODELS_MODES = ['ok', '404'];
const STATUS_MODES = ['502', '503', '429', '404'];
const state = { speech: 'ok-pcm', voices: 'ok', models: 'ok', fails: 1, delayVoice: '', delayMs: 0 };
// flaky-503: how many 503s each text (by hash) has been answered since the mode was set.
const flakySeen = new Map();
const journal = [];
// Machine-readable assertions without keeping the Document text in this ledger.
const speechRequests = [];

const log = (line) => {
  journal.push(`${new Date().toISOString()} ${line}`);
  console.log(`${new Date().toISOString()} ${line}`);
};

// 0.5 s of 16-bit mono 24 kHz PCM: a quiet sine, real samples (amplitude 2048).
const pcmSamples = (() => {
  const samples = new Int16Array(12_000);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(2048 * Math.sin((2 * Math.PI * 440 * i) / 24_000));
  return Buffer.from(samples.buffer);
})();
// The same samples in a 44-byte-header WAV container (RIFF/WAVE, PCM 16-bit).
const wavBytes = (() => {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmSamples.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(24_000, 24);
  header.writeUInt32LE(48_000, 28); // byte rate
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmSamples.length, 40);
  return Buffer.concat([header, pcmSamples]);
})();
const FIXTURE_VOICES = [
  { id: 'fixture-willow', name: 'Fixture Willow' },
  { id: 'fixture-alto', name: 'Fixture Alto' },
  { id: 'fixture-breeze', name: 'Fixture Breeze' },
];

/** Success headers + the first slice of a larger body, then the socket dies.
 * The client gets `Content-Length`, `Content-Type` and SLICE real bytes — the
 * shape whose readers can only end in bodyCompleted or errorReceived. */
function cut(res, { contentType, total, slice, label, delayMs = 150 }) {
  const t0 = Date.now();
  res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': String(total), 'Cache-Control': 'no-store' });
  res.flushHeaders();
  res.write(Buffer.alloc(slice, 0x61));
  log(`SLICED ${label} ${slice}/${total} bytes flushed at +${Date.now() - t0} ms`);
  setTimeout(() => {
    log(`CUT ${label} socket destroyed at +${Date.now() - t0} ms`);
    res.socket?.destroy();
  }, delayMs);
  res.on('close', () => log(`CLOSED ${label} at +${Date.now() - t0} ms (ended=${res.writableEnded})`));
}

function complete(res, contentType, body, label, code = 200) {
  const t0 = Date.now();
  // A Date header on every cacheable answer: NSURLCache stores nothing without
  // one (sync/cache-stall-and-recovery.md), which would fake a cache probe.
  res.writeHead(code, { 'Content-Type': contentType, 'Content-Length': String(body.length), 'Date': new Date().toUTCString(), 'Cache-Control': 'no-store' });
  res.end(body);
  log(`HTTP ${code} OK ${label} ${body.length} bytes at +${Date.now() - t0} ms`);
}

function status(res, code, label) {
  res.writeHead(code, { 'Content-Length': 3, 'Content-Type': 'text/plain' });
  res.end(`${code}`.slice(0, 3));
  log(`HTTP ${code} ${label}`);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const path = url.pathname;
  log(`REQ ${req.method} ${req.url} (speech=${state.speech} voices=${state.voices})`);
  if (req.method === 'POST' && path === '/v1/audio/speech') {
    const body = await readBody(req);
    log(`SPEECH body: ${body.slice(0, 300)}`);
    const mode = state.speech;
    let request;
    try { request = JSON.parse(body); } catch { return status(res, 400, 'speech invalid JSON'); }
    if (!request || typeof request.input !== 'string') {
      // No text to speak: the shape of a connection probe's `{}` (#209).
      // The mode's own answer — a status mode answers that status, any
      // other answers 422 like FastAPI refusing required fields.
      speechRequests.push({ at: Date.now(), mode, voice: null, response_format: request?.response_format ?? null, probe: true });
      if (STATUS_MODES.includes(mode)) return status(res, Number(mode), 'speech probe');
      return complete(res, 'application/json', JSON.stringify({ detail: [
        { type: 'missing', loc: ['body', 'model'], msg: 'Field required', input: {} },
        { type: 'missing', loc: ['body', 'input'], msg: 'Field required', input: {} },
        { type: 'missing', loc: ['body', 'voice'], msg: 'Field required', input: {} },
      ] }), 'speech probe', 422);
    }
    const text = createHash('sha256').update(String(request.input ?? '')).digest('hex');
    speechRequests.push({ at: Date.now(), mode, voice: request.voice, response_format: request.response_format ?? null, text });
    if (state.delayVoice && request.voice === state.delayVoice && state.delayMs > 0) {
      log(`HOLD speech for ${request.voice} ${state.delayMs} ms`);
      await new Promise((resolve) => setTimeout(resolve, state.delayMs));
      if (res.destroyed) return log(`CLOSED speech for ${request.voice} before its delayed answer`);
    }
    if (mode === 'flaky-503') {
      const seen = flakySeen.get(text) ?? 0;
      if (seen < state.fails) { flakySeen.set(text, seen + 1); return status(res, 503, `speech flaky-503 ${seen + 1}/${state.fails}`); }
      return complete(res, 'audio/pcm', pcmSamples, 'speech flaky-503 ok-pcm');
    }
    if (mode === 'refuse-pcm') {
      if (request.response_format === 'pcm') {
        return complete(res, 'application/json', JSON.stringify({ detail: [
          { type: 'literal_error', loc: ['body', 'response_format'], msg: "Input should be 'wav', 'opus' or 'mp3'", input: 'pcm' },
        ] }), 'speech refuse-pcm', 422);
      }
      return complete(res, 'audio/wav', wavBytes, 'speech refuse-pcm fallback');
    }
    if (mode === 'ok-pcm') return complete(res, 'audio/pcm', pcmSamples, 'speech ok-pcm');
    if (mode === 'ok-wav') return complete(res, 'audio/wav', wavBytes, 'speech ok-wav');
    if (mode === 'cut') return cut(res, { contentType: 'audio/pcm', total: 65_536, slice: 8192, label: 'speech cut', delayMs: 1000 });
    if (mode === 'stall') {
      const t0 = Date.now();
      res.writeHead(200, { 'Content-Type': 'audio/pcm', 'Content-Length': '65536', 'Cache-Control': 'no-store' });
      res.flushHeaders();
      res.write(Buffer.alloc(8192, 0x61));
      log(`SLICED speech stall 8192/65536 bytes flushed at +${Date.now() - t0} ms; holding`);
      res.on('close', () => log(`CLOSED speech stall at +${Date.now() - t0} ms (ended=${res.writableEnded})`));
      return; // never completes; the client's deadline or abort is the only exit
    }
    if (mode === 'json-error') return complete(res, 'application/json', JSON.stringify({ error: { message: 'Insufficient balance', code: 'insufficient_balance' } }), 'speech json-error');
    if (mode === 'html-error') return complete(res, 'text/html', '<html><body><h1>502 upstream</h1><p>gateway lost the worker</p></body></html>', 'speech html-error');
    if (mode === 'text-error') return complete(res, 'text/plain', 'Insufficient balance', 'speech text-error');
    if (mode === 'empty-200') {
      res.writeHead(200, { 'Content-Length': '0', 'Date': new Date().toUTCString(), 'Cache-Control': 'no-store' });
      res.end();
      return log('HTTP 200 OK speech empty-200 0 bytes, no Content-Type');
    }
    if (mode === 'empty-204') {
      res.writeHead(204, { 'Date': new Date().toUTCString(), 'Cache-Control': 'no-store' });
      res.end();
      return log('HTTP 204 speech empty-204');
    }
    if (mode === 'bad-mp3') return complete(res, 'audio/mpeg', Buffer.alloc(4096, 0x61), 'speech bad-mp3');
    if (['502', '503', '429', '404'].includes(mode)) return status(res, Number(mode), 'speech');
    return status(res, 500, 'speech unknown-mode');
  }
  if (req.method === 'GET' && path === '/v1/audio/voices') {
    const mode = state.voices;
    if (mode === 'ok') return complete(res, 'application/json', JSON.stringify({ voices: FIXTURE_VOICES }), 'voices ok');
    if (mode === 'junk') return complete(res, 'text/html', '<html>this is not a voice list</html>', 'voices junk');
    if (['502', '503', '429', '404'].includes(mode)) return status(res, Number(mode), 'voices');
    return status(res, 500, 'voices unknown-mode');
  }
  if (req.method === 'GET' && path === '/v1/models') {
    if (state.models === '404') return status(res, 404, 'models');
    return complete(res, 'application/json', JSON.stringify({ data: [{ id: 'fixture-tts' }] }), 'models');
  }
  if (req.method === 'POST' && path === '/v1/chat/completions') {
    return status(res, 404, 'chat (unused; speech route configured)');
  }
  // ---- plain boundary endpoints ----
  if (path === '/cut/text' || path === '/cut/bytes' || path === '/cut/json') {
    const label = `boundary ${path}`;
    const contentType = path === '/cut/json' ? 'application/json' : 'text/plain';
    const delayMs = Math.min(Number(url.searchParams.get('delay')) || 150, 5000);
    // ?prefix=N delivers N bytes before the cut (default 200). The #203 run 2
    // control varies ONLY this: 8192 bytes forces the prefix out of any
    // low-level buffering, with a much larger declared Content-Length.
    const prefix = Math.min(Number(url.searchParams.get('prefix')) || 200, 65_536);
    const total = Math.max(65_536, prefix + 1);
    return cut(res, { contentType, total, slice: prefix, label, delayMs });
  }
  if (path === '/ok/text') return complete(res, 'text/plain', 'complete plain text body', path);
  if (path === '/ok/json') return complete(res, 'application/json', JSON.stringify({ answer: 42 }), path);
  if (path === '/ok/bytes') return complete(res, 'application/octet-stream', Buffer.alloc(3000, 0x62), path);
  if (path === '/stall') {
    const t0 = Date.now();
    const prefix = Math.min(Number(url.searchParams.get('prefix')) || 200, 65_536);
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': '65536', 'Cache-Control': 'no-store' });
    res.flushHeaders();
    res.write(Buffer.alloc(prefix, 0x61));
    log(`SLICED stall ${prefix}/65536 bytes flushed at +${Date.now() - t0} ms; holding`);
    res.on('close', () => log(`CLOSED stall at +${Date.now() - t0} ms (ended=${res.writableEnded})`));
    return;
  }
  // Stall first (so the client's fetch() resolves at the first chunk, as it
  // does on every healthy transfer here), then cut the socket: the reader-level
  // shape for consumption deliberately delayed until after the connection
  // failed. /stallcut?hold=MS destroys after MS (default 1000).
  if (path === '/stallcut') {
    const hold = Math.min(Number(url.searchParams.get('hold')) || 1000, 10_000);
    const prefix = Math.min(Number(url.searchParams.get('prefix')) || 200, 65_536);
    const t0 = Date.now();
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': '65536', 'Cache-Control': 'no-store' });
    res.flushHeaders();
    res.write(Buffer.alloc(prefix, 0x61));
    log(`SLICED stallcut ${prefix}/65536 bytes flushed at +${Date.now() - t0} ms; cutting at +${hold} ms`);
    setTimeout(() => {
      log(`CUT stallcut socket destroyed at +${Date.now() - t0} ms`);
      res.socket?.destroy();
    }, hold);
    res.on('close', () => log(`CLOSED stallcut at +${Date.now() - t0} ms (ended=${res.writableEnded})`));
    return;
  }
  const slow = /^\/slow\/(\d+)$/.exec(path);
  if (slow) {
    const ms = Math.min(Number(slow[1]), 120_000);
    const t0 = Date.now();
    setTimeout(() => complete(res, 'text/plain', `slow complete after ${ms} ms`, path), ms);
    res.on('close', () => log(`CLOSED slow at +${Date.now() - t0} ms (ended=${res.writableEnded})`));
    return;
  }
  // ---- control plane ----
  if (path === '/__mode') {
    const speech = url.searchParams.get('speech');
    const voices = url.searchParams.get('voices');
    const models = url.searchParams.get('models');
    if (speech !== null && !SPEECH_MODES.includes(speech)) { res.writeHead(400); res.end('unknown speech mode'); return; }
    if (voices !== null && !VOICES_MODES.includes(voices)) { res.writeHead(400); res.end('unknown voices mode'); return; }
    if (models !== null && !MODELS_MODES.includes(models)) { res.writeHead(400); res.end('unknown models mode'); return; }
    const fails = url.searchParams.get('fails');
    if (fails !== null && !/^[0-9]+$/.test(fails)) { res.writeHead(400); res.end('fails is a whole number'); return; }
    const delayVoice = url.searchParams.get('delayVoice');
    const delayMs = url.searchParams.get('delayMs');
    if (delayMs !== null && !/^[0-9]+$/.test(delayMs)) { res.writeHead(400); res.end('delayMs is a whole number'); return; }
    if (delayVoice !== null) { state.delayVoice = delayVoice; log(`MODE delayVoice=${delayVoice}`); }
    if (delayMs !== null) { state.delayMs = Math.min(Number(delayMs), 60_000); log(`MODE delayMs=${state.delayMs}`); }
    if (speech) { state.speech = speech; flakySeen.clear(); log(`MODE speech=${speech}`); }
    if (fails !== null) { state.fails = Number(fails); flakySeen.clear(); log(`MODE fails=${fails}`); }
    if (voices) { state.voices = voices; log(`MODE voices=${voices}`); }
    if (models) { state.models = models; log(`MODE models=${models}`); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state));
    return;
  }
  if (path === '/__state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...state, requests: journal.length }));
    return;
  }
  if (path === '/__speech') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(speechRequests));
    return;
  }
  if (path === '/__log') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(journal, null, 1));
    return;
  }
  res.writeHead(404, { 'Content-Length': 9 });
  res.end('not found');
});

server.listen(port, '127.0.0.1', () => log(`provider-fault-server listening on 127.0.0.1:${port} (speech=${state.speech} voices=${state.voices})`));
server.on('error', (error) => {
  console.error(`listen failed: ${error.message}`);
  process.exit(1);
});
