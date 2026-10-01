#!/usr/bin/env node
// A fake Kokoro-FastAPI, and OpenAI-compatible speech server, for verifying #86
// (skips-while-playing.md) and #109 (voices-and-providers/consent.md). Serves:
//
//   GET  /v1/audio/voices      -> { voices: [{ id, name }] }              (both)
//   GET  /v1/models            -> { data: [{ id: 'fake-tts' }] }          (OpenAI-compatible)
//   POST /dev/captioned_speech -> { audio: base64(PCM 24 kHz 16-bit LE mono),
//                                   timestamps: [{ word, start_time, end_time }] }   (Kokoro)
//   POST /v1/audio/speech      -> the same PCM bytes, `Content-Type: audio/pcm`      (OpenAI-compatible)
//
// Every synthesis request is logged with a counter and a millisecond wall-clock
// time, which is the evidence for "the Clip was asked for at the press, not
// 600 ms later", and for "nothing was sent" (#109: no line at all):
//
//   <counter> <ISO-ms> text="<input>" voice=<voice> words=<n> route=<kokoro|speech> auth=<present|absent>
//
// `auth` says only whether an Authorization header came with the text, never its
// value, so a run can show "with your API key" without the key reaching a log.
// Every other request (the voice list, the connection check, a warm-up GET) is one
// line of its own, `GET <path> <ISO-ms> auth=<present|absent>`, with no counter, so
// `grep -c 'text='` counts synthesis requests and only those.
//
// Each clip is SILENCE_SECONDS of quiet PCM — the volume is zero anyway, and a
// fixed length makes every sentence last the same, long enough that a press
// landing mid-sentence would still have old audio left if it kept playing.
//
//   node test/manual-test/player-and-reading-held/fake-kokoro.cjs [PORT]   # default 8791
//
// OPENREADER_FAKE_TTS_LOG   the log file (default /tmp/openreader-issue86/fake-tts.log)
// OPENREADER_FAKE_TTS_DELAY_MS   wait this long before answering a synthesis
//                                request (default 0), so a download stays under
//                                way long enough to be touched (#109)
// OPENREADER_FAKE_TTS_SECONDS   the clip length (default 2.5 s); a short one
//                               walks a real chapter in seconds (#112's
//                               chapter-boundary loop)

const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PORT = Number(process.argv[2] ?? 8791);
const LOG = process.env.OPENREADER_FAKE_TTS_LOG ?? '/tmp/openreader-issue86/fake-tts.log';
const DELAY_MS = Number(process.env.OPENREADER_FAKE_TTS_DELAY_MS ?? 0);
const SAMPLE_RATE = 24000;
const SILENCE_SECONDS = Number(process.env.OPENREADER_FAKE_TTS_SECONDS ?? 2.5);

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
      const body = JSON.stringify({ voices: [{ id: 'af_bella', name: 'Bella (fake)' }] });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
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

server.listen(PORT, '127.0.0.1', () => console.log(`fake tts on http://127.0.0.1:${PORT} (log ${LOG}, delay ${DELAY_MS} ms)`));
