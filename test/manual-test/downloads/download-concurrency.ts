/**
 * How fast a download goes with one request out at a time, as the scheduler
 * sends them, against several at once: the app's own provider, segmenter and
 * Speech Text, on the owner's key and a real book.
 *
 *   npx tsx test/manual-test/downloads/download-concurrency.ts OUT_DIR BOOK.epub [LEVELS] [PER_LEVEL] [FIRST_CHAPTER] [PROVIDER]
 *   npx tsx test/manual-test/downloads/download-concurrency.ts report OUT_DIR
 *
 * LEVELS is a comma list of how many requests are out at once, run in that
 * order (default `1,4,2,8,5,1`: 1 twice, first and last, shows whether the
 * service got slower during the run). PER_LEVEL is how many sentences each
 * level sends (default 40). Every level sends different sentences, in reading
 * order from the chapters with at least 20 Blocks, starting at FIRST_CHAPTER
 * (default 0), so no text is asked for twice. PROVIDER defaults to `fish`.
 *
 * Each sentence goes through `downloadSpeech` with brackets stripped, as the
 * scheduler sends it. `fetch` is wrapped to time every request the provider
 * makes, a retried 429 included, and to keep the headers that say how many
 * requests the account may have out at once. The clips are decoded with ffmpeg
 * after the timed run, never during it, so their durations cost the
 * measurement nothing.
 *
 * Everything goes to OUT_DIR, which must be outside the repository: it holds
 * the owner's book text. `report` prints the table again from what was saved.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createProvider } from '../../../src/core/providers/factory';
import type { ProviderId, SynthesisResult } from '../../../src/core/providers/types';
import { DEFAULT_BRACKET_PAIRS } from '../../../src/core/speech-text';
import { downloadSpeech } from '../../../src/offline/speech';
import { loadSettings, QueryHeaderWebSocket, readEpub, toPcm, utterancesOf, VOICE_MATCH } from '../kit/node-kit';

/** One HTTP exchange the provider made, as `fetch` saw it. */
type Exchange = { text: string; sent: number; answered: number; status: number; limit: string | null; current: string | null; datacenter: string | null };
/** One sentence, from the scheduler's point of view: asked for, and its clip back. */
type Request = { level: number; round: number; index: number; text: string; started: number; finished: number; error?: string; bytes: number; seconds: number; exchanges: Exchange[] };
type Run = { provider: string; voice: string; book: string; levels: number[]; perLevel: number; requests: Request[] };

const HEADERS = { limit: 'ratelimit-limit-concurrency', current: 'ratelimit-current-concurrency', datacenter: 'x-fishaudio-datacenter' };

/** The text a request body carried, where the provider sent JSON with a `text` (Fish) or an `input` (Speechify, OpenAI and the servers that copy it). Azure speaks over a WebSocket, so its exchanges are not seen. */
function bodyText(init: RequestInit | undefined): string {
  try {
    if (typeof init?.body !== 'string') return '';
    const body = JSON.parse(init.body) as { text?: unknown; input?: unknown };
    return String(body.text ?? body.input ?? '');
  } catch {
    return '';
  }
}

async function run(out: string, book: string, levels: number[], perLevel: number, first: number, id: ProviderId) {
  mkdirSync(out, { recursive: true });
  const { sections } = readEpub(book);
  const pool: string[] = [];
  for (const chapter of sections.filter((s) => s.blocks.length >= 20).slice(first))
    for (const u of utterancesOf(chapter.blocks))
      if (u.speakable) pool.push(downloadSpeech(u.text, { stripBrackets: true, bracketPairs: DEFAULT_BRACKET_PAIRS }));
  const needed = levels.length * perLevel + 1;
  if (pool.length < needed) throw new Error(`the book has ${pool.length} sentences from chapter ${first}, the run needs ${needed}`);

  const exchanges: Exchange[] = [];
  const timed: typeof fetch = async (input, init) => {
    const exchange: Exchange = { text: bodyText(init), sent: performance.now(), answered: 0, status: 0, limit: null, current: null, datacenter: null };
    exchanges.push(exchange);
    const response = await fetch(input, init);
    exchange.answered = performance.now();
    exchange.status = response.status;
    exchange.limit = response.headers.get(HEADERS.limit);
    exchange.current = response.headers.get(HEADERS.current);
    exchange.datacenter = response.headers.get(HEADERS.datacenter);
    return response;
  };
  const settings = loadSettings();
  const deps = { fetch: timed, getWebSocket: () => QueryHeaderWebSocket, newRequestId: () => randomUUID().replace(/-/g, '') };
  // Speechify queues its own requests: each level's width has to reach its queue, as the app's download passes it (#64, #75).
  const providerAt = (level: number) => createProvider(id, { ...settings, speechify: { ...settings.speechify, atOnce: level, download: true } }, deps);
  const provider = providerAt(1);
  const voices = await provider.listVoices({ signal: AbortSignal.timeout(30_000) });
  const voice = voices.find((v) => VOICE_MATCH[id]?.(v.id, v.label, v.locale)) ?? voices.find((v) => v.locale.startsWith('en'));
  if (!voice) throw new Error(`${id}: no English voice`);
  console.log(`${id}: ${voice.label} (${voice.id}); ${pool.length} sentences available`);

  // One request to open the connection first, as the app warms it (ADR 0040), so no measured request pays the handshake alone.
  await provider.synthesize(pool[0]!, { voice: voice.id, signal: AbortSignal.timeout(120_000) });

  const requests: Request[] = [];
  const clips = new Map<Request, SynthesisResult>();
  let next = 1;
  for (const [round, level] of levels.entries()) {
    const batch = pool.slice(next, next + perLevel);
    next += perLevel;
    let taken = 0;
    const wide = providerAt(level);
    const began = performance.now();
    // `level` workers, each taking the next sentence as soon as its last one is back: the shape a pool in the scheduler would have.
    await Promise.all(Array.from({ length: level }, async () => {
      while (taken < batch.length) {
        const index = taken++;
        const text = batch[index]!;
        const request: Request = { level, round, index, text, started: performance.now(), finished: 0, bytes: 0, seconds: 0, exchanges: [] };
        requests.push(request);
        try {
          const clip = await wide.synthesize(text, { voice: voice.id, signal: AbortSignal.timeout(120_000) });
          clips.set(request, clip);
          request.bytes = clip.audio === 'pcm' ? clip.samples.byteLength : clip.bytes.byteLength;
        } catch (error) {
          request.error = String(error);
        }
        request.finished = performance.now();
      }
    }));
    const wall = (performance.now() - began) / 1000;
    const failed = requests.filter((r) => r.round === round && r.error).length;
    console.log(`  ${level} at once: ${batch.length} sentences in ${wall.toFixed(1)} s${failed ? `, ${failed} failed` : ''}`);
  }

  // After the timed run: which exchanges belonged to which sentence, and how long each clip is.
  for (const request of requests) {
    request.exchanges = exchanges.filter((e) => e.text.endsWith(request.text) && e.sent >= request.started - 1 && e.sent <= request.finished);
    const clip = clips.get(request);
    if (clip) {
      const pcm = toPcm(clip);
      request.seconds = pcm.samples.length / pcm.rate;
    }
  }
  const result: Run = { provider: id, voice: voice.id, book, levels, perLevel, requests };
  writeFileSync(join(out, 'run.json'), JSON.stringify(result, null, 1));
  report(out);
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : NaN;
};

function report(out: string) {
  const { provider, voice, levels, perLevel, requests } = JSON.parse(readFileSync(join(out, 'run.json'), 'utf8')) as Run;
  const lines = [`${provider} ${voice}, ${perLevel} sentences per level`, 'at once | wall s | sentences/min | chars/s | audio s | audio s per wall s | latency median / p90 / max s | 429s | failed | limit | current max'];
  for (const [round, level] of levels.entries()) {
    const mine = requests.filter((r) => r.round === round);
    const wall = (Math.max(...mine.map((r) => r.finished)) - Math.min(...mine.map((r) => r.started))) / 1000;
    const latency = mine.filter((r) => !r.error).map((r) => (r.finished - r.started) / 1000);
    const audio = mine.reduce((sum, r) => sum + r.seconds, 0);
    const chars = mine.reduce((sum, r) => sum + r.text.length, 0);
    const exchanges = mine.flatMap((r) => r.exchanges);
    const limits = [...new Set(exchanges.map((e) => e.limit).filter(Boolean))].join('/') || '-';
    const current = Math.max(0, ...exchanges.map((e) => Number(e.current ?? 0)));
    lines.push([
      level, wall.toFixed(1), (60 * mine.length / wall).toFixed(1), (chars / wall).toFixed(1), audio.toFixed(1), (audio / wall).toFixed(2),
      `${quantile(latency, 0.5).toFixed(2)} / ${quantile(latency, 0.9).toFixed(2)} / ${Math.max(...latency).toFixed(2)}`,
      exchanges.filter((e) => e.status === 429).length, mine.filter((r) => r.error).length, limits, current,
    ].join(' | '));
  }
  const errors = [...new Set(requests.map((r) => r.error).filter(Boolean))];
  if (errors.length) lines.push('', 'errors:', ...errors.map((e) => `  ${e}`));
  const text = lines.join('\n');
  writeFileSync(join(out, 'report.txt'), text + '\n');
  console.log(text);
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'report' && rest[0]) report(rest[0]);
else if (command && rest[0]) {
  const [book, levels = '1,4,2,8,5,1', perLevel = '40', first = '0', id = 'fish'] = rest;
  void run(command, book!, levels.split(',').map(Number), Number(perLevel), Number(first), id as ProviderId).catch((e) => { console.error(e); process.exit(1); });
} else {
  console.error('usage: download-concurrency.ts OUT_DIR BOOK.epub [LEVELS] [PER_LEVEL] [FIRST_CHAPTER] [PROVIDER] | report OUT_DIR');
  process.exit(64);
}
