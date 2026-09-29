#!/usr/bin/env node
// A fake Kokoro-FastAPI for verifying #86 on the simulator (skips-while-playing.md). Serves
// the two routes `src/core/providers/local/kokoro.ts` calls:
//
//   GET  /v1/audio/voices      -> { voices: [{ id, name }] }
//   POST /dev/captioned_speech -> { audio: base64(PCM 24 kHz 16-bit LE mono),
//                                   timestamps: [{ word, start_time, end_time }] }
//
// Every synthesis request is logged with a counter and a millisecond wall-clock
// time, which is the evidence for "the Clip was asked for at the press, not
// 600 ms later":
//
//   <counter> <ISO-ms> text="<input>" voice=<voice> words=<n>
//
// Each clip is SILENCE_SECONDS of quiet PCM — the volume is zero anyway, and a
// fixed length makes every sentence last the same, long enough that a press
// landing mid-sentence would still have old audio left if it kept playing.
//
//   node test/manual-test/player-and-reading-held/fake-kokoro.cjs [PORT]   # default 8791

const { Buffer } = require('node:buffer');
const http = require('node:http');

const PORT = Number(process.argv[2] ?? 8791);
const LOG = process.env.OPENREADER_FAKE_TTS_LOG ?? '/tmp/openreader-issue86/fake-tts.log';
const SAMPLE_RATE = 24000;
const SILENCE_SECONDS = 2.5;

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

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    if (req.method === 'GET' && req.url.includes('/v1/audio/voices')) {
      const body = JSON.stringify({ voices: [{ id: 'af_bella', name: 'Bella (fake)' }] });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }
    if (req.method === 'POST' && req.url.includes('/dev/captioned_speech')) {
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
      const line = `${served} ${new Date().toISOString()} text="${text}" voice=${voice} words=${text.split(/\s+/).filter(Boolean).length}`;
      console.log(line);
      require('node:fs').appendFileSync(LOG, line + '\n');
      const body = JSON.stringify({
        audio: pcmFor(SILENCE_SECONDS).toString('base64'),
        timestamps: timestampsFor(text),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`not found: ${req.method} ${req.url}`);
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`fake kokoro on http://127.0.0.1:${PORT}`));
