/**
 * Per-sentence against whole-paragraph synthesis, through the app's own
 * provider layer and segmenter (#61).
 *
 *   npx tsx test/manual-test/voices-and-providers/context-probe.ts survey OUT_DIR BOOK.epub…
 *   npx tsx test/manual-test/voices-and-providers/context-probe.ts pick   OUT_DIR BOOK.epub…
 *   npx tsx test/manual-test/voices-and-providers/context-probe.ts run    OUT_DIR [provider…]
 *   npx tsx test/manual-test/voices-and-providers/context-probe.ts analyze OUT_DIR [SILENCE_DB]
 *   npx tsx test/manual-test/voices-and-providers/context-probe.ts page   OUT_DIR
 *
 * `survey` counts sentences per Block; `pick` writes candidate paragraphs to
 * OUT_DIR/candidates.json, from which paragraphs.json is chosen by hand; `run`
 * synthesizes each paragraph once per Utterance and once whole and saves the
 * audio with its word timings; `analyze` measures what was saved; `page` writes the blind listening page. Everything goes to OUT_DIR,
 * which must be outside the repository: it holds the owner's book text.
 *
 * The Blocks are `node-kit.ts`'s approximation of the renderer's walk.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createProvider } from '../../../src/core/providers/factory';
import type { ProviderId, Timestamp, TTSProvider } from '../../../src/core/providers/types';
import { prepareSpeechText } from '../../../src/core/speech-text';
import { pcm16ToWav } from '../../../src/core/wav';
import { loadSettings, QueryHeaderWebSocket, readEpub, toPcm, utterancesOf, VOICE_MATCH, type Pcm } from '../kit/node-kit';

// ---------- survey ----------

const quantile = (sorted: number[], q: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! : 0;

function survey(out: string, books: string[]) {
  const rows: string[] = [];
  for (const path of books) {
    const { title, sections } = readEpub(path);
    // Chapters, not front matter: the sections with at least 20 Blocks.
    const chapters = sections.filter((s) => s.blocks.length >= 20).slice(0, 30);
    const perBlock: number[] = [];
    const chars: number[] = [];
    let utterances = 0;
    let alone = 0;
    for (const chapter of chapters) {
      const count = new Map<number, number>();
      for (const u of utterancesOf(chapter.blocks)) {
        if (!u.speakable) continue;
        utterances++;
        const b = u.spans[0]!.block;
        count.set(b, (count.get(b) ?? 0) + 1);
      }
      for (const [b, n] of count) {
        if (chapter.blocks[b]!.role === 'heading') continue;
        perBlock.push(n);
        chars.push(chapter.blocks[b]!.text.trim().length);
        if (n === 1) alone++;
      }
    }
    perBlock.sort((a, b) => a - b); chars.sort((a, b) => a - b);
    const multi = perBlock.filter((n) => n > 1);
    const inMulti = multi.reduce((a, b) => a + b, 0);
    const hist = [1, 2, 3, 4, 5].map((n) => `${n}:${perBlock.filter((m) => (n === 5 ? m >= 5 : m === n)).length}`).join(' ');
    rows.push([
      `${title} (${chapters.length} chapters, ${perBlock.length} Blocks, ${utterances} Utterances)`,
      `  sentences per Block: median ${quantile(perBlock, 0.5)}, p90 ${quantile(perBlock, 0.9)}, max ${perBlock.at(-1)}; histogram ${hist} (5 = 5 or more)`,
      `  characters per Block: median ${quantile(chars, 0.5)}, p90 ${quantile(chars, 0.9)}, max ${chars.at(-1)}`,
      `  Utterances alone in their Block: ${alone} of ${utterances} (${(100 * alone / utterances).toFixed(1)}%); in Blocks of 2+: ${inMulti} (${(100 * inMulti / utterances).toFixed(1)}%)`,
    ].join('\n'));
  }
  const report = rows.join('\n\n');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'survey.txt'), report + '\n');
  console.log(report);
}

// ---------- pick ----------

export type Paragraph = { id: string; book: string; section: string; kind: string; utterances: string[] };

/** Blocks of 3–6 sentences and 250–800 characters, tagged by what might need context, for choosing paragraphs.json by hand. */
function pick(out: string, books: string[]) {
  const candidates: (Paragraph & { tags: string[] })[] = [];
  for (const path of books) {
    const { title, sections } = readEpub(path);
    for (const chapter of sections.filter((s) => s.blocks.length >= 20).slice(0, 30)) {
      const byBlock = new Map<number, string[]>();
      for (const u of utterancesOf(chapter.blocks)) {
        if (!u.speakable || u.spans.length !== 1) continue;
        const b = u.spans[0]!.block;
        byBlock.set(b, [...(byBlock.get(b) ?? []), u.text]);
      }
      for (const [b, texts] of byBlock) {
        const length = chapter.blocks[b]!.text.trim().length;
        if (chapter.blocks[b]!.role === 'heading' || texts.length < 3 || texts.length > 6 || length < 250 || length > 800) continue;
        const joined = texts.join(' ');
        const tags = [
          /["\u201c\u201d]/.test(joined) && 'dialogue',
          /\d/.test(joined) && 'numbers',
          /[\[\]<>]/.test(joined) && 'brackets',
          Math.min(...texts.map((t) => t.length)) < 25 && 'short',
        ].filter((t): t is string => !!t);
        candidates.push({ id: `${candidates.length}`, book: title, section: chapter.href, kind: '', tags, utterances: texts });
      }
    }
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'candidates.json'), JSON.stringify(candidates, null, 1));
  console.log(`${candidates.length} candidates`);
  const byTag = new Map<string, number>();
  for (const c of candidates) for (const t of c.tags.length ? c.tags : ['plain']) byTag.set(t, (byTag.get(t) ?? 0) + 1);
  console.log([...byTag].map(([t, n]) => `${t}:${n}`).join(' '));
}

// ---------- run ----------

const WINDOW_S = 0.01;
function silentWindows(pcm: Pcm, silenceDb: number): boolean[] {
  const size = Math.round(pcm.rate * WINDOW_S);
  const rms: number[] = [];
  for (let at = 0; at < pcm.samples.length; at += size) {
    let sum = 0;
    const end = Math.min(pcm.samples.length, at + size);
    for (let i = at; i < end; i++) sum += pcm.samples[i]! * pcm.samples[i]!;
    rms.push(Math.sqrt(sum / Math.max(1, end - at)));
  }
  const loudest = Math.max(1, ...rms);
  const floor = loudest * 10 ** (silenceDb / 20);
  return rms.map((r) => r < floor);
}

function edges(pcm: Pcm, silenceDb: number): { leading: number; trailing: number } {
  const silent = silentWindows(pcm, silenceDb);
  let lead = 0; while (lead < silent.length && silent[lead]) lead++;
  let trail = 0; while (trail < silent.length && silent[silent.length - 1 - trail]) trail++;
  return { leading: lead * WINDOW_S, trailing: trail * WINDOW_S };
}

/** The longest run of silence between two moments of a clip, in seconds. */
function longestSilence(pcm: Pcm, from: number, to: number, silenceDb: number): number {
  const silent = silentWindows(pcm, silenceDb);
  let best = 0, run = 0;
  for (let w = Math.max(0, Math.floor(from / WINDOW_S)); w < Math.min(silent.length, Math.ceil(to / WINDOW_S)); w++) {
    run = silent[w] ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best * WINDOW_S;
}

const words = (text: string) => [...new Intl.Segmenter('en', { granularity: 'word' }).segment(text)].filter((s) => s.isWordLike).length;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** What one request mode produced for one paragraph, kept so that `analyze` can be rerun without paying for synthesis again. */
type RawMode = { requestsMs: number[]; notes: string[]; clips: { samples: number; stamps: Timestamp[] }[] };
type Raw = { provider: string; voice: string; voiceId: string; id: string; kind: string; speech: string[]; rate: number; perSentence: RawMode; wholeParagraph: RawMode };

async function synthesize(provider: TTSProvider, voice: string, text: string): Promise<{ pcm: Pcm; stamps: Timestamp[]; note?: string; ms: number }> {
  const started = performance.now();
  const result = await provider.synthesize(text, { voice, signal: AbortSignal.timeout(120_000) });
  const ms = Math.round(performance.now() - started);
  const pcm = toPcm(result);
  if (!pcm.samples.length) throw new Error(`empty clip for ${JSON.stringify(text.slice(0, 40))}`);
  return { pcm, stamps: result.timestamps ?? [], note: result.note, ms };
}

async function run(out: string, only: string[]) {
  const paragraphs = JSON.parse(readFileSync(join(out, 'paragraphs.json'), 'utf8')) as Paragraph[];
  const settings = loadSettings();
  const deps = { fetch, getWebSocket: () => QueryHeaderWebSocket, newRequestId: () => randomUUID().replace(/-/g, '') };
  const providers = (only.length ? only : ['azure', 'fish', 'speechify', 'local']) as ProviderId[];
  mkdirSync(join(out, 'audio'), { recursive: true });

  for (const id of providers) {
    const provider = createProvider(id, settings, deps);
    let voices;
    try { voices = await provider.listVoices({ signal: AbortSignal.timeout(30_000) }); } catch (e) { console.log(`${id}: no voice list (${String(e)}), skipped`); continue; }
    const voice = voices.find((v) => VOICE_MATCH[id]!(v.id, v.label, v.locale)) ?? voices.find((v) => v.locale.startsWith('en'));
    if (!voice) { console.log(`${id}: no English voice, skipped`); continue; }
    console.log(`${id}: ${voice.label} (${voice.id})`);
    // One request to open the connection first, as the app warms it (ADR 0040), so the first measured request pays no handshake.
    await synthesize(provider, voice.id, 'Hello.');

    for (const paragraph of paragraphs) {
      const speech = paragraph.utterances.map((u) => prepareSpeechText(u, true).text);
      const tag = `${id}-${paragraph.id}`;

      // Per sentence: one request per Utterance, one after another, joined with no gap as the app plays them at 1.0×.
      const perSentence: RawMode = { requestsMs: [], notes: [], clips: [] };
      const pcms: Pcm[] = [];
      for (const text of speech) {
        const clip = await synthesize(provider, voice.id, text);
        perSentence.requestsMs.push(clip.ms);
        if (clip.note) perSentence.notes.push(clip.note);
        perSentence.clips.push({ samples: clip.pcm.samples.length, stamps: clip.stamps });
        pcms.push(clip.pcm);
      }
      const rate = pcms[0]!.rate;
      if (pcms.some((c) => c.rate !== rate)) throw new Error(`${tag}: clips at different rates`);
      const stitched = new Int16Array(pcms.reduce((n, c) => n + c.samples.length, 0));
      let at = 0;
      for (const c of pcms) { stitched.set(c.samples, at); at += c.samples.length; }
      writeFileSync(join(out, 'audio', `${tag}-sentence.wav`), pcm16ToWav(new Uint8Array(stitched.buffer), rate));

      // Whole paragraph: one request, the Speech Texts joined by a space.
      const whole = await synthesize(provider, voice.id, speech.join(' '));
      if (whole.pcm.rate !== rate) throw new Error(`${tag}: paragraph at ${whole.pcm.rate} Hz, sentences at ${rate}`);
      writeFileSync(join(out, 'audio', `${tag}-paragraph.wav`), pcm16ToWav(new Uint8Array(whole.pcm.samples.buffer), rate));
      const wholeParagraph: RawMode = { requestsMs: [whole.ms], notes: whole.note ? [whole.note] : [], clips: [{ samples: whole.pcm.samples.length, stamps: whole.stamps }] };

      const raw: Raw = { provider: id, voice: voice.label, voiceId: voice.id, id: paragraph.id, kind: paragraph.kind, speech, rate, perSentence, wholeParagraph };
      writeFileSync(join(out, 'audio', `${tag}.json`), JSON.stringify(raw));
      console.log(`  ${paragraph.id}: ${perSentence.requestsMs.join('+')} ms per sentence, ${whole.ms} ms whole`);
    }
  }
}

// ---------- analyze ----------

function readWav(path: string): Pcm {
  const bytes = readFileSync(path);
  const rate = bytes.readUInt32LE(24);
  const data = bytes.subarray(44);
  return { samples: new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)), rate };
}

const slice = (pcm: Pcm, from: number, to: number): Pcm => ({ samples: pcm.samples.subarray(from, to), rate: pcm.rate });
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : NaN; };

/**
 * Every measured number, from the saved clips. `silenceDb` is where silence
 * starts below each clip's loudest 10 ms: a voice with breath or room noise
 * under its pauses (Fish's narrator sits near −37 dB) needs a higher one.
 */
function analyze(out: string, silenceDb: number) {
  const files = execFileSync('ls', [join(out, 'audio')]).toString().split('\n').filter((f) => /^[a-z]+-P\d+\.json$/.test(f));
  const rows: Record<string, unknown>[] = [];
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(out, 'audio', file), 'utf8')) as Raw;
    const tag = file.replace(/\.json$/, '');
    const joined = raw.speech.join(' ');

    // Per sentence: the trailing silence of one clip plus the leading silence of the next.
    const stitched = readWav(join(out, 'audio', `${tag}-sentence.wav`));
    const clips: Pcm[] = [];
    let at = 0;
    for (const c of raw.perSentence.clips) { clips.push(slice(stitched, at, at + c.samples)); at += c.samples; }
    const sentencePauses = clips.slice(0, -1).map((c, i) => r3(edges(c, silenceDb).trailing + edges(clips[i + 1]!, silenceDb).leading));

    // Whole paragraph: at each sentence boundary, the gap the word timings leave and the longest silence from the last word's start to the next first word's end.
    const whole = readWav(join(out, 'audio', `${tag}-paragraph.wav`));
    const stamps = raw.wholeParagraph.clips[0]!.stamps;
    const timingGaps: (number | null)[] = [];
    const paragraphPauses: (number | null)[] = [];
    let offset = 0;
    for (let i = 0; i + 1 < raw.speech.length; i++) {
      const end = offset + raw.speech[i]!.length;
      const next = end + 1;
      const last = stamps.filter((t) => t.charEnd <= end).at(-1);
      const first = stamps.find((t) => t.charStart >= next);
      timingGaps.push(last && first ? r3(first.start - last.end) : null);
      paragraphPauses.push(last && first ? r3(longestSilence(whole, last.start, first.end, silenceDb)) : null);
      offset = next;
    }
    rows.push({
      provider: raw.provider, voice: raw.voice, id: raw.id, kind: raw.kind, sentences: raw.speech.length, characters: joined.length, words: words(joined),
      firstAudioMs: [raw.perSentence.requestsMs[0], raw.wholeParagraph.requestsMs[0]],
      totalMs: [raw.perSentence.requestsMs.reduce((a, b) => a + b, 0), raw.wholeParagraph.requestsMs[0]],
      duration: [r3(stitched.samples.length / stitched.rate), r3(whole.samples.length / whole.rate)],
      timedWords: [raw.perSentence.clips.reduce((n, c) => n + c.stamps.length, 0), stamps.length],
      boundariesLocated: `${paragraphPauses.filter((p) => p !== null).length}/${raw.speech.length - 1}`,
      sentencePauses, paragraphPauses, timingGaps,
      notes: [...raw.perSentence.notes, ...raw.wholeParagraph.notes],
    });
  }
  writeFileSync(join(out, `analysis${silenceDb}.json`), JSON.stringify(rows, null, 1));

  const lines: string[] = [`silence below ${silenceDb} dB of each clip's loudest 10 ms window`];
  for (const provider of [...new Set(rows.map((r) => r.provider as string))]) {
    const mine = rows.filter((r) => r.provider === provider);
    const col = (key: string, i: number) => mine.map((r) => (r[key] as number[])[i]!);
    const sp = mine.flatMap((r) => r.sentencePauses as number[]);
    const pp = mine.flatMap((r) => (r.paragraphPauses as (number | null)[]).filter((x): x is number => x !== null));
    const tg = mine.flatMap((r) => (r.timingGaps as (number | null)[]).filter((x): x is number => x !== null));
    lines.push(`${provider} (${mine[0]!.voice}), ${mine.length} paragraphs`,
      `  first audio, ms: per sentence median ${median(col('firstAudioMs', 0))} [${col('firstAudioMs', 0).join(', ')}]; whole median ${median(col('firstAudioMs', 1))} [${col('firstAudioMs', 1).join(', ')}]`,
      `  duration, s: per sentence ${r3(col('duration', 0).reduce((a, b) => a + b, 0))}; whole ${r3(col('duration', 1).reduce((a, b) => a + b, 0))}`,
      `  timed words: per sentence ${col('timedWords', 0).reduce((a, b) => a + b, 0)}; whole ${col('timedWords', 1).reduce((a, b) => a + b, 0)}; of ${mine.reduce((n, r) => n + (r.words as number), 0)} words; boundaries located ${mine.map((r) => r.boundariesLocated).join(' ')}`,
      `  pause at a sentence boundary, s: per sentence median ${median(sp)} (${Math.min(...sp)}–${Math.max(...sp)}); whole median ${median(pp)} (${Math.min(...pp)}–${Math.max(...pp)}); timing gap median ${median(tg)} (${Math.min(...tg)}–${Math.max(...tg)})`);
  }
  const report = lines.join('\n');
  writeFileSync(join(out, `analysis${silenceDb}.txt`), report + '\n');
  console.log(report);
}

// ---------- page ----------

/**
 * The blind listening page: each provider's paragraphs as A/B pairs, the order
 * drawn per pair in the browser and kept in its localStorage, the key shown only
 * once every pair is answered (or the rest are given up). Local only: it holds
 * the owner's book text.
 */
function page(out: string) {
  const paragraphs = JSON.parse(readFileSync(join(out, 'paragraphs.json'), 'utf8')) as Paragraph[];
  const files = execFileSync('ls', [join(out, 'audio')]).toString().split('\n').filter((f) => /^[a-z]+-P\d+\.json$/.test(f));
  const pairs = files.map((f) => {
    const raw = JSON.parse(readFileSync(join(out, 'audio', f), 'utf8')) as Raw;
    return { key: `${raw.provider}-${raw.id}`, provider: raw.provider, voice: raw.voice, id: raw.id };
  }).sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id, 'en', { numeric: true }));
  const texts = Object.fromEntries(paragraphs.map((p) => [p.id, { kind: p.kind, book: p.book, text: p.utterances.join(' ') }]));
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sentence or Paragraph</title>
<style>
:root { --bg: #fbfbfa; --fg: #1d1d1f; --muted: #6e6e73; --line: #d9d9de; --card: #fff; --accent: #0a64d8; }
@media (prefers-color-scheme: dark) { :root { --bg: #161617; --fg: #f2f2f4; --muted: #a1a1a6; --line: #38383c; --card: #1f1f21; --accent: #4c9bff; } }
body { background: var(--bg); color: var(--fg); font: 15px/1.5 -apple-system, system-ui, sans-serif; margin: 0; }
main { max-width: 760px; margin: 0 auto; padding: 24px 16px 80px; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 17px; margin: 28px 0 8px; }
.muted { color: var(--muted); }
.pair { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px; margin: 10px 0; }
.row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin: 6px 0; }
.row b { width: 1.2em; } audio { flex: 1; min-width: 220px; height: 36px; }
.choices { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.choices button { font: inherit; padding: 6px 14px; border-radius: 16px; border: 1px solid var(--line); background: transparent; color: var(--fg); cursor: pointer; }
.choices button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
details { margin-top: 6px; } summary { cursor: pointer; color: var(--muted); }
#done button { font: inherit; padding: 8px 16px; border-radius: 18px; border: 0; background: var(--accent); color: #fff; cursor: pointer; }
textarea { width: 100%; min-height: 220px; font: 12px ui-monospace, monospace; background: var(--card); color: var(--fg); border: 1px solid var(--line); border-radius: 8px; box-sizing: border-box; }
</style></head><body><main>
<h1>Sentence or Paragraph</h1>
<p class="muted">In each pair, one recording asked the voice for one sentence at a time, and the other asked for the whole paragraph at once. Which one is which is drawn at random for each pair. Pick the one that sounds better, or “Same”. The key appears once every pair has an answer.</p>
<div id="pairs"></div>
<div id="done"><p class="muted" id="left"></p><button id="finish">Stop here and show the key</button></div>
<div id="key"></div>
<script>
const PAIRS = ${JSON.stringify(pairs)};
const TEXTS = ${JSON.stringify(texts)};
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const order = store.get('order') || {}; const answers = store.get('answers') || {};
for (const p of PAIRS) if (!(p.key in order)) order[p.key] = Math.random() < 0.5 ? ['sentence', 'paragraph'] : ['paragraph', 'sentence'];
store.set('order', order);
const root = document.getElementById('pairs'); let provider = '';
for (const p of PAIRS) {
  if (p.provider !== provider) { provider = p.provider; const h = document.createElement('h2'); h.textContent = p.provider + ' — ' + p.voice; root.append(h); }
  const t = TEXTS[p.id]; const div = document.createElement('div'); div.className = 'pair';
  div.innerHTML = '<div><b>' + p.id + '</b> <span class="muted">' + t.kind + '</span></div>' +
    ['A', 'B'].map((l, i) => '<div class="row"><b>' + l + '</b><audio controls preload="none" src="audio/' + p.key + '-' + order[p.key][i] + '.wav"></audio></div>').join('') +
    '<div class="choices">' + ['A', 'B', 'Same'].map((c) => '<button data-c="' + c + '">' + (c === 'Same' ? 'Same' : c + ' is better') + '</button>').join('') + '</div>' +
    '<details><summary>Text</summary><p></p></details>';
  div.querySelector('details p').textContent = t.text + ' (' + t.book + ')';
  for (const b of div.querySelectorAll('button')) {
    if (answers[p.key] === b.dataset.c) b.classList.add('on');
    b.onclick = () => { answers[p.key] = b.dataset.c; store.set('answers', answers); for (const o of div.querySelectorAll('button')) o.classList.toggle('on', o === b); update(); };
  }
  // One recording at a time.
  for (const a of div.querySelectorAll('audio')) a.onplay = () => { for (const o of document.querySelectorAll('audio')) if (o !== a) o.pause(); };
  root.append(div);
}
function reveal() {
  const lines = ['pair\\tanswer\\tA\\tB\\tpreferred']; const tally = {};
  for (const p of PAIRS) {
    const a = answers[p.key]; const pref = !a ? 'skipped' : a === 'Same' ? 'same' : order[p.key][a === 'A' ? 0 : 1];
    lines.push([p.key, a || '-', order[p.key][0], order[p.key][1], pref].join('\\t'));
    const t = tally[p.provider] = tally[p.provider] || { sentence: 0, paragraph: 0, same: 0, skipped: 0 }; t[pref]++;
  }
  lines.push(''); for (const [k, t] of Object.entries(tally)) lines.push(k + ': paragraph ' + t.paragraph + ', sentence ' + t.sentence + ', same ' + t.same + (t.skipped ? ', skipped ' + t.skipped : ''));
  document.getElementById('key').innerHTML = '<h2>Key</h2><p class="muted">Copy this back into the conversation.</p><textarea readonly></textarea>';
  document.querySelector('#key textarea').value = lines.join('\\n');
  store.set('revealed', true);
}
function update() {
  const left = PAIRS.filter((p) => !answers[p.key]).length;
  document.getElementById('left').textContent = left ? left + ' of ' + PAIRS.length + ' pairs left.' : 'All pairs answered.';
  if (!left || store.get('revealed')) reveal();
}
document.getElementById('finish').onclick = reveal;
update();
</script></main></body></html>
`;
  writeFileSync(join(out, 'listen.html'), html);
  console.log(join(out, 'listen.html'));
}

// ---------- main ----------

const [command, out, ...rest] = process.argv.slice(2);
if (!command || !out) {
  console.error('usage: context-probe.ts survey|pick|run|page OUT_DIR …');
  process.exit(64);
}
if (command === 'survey') survey(out, rest);
else if (command === 'pick') pick(out, rest);
else if (command === 'run') void run(out, rest).catch((e) => { console.error(e); process.exit(1); });
else if (command === 'analyze') analyze(out, Number(rest[0] ?? -40));
else if (command === 'page') page(out);
else { console.error(`unknown command ${command}`); process.exit(64); }
