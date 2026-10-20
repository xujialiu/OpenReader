#!/usr/bin/env node
// A two-voice variant of `../player-and-reading-held/fake-kokoro.cjs`, for
// #306's device verification: "Delete all current voice audio" needs a
// Document with saved audio in two different Voices of one no-cost Provider,
// and the one-voice fake can only ever give the first. Everything else is the
// same fake Kokoro-FastAPI: silent PCM clips, a request log whose `text=`
// lines count synthesis requests only, and the same optional controls.
//
//   node test/manual-test/downloads/fake-kokoro-two-voices.cjs [PORT]   # default 8811
//
// OPENREADER_FAKE_TTS_LOG         the log file (default /tmp/openreader-306/fake-tts.log)
// OPENREADER_FAKE_TTS_VOICES      a JSON array of {id, name}; default af_bella + af_nova
// OPENREADER_FAKE_TTS_SECONDS     the clip length (default 2.5 s)
// OPENREADER_FAKE_TTS_DELAY_MS    wait this long before answering a synthesis request
// OPENREADER_FAKE_TTS_REFUSE      a JSON control file, read per request: {"refuseFrom": N}

const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PORT = Number(process.argv[2] ?? 8811);
const LOG = process.env.OPENREADER_FAKE_TTS_LOG ?? '/tmp/openreader-306/fake-tts.log';
const DELAY_MS = Number(process.env.OPENREADER_FAKE_TTS_DELAY_MS ?? 0);
const SAMPLE_RATE = 24000;
const SILENCE_SECONDS = Number(process.env.OPENREADER_FAKE_TTS_SECONDS ?? 2.5);
const VOICES = (() => {
  const raw = process.env.OPENREADER_FAKE_TTS_VOICES;
  if (raw) return JSON.parse(raw);
  return [
    { id: 'af_bella', name: 'Bella (fake)' },
    { id: 'af_nova', name: 'Nova (fake)' },
  ];
})();

fs.mkdirSync(path.dirname(LOG), { recursive: true });

let served = 0;

const pcmFor = (seconds) => Buffer.alloc(Math.round(seconds * SAMPLE_RATE) * 2, 0);

const timestampsFor = (text) => {
  const words = text.split(/\s+/).filter(Boolean);
  const span = SILENCE_SECONDS * 0.9;
  const step = words.length ? span / words.length : span;
  return words.map((word, i) => ({
    word,
    start_time: Number((i * step).toFixed(3)),
    end_time: Number(((i + 1) * step).toFixed(3)),
  }));
};

const record = (line) => {
  console.log(line);
  fs.appendFileSync(LOG, line + '\n');
};

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const auth = req.headers.authorization ? 'present' : 'absent';
    if (req.method === 'GET' && req.url.includes('/v1/audio/voices')) {
      record(`GET ${req.url} ${new Date().toISOString()} auth=${auth}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ voices: VOICES }));
      return;
    }
    if (req.method === 'GET' && req.url.includes('/v1/models')) {
      record(`GET ${req.url} ${new Date().toISOString()} auth=${auth}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'fake-tts' }] }));
      return;
    }
    const kokoro = req.method === 'POST' && req.url.includes('/dev/captioned_speech');
    const speech = req.method === 'POST' && req.url.includes('/v1/audio/speech');
    if (kokoro || speech) {
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
          ` route=${kokoro ? 'kokoro' : 'speech'} auth=${auth}`,
      );
      setTimeout(() => {
        let refuse = null;
        try { refuse = JSON.parse(fs.readFileSync(process.env.OPENREADER_FAKE_TTS_REFUSE ?? '', 'utf8')); } catch {}
        if (refuse && served >= (refuse.refuseFrom ?? Infinity) && (!refuse.sentence || text.includes(refuse.sentence))) {
          record(`${served} refused on purpose`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'fake-tts: refusing this clip on purpose' } }));
          return;
        }
        if (kokoro) {
          const body = JSON.stringify({
            audio: pcmFor(SILENCE_SECONDS).toString('base64'),
            timestamps: timestampsFor(text),
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(body);
        } else {
          res.writeHead(200, { 'Content-Type': 'audio/pcm' });
          res.end(pcmFor(SILENCE_SECONDS));
        }
      }, DELAY_MS);
      return;
    }
    record(`${req.method} ${req.url} ${new Date().toISOString()} -> 404`);
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`not found: ${req.method} ${req.url}`);
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`two-voice fake tts on http://127.0.0.1:${PORT} (log ${LOG}, voices ${VOICES.map((v) => v.id).join(', ')})`));
