#!/usr/bin/env node
// AT-SIGN-FAKE-OPENAI — a controlled OpenAI-compatible speech server on
// 127.0.0.1, for verifying the "@"-in-password Address fixes (#314, #315)
// without any cloud or paid call. Modelled on ../player-and-reading-held/
// fake-kokoro.cjs, with the logging this verification needs on EVERY request:
//
//   <ISO-ms> <METHOD> <path> -> <status> auth=<present|absent> basic-user=<name|->
//
// `auth` says only whether an Authorization header came with the request, and
// `basic-user` names only the Basic scheme's user name (the part before the
// first ":"); the password and every other header value are never logged.
// Synthesis requests also carry fake-kokoro's counter line shape, so
// `grep -c 'text=' LOG` counts synthesis requests:
//
//   <counter> <ISO-ms> text="<input>" voice=<voice> words=<n> route=speech auth=<present|absent>
//
// Routes:
//   GET  /                    -> 200 text/plain (the warm-up GET lands here)
//   GET  /v1/models           -> { data: [{ id: 'fake-tts' }] }
//   GET  /v1/audio/voices     -> { voices: [{ id: 'af_bella', name: 'Bella (fake)' }] }
//   POST /v1/audio/speech     -> SILENCE_SECONDS of quiet PCM 24 kHz 16-bit
//                                mono, Content-Type audio/pcm
//   anything else             -> 404, logged the same way
//
//   node test/manual-test/voices-and-providers/at-sign-fake-openai.cjs PORT
//
// OPENREADER_ATSIGN_LOG   the log file (default /tmp/openreader-314-315/fake-openai.log)
// OPENREADER_ATSIGN_SECONDS   the clip length (default 2.5 s)
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PORT = Number(process.argv[2] ?? 8915);
if (!Number.isInteger(PORT) || PORT <= 0) {
  console.error('Usage: at-sign-fake-openai.cjs PORT');
  process.exit(2);
}
const LOG = process.env.OPENREADER_ATSIGN_LOG ?? '/tmp/openreader-314-315/fake-openai.log';
const SAMPLE_RATE = 24_000;
const SILENCE_SECONDS = Number(process.env.OPENREADER_ATSIGN_SECONDS ?? 2.5);

fs.mkdirSync(path.dirname(LOG), { recursive: true });

let served = 0;
const pcmFor = (seconds) => Buffer.alloc(Math.round(seconds * SAMPLE_RATE) * 2, 0);

// Presence and the Basic user name only — never a header value.
function authOf(req) {
  const header = req.headers.authorization;
  if (!header) return { present: 'absent', user: '-' };
  const match = /^Basic +([A-Za-z0-9._~+/=-]+)$/i.exec(String(header).trim());
  let user = '-';
  if (match) {
    try {
      const decoded = Buffer.from(match[1], 'base64').toString('utf8');
      const colon = decoded.indexOf(':');
      user = JSON.stringify(colon >= 0 ? decoded.slice(0, colon) : decoded);
    } catch {
      user = '(undecodable)';
    }
  }
  return { present: 'present', user };
}

const record = (line) => {
  console.log(line);
  fs.appendFileSync(LOG, line + '\n');
};

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const auth = authOf(req);
    const say = (status, extra = '') =>
      record(`${new Date().toISOString()} ${req.method} ${req.url} -> ${status} auth=${auth.present} basic-user=${auth.user}${extra}`);

    if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
      say(200);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('at-sign fake openai\n');
      return;
    }
    if (req.method === 'GET' && req.url.includes('/v1/audio/voices')) {
      say(200);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ voices: [{ id: 'af_bella', name: 'Bella (fake)' }] }));
      return;
    }
    if (req.method === 'GET' && req.url.includes('/v1/models')) {
      say(200);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'fake-tts' }] }));
      return;
    }
    if (req.method === 'POST' && req.url.includes('/v1/audio/speech')) {
      let text = '';
      let voice = '';
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        text = String(parsed.input ?? '');
        voice = String(parsed.voice ?? '');
      } catch {
        text = '(unparseable body)';
      }
      served += 1;
      record(
        `${served} ${new Date().toISOString()} text="${text}" voice=${voice} words=${text.split(/\s+/).filter(Boolean).length}` +
          ` route=speech auth=${auth.present}`,
      );
      say(200, ' (synthesis)');
      res.writeHead(200, { 'Content-Type': 'audio/pcm' });
      res.end(pcmFor(SILENCE_SECONDS));
      return;
    }
    say(404);
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`not found: ${req.method} ${req.url}`);
  });
});

server.listen(PORT, '127.0.0.1', () =>
  console.log(`at-sign fake openai on http://127.0.0.1:${PORT} (log ${LOG}, clip ${SILENCE_SECONDS} s)`),
);
