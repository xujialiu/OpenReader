/**
 * The #353 HOST source reference: one real Clip with real Word Timings from
 * the owner's actually configured Provider, synthesized through the app's own
 * provider layer (`src/core/providers`, ADR 0013) — not a copy of it and not a
 * parallel service.
 *
 * The reference is the **network/source answer** for one utterance: what the
 * Provider returned, decoded on the host. A later *native* capture (a real
 * Reading in the app, by the owning native tester) is compared against it by
 * content — duration, Timings, waveform — **not by bytes**: a new synthesis on
 * the same Provider/Voice/Speech Text is not guaranteed byte-identical (the
 * server may regenerate stochastically or serve a different cached copy), and
 * the app's native decode, resampling and time-stretch are not host-PCM16
 * hash-identical either. The hashes below prove the integrity of this saved
 * reference, and nothing more.
 *
 * It proves three things on the host alone, with no simulator, no audio output
 * and no playback:
 *
 * 1. the configured Provider answers with nonzero audio;
 * 2. the clip carries real Word Timings — nonempty, in the utterance's own
 *    character coordinates, never interpolated (ADR 0005, CONTEXT.md);
 * 3. a focused byte/Timing analyser refuses four kinds of tampered copies of
 *    this saved reference. It checks hashes, durations and Timings — it is not
 *    a rendered-continuity or waveform-alignment analyser, and it is not a
 *    detector for the live Reading's output.
 *
 * The provider chosen is the one the owner's settings actually enable with
 * Word Timings over plain HTTP (`kit/node-kit.ts`'s `loadSettings`). Credentials
 * are loaded from `~/.secrets/openreader/` in process memory only; no value is
 * printed, logged or written anywhere — every string this file prints passes
 * through the redactor built from the loaded secrets, and the recorded request
 * log keeps host + path only.
 *
 *   npx tsx test/manual-test/duo-verification/audio-reference.ts capture OUT_DIR
 *   npx tsx test/manual-test/duo-verification/audio-reference.ts verify  OUT_DIR
 *
 * `capture` makes exactly one synthesis request (one utterance, ≤ 25 words,
 * synthetic public fixture text — never owner book text) and writes the raw
 * clip, its lossless decoded PCM, the Timings and the metadata. `verify` is
 * fully offline: hashes, nonzero PCM, Timing-to-text correspondence, onset
 * energy per word, and the four negative controls. OUT_DIR is created private
 * (0700, files 0600) and must stay outside the repository.
 */

import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { createProvider } from '../../../src/core/providers/factory';
import type { Timestamp, SynthesisResult } from '../../../src/core/providers/types';
import { prepareSpeechText } from '../../../src/core/speech-text';
import { pcm16ToWav } from '../../../src/core/wav';
import { loadSettings, QueryHeaderWebSocket, toPcm, VOICE_MATCH, type Pcm } from '../kit/node-kit';

/** The synthetic utterance: 20 words, one number token, no owner text. Twenty words at Natural Pace is several seconds — enough to hold a word-level reference, small enough for the single request #353's capture needs. */
export const UTTERANCE = 'The quick brown fox jumps over the lazy dog while 12 bright lanterns float above the quiet harbor at dawn.';

// ---------- hashing and redaction ----------

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Host + path only: no query string, no userinfo, nothing a credential could ride on. */
export function sanitizeUrl(url: string): string {
  const at = new URL(url);
  return `${at.protocol}//${at.host}${at.pathname}`;
}

/** Wraps every string this command prints: loaded secret values (≥ 8 chars) become `<redacted>`. */
export function makeRedactor(secrets: readonly string[]): (text: string) => string {
  const needles = [...new Set(secrets.filter((s) => s.length >= 8))];
  return (text: string) => needles.reduce((out, s) => out.split(s).join('<redacted>'), text);
}

const bytesOf = (samples: Int16Array): Uint8Array => new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);

/** Peak absolute sample, by loop: a clip's spread is far too wide for `Math.max(...)`. */
export const peakSample = (pcm: Pcm): number => {
  let peak = 0;
  for (let i = 0; i < pcm.samples.length; i++) peak = Math.max(peak, Math.abs(pcm.samples[i]!));
  return peak;
};

// ---------- Word Timing checks (offline, pure) ----------

/**
 * Every way a Timing array can fail as a real Word Timing source: empty,
 * inverted or out-of-range times, character offsets outside the utterance, a
 * slice that is not a word of the utterance at that offset, or words out of
 * order. Never estimates anything — it only refuses.
 */
export function timingProblems(timings: readonly Timestamp[], text: string): string[] {
  const problems: string[] = [];
  if (!timings.length) return ['no word timings'];
  let lastStart = -1;
  for (const [i, t] of timings.entries()) {
    const at = `timing ${i}`;
    if (!Number.isFinite(t.start) || !Number.isFinite(t.end) || t.start < 0 || t.end <= t.start) problems.push(`${at}: bad span [${t.start}, ${t.end}]`);
    if (!Number.isInteger(t.charStart) || !Number.isInteger(t.charEnd) || t.charStart < 0 || t.charEnd <= t.charStart || t.charEnd > text.length) {
      problems.push(`${at}: bad character range [${t.charStart}, ${t.charEnd}] of ${text.length}`);
      continue;
    }
    const slice = text.slice(t.charStart, t.charEnd);
    if (!/[\p{L}\p{N}]/u.test(slice)) problems.push(`${at}: slice ${JSON.stringify(slice)} is not a word`);
    if (t.charStart <= lastStart) problems.push(`${at}: not after the previous word (charStart ${t.charStart} ≤ ${lastStart})`);
    lastStart = t.charStart;
  }
  if (timings[0]!.charStart !== 0) problems.push(`first word starts at character ${timings[0]!.charStart}, not 0`);
  return problems;
}

/**
 * Which word spans carry no sound. The onset floor is a fraction of the clip's
 * peak 10 ms-window RMS; a Timing whose window never rises above it points at
 * silence rather than at its word.
 */
export function onsetFailures(pcm: Pcm, timings: readonly Timestamp[], floorDb = 35): number[] {
  const failed: number[] = [];
  const window = Math.max(1, Math.round(pcm.rate * 0.01));
  const rms: number[] = [];
  for (let at = 0; at < pcm.samples.length; at += window) {
    const end = Math.min(pcm.samples.length, at + window);
    let sum = 0;
    for (let i = at; i < end; i++) sum += pcm.samples[i]! * pcm.samples[i]!;
    rms.push(Math.sqrt(sum / Math.max(1, end - at)));
  }
  const peak = Math.max(1, ...rms);
  const floor = peak * 10 ** (-floorDb / 20);
  const windowPeak = (fromS: number, toS: number): number => {
    const from = Math.max(0, Math.floor((fromS * pcm.rate) / window));
    const to = Math.min(rms.length, Math.max(from + 1, Math.ceil((toS * pcm.rate) / window)));
    let best = 0;
    for (let w = from; w < to; w++) best = Math.max(best, rms[w]!);
    return best;
  };
  for (const [i, t] of timings.entries()) if (windowPeak(t.start, t.end) < floor) failed.push(i);
  return failed;
}

/** The clip's own duration, in seconds, from its samples. */
export const durationS = (pcm: Pcm): number => pcm.samples.length / pcm.rate;

/**
 * A candidate copy measured against the recorded reference. Every failure is a
 * reason to refuse the copy; an honest copy fails none. The copy's duration
 * and Timings are compared as well as its hashes because an equal-frame-count
 * replacement keeps both; within this analyser — which compares hashes and
 * never waveforms — only the sample hash still tells it apart. A waveform
 * alignment could detect it by content, but that is a different analyser and
 * these controls do not test one.
 */
export function copyFailures(copy: { pcmHash: string; durationS: number; timingsHash: string; timings: readonly Timestamp[]; text: string }, reference: { pcmHash: string; durationS: number; timingsHash: string }, toleranceS = 0.05): string[] {
  const failures: string[] = [];
  if (copy.pcmHash !== reference.pcmHash) failures.push('pcm hash differs from the reference');
  if (Math.abs(copy.durationS - reference.durationS) > toleranceS) failures.push(`duration ${copy.durationS.toFixed(3)} s differs from the reference ${reference.durationS.toFixed(3)} s`);
  if (copy.timingsHash !== reference.timingsHash) failures.push('timings hash differs from the reference');
  const lastEnd = copy.timings.at(-1)?.end;
  if (lastEnd !== undefined && lastEnd > copy.durationS + 0.25) failures.push(`last Timing ends ${lastEnd.toFixed(2)} s, past the clip's ${copy.durationS.toFixed(2)} s`);
  failures.push(...timingProblems(copy.timings, copy.text).map((p) => `timings: ${p}`));
  return failures;
}

// ---------- capture ----------

type RequestRecord = { url: string; status: number; ms: number };

/** The app's provider layer over one recording `fetch`: statuses and latencies noted, headers and query strings never. */
function recordingFetch(log: RequestRecord[]): typeof fetch {
  return async (input, init) => {
    const started = performance.now();
    const response = await fetch(input, init);
    log.push({ url: sanitizeUrl(String(input)), status: response.status, ms: Math.round(performance.now() - started) });
    return response;
  };
}

function writePrivate(path: string, data: Uint8Array | string): void {
  writeFileSync(path, data, { mode: 0o600 });
}

export async function capture(outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  chmodSync(outDir, 0o700);
  const settings = loadSettings();
  const redact = makeRedactor([settings.fish.apiKey, settings.azure.apiKey, settings.speechify.apiKey]);
  const requests: RequestRecord[] = [];
  const deps = { fetch: recordingFetch(requests), getWebSocket: () => QueryHeaderWebSocket, newRequestId: () => randomUUID().replace(/-/g, '') };
  const provider = createProvider('fish', settings, deps);

  // The real Voice: the owner's own reference model, resolved through the
  // Provider's own listing — its public label, not a guessed id.
  const started = performance.now();
  const voices = await provider.listVoices({ signal: AbortSignal.timeout(30_000) });
  const listMs = Math.round(performance.now() - started);
  const voice = voices.find((v) => VOICE_MATCH.fish!(v.id, v.label, v.locale));
  if (!voice) throw new Error('the configured reference voice is not in the listing');

  const speech = prepareSpeechText(UTTERANCE, true).text;
  const beforeSynthesis = requests.length;
  const synthStart = performance.now();
  let result: SynthesisResult;
  try {
    result = await provider.synthesize(speech, { voice: voice.id, signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    // One bounded retry, and only for a network cause: never a second paid
    // attempt after a server answer.
    if ((error as { kind?: string }).kind !== 'network') throw error;
    result = await provider.synthesize(speech, { voice: voice.id, signal: AbortSignal.timeout(120_000) });
  }
  const synthMs = Math.round(performance.now() - synthStart);
  const synthesis = requests.slice(beforeSynthesis);

  const clipBytes = result.audio === 'pcm' ? result.samples : result.bytes;
  if (!clipBytes.length) throw new Error('the clip carried no bytes');
  const pcm = toPcm(result);
  if (!pcm.samples.length) throw new Error('the decoded clip carried no samples');
  const timings = result.timestamps ?? [];
  const timingsHash = sha256Hex(new TextEncoder().encode(JSON.stringify(timings)));
  const pcmBytes = bytesOf(pcm.samples);

  const meta = {
    capturedAt: new Date().toISOString(),
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    provider: 'fish',
    adapter: 'createProvider("fish") — src/core/providers/fish.ts over the app provider layer',
    recipient: synthesis.at(-1)?.url ?? 'https://api.fish.audio/v1/tts/stream/with-timestamp',
    model: settings.fish.model,
    voice: { id: voice.id, label: voice.label, locale: voice.locale },
    text: UTTERANCE,
    speech,
    request: { synthesisMs: synthMs, voiceListMs: listMs, synthesisRequests: synthesis, voiceListRequests: requests.slice(0, beforeSynthesis) },
    audio: result.audio === 'encoded'
      ? { kind: 'encoded', mediaType: result.mediaType, bytes: clipBytes.length, sha256: sha256Hex(clipBytes) }
      : { kind: 'pcm', sampleRate: result.sampleRate, bytes: clipBytes.length, sha256: sha256Hex(clipBytes) },
    pcm: { rate: pcm.rate, channels: 1, bitDepth: 16, samples: pcm.samples.length, durationS: durationS(pcm), sha256: sha256Hex(pcmBytes) },
    timings: { count: timings.length, hash: timingsHash, first: timings[0] ?? null, last: timings.at(-1) ?? null, note: result.note ?? null },
    textSha256: sha256Hex(new TextEncoder().encode(UTTERANCE)),
  };

  writePrivate(join(outDir, 'clip.mp3'), clipBytes);
  writePrivate(join(outDir, 'clip.pcm'), pcmBytes);
  writePrivate(join(outDir, 'clip.wav'), pcm16ToWav(pcmBytes, pcm.rate));
  writePrivate(join(outDir, 'timings.json'), JSON.stringify(timings, null, 1));
  writePrivate(join(outDir, 'reference.json'), JSON.stringify(meta, null, 1));

  console.log(redact(JSON.stringify({
    captured: true,
    provider: meta.provider,
    recipient: meta.recipient,
    voice: meta.voice,
    model: meta.model,
    requestMs: synthMs,
    audio: meta.audio,
    pcm: meta.pcm,
    timings: { count: timings.length, first: meta.timings.first, last: meta.timings.last, note: meta.timings.note },
    files: ['clip.mp3', 'clip.pcm', 'clip.wav', 'timings.json', 'reference.json'].map((f) => join(outDir, f)),
  }, null, 1)));
}

// ---------- verify (fully offline) ----------

/** The four negative controls: copies that the analyser must refuse. */
export function negativeControls(pcm: Pcm): { name: string; pcm: Pcm; timings?: (t: Timestamp[]) => Timestamp[] }[] {
  const seg = (from: number, to: number): { from: number; to: number } => {
    const n = pcm.samples.length;
    return { from: Math.floor(n * from), to: Math.floor(n * to) };
  };
  const a = seg(0.4, 0.45);
  const b = seg(0.6, 0.65);
  const span = a.to - a.from;
  const dropped = new Int16Array(pcm.samples.length - span);
  dropped.set(pcm.samples.subarray(0, a.from), 0);
  dropped.set(pcm.samples.subarray(a.to), a.from);
  const repeated = new Int16Array(pcm.samples.length + span);
  repeated.set(pcm.samples.subarray(0, a.to), 0);
  repeated.set(pcm.samples.subarray(a.from, a.to), a.to);
  repeated.set(pcm.samples.subarray(a.to), a.to + span);
  const replaced = new Int16Array(pcm.samples);
  replaced.set(pcm.samples.subarray(b.from, b.to), a.from);
  return [
    { name: 'drop-half-second', pcm: { samples: dropped, rate: pcm.rate } },
    { name: 'repeat-half-second', pcm: { samples: repeated, rate: pcm.rate } },
    { name: 'equal-frame-count-replace', pcm: { samples: replaced, rate: pcm.rate } },
    { name: 'timestamp-gap', pcm, timings: (ts) => ts.map((t) => ({ ...t, start: t.start + 0.4, end: t.end + 0.4 })) },
  ];
}

export async function verify(outDir: string): Promise<boolean> {
  const meta = JSON.parse(readFileSync(join(outDir, 'reference.json'), 'utf8')) as {
    text: string; speech: string; pcm: { rate: number; sha256: string; durationS: number; samples: number };
    audio: { sha256: string }; timings: { hash: string; count: number };
  };
  const timings = JSON.parse(readFileSync(join(outDir, 'timings.json'), 'utf8')) as Timestamp[];
  const clipBytes = new Uint8Array(readFileSync(join(outDir, 'clip.mp3')));
  const pcmBytes = new Uint8Array(readFileSync(join(outDir, 'clip.pcm')));
  const pcm: Pcm = { samples: new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength / 2), rate: meta.pcm.rate };
  let ok = true;
  const say = (good: boolean, line: string) => { console.log(`${good ? 'PASS' : 'FAIL'}  ${line}`); if (!good) ok = false; };

  say(meta.speech === meta.text, 'Speech Text equals the utterance: Timings are already in source coordinates');
  say(clipBytes.length > 0 && sha256Hex(clipBytes) === meta.audio.sha256, `clip bytes intact (${clipBytes.length} bytes, sha256 ${meta.audio.sha256.slice(0, 12)}…)`);
  say(sha256Hex(pcmBytes) === meta.pcm.sha256, `decoded PCM hash matches the reference (${meta.pcm.sha256.slice(0, 12)}…)`);
  let nonzero = 0;
  for (const s of pcm.samples) if (s !== 0) nonzero++;
  const peak = peakSample(pcm);
  say(nonzero > pcm.samples.length * 0.5 && peak > 1000, `PCM is real sound: ${nonzero}/${pcm.samples.length} nonzero samples, peak ${peak}`);
  say(sha256Hex(new TextEncoder().encode(JSON.stringify(timings))) === meta.timings.hash, 'timings file matches the recorded hash');
  say(timings.length === meta.timings.count && timings.length > 0, `${timings.length} Word Timings recorded`);
  const structural = timingProblems(timings, meta.text);
  say(!structural.length, structural.length ? `timings: ${structural.join('; ')}` : 'every Timing names a word of the utterance at its own character offset');
  const failed = onsetFailures(pcm, timings);
  say(!failed.length, failed.length ? `${failed.length} Timings point at silence: ${failed.join(',')}` : 'every Timing\'s span carries sound in the PCM');
  const last = timings.at(-1)!;
  say(last.end <= durationS(pcm) + 0.25, `last Timing ends ${last.end.toFixed(2)} s; clip is ${durationS(pcm).toFixed(2)} s`);
  say(Math.abs(durationS(pcm) - meta.pcm.durationS) < 0.01, `duration ${durationS(pcm).toFixed(3)} s matches the recorded ${meta.pcm.durationS.toFixed(3)} s`);

  const reference = { pcmHash: meta.pcm.sha256, durationS: meta.pcm.durationS, timingsHash: meta.timings.hash };
  for (const control of negativeControls(pcm)) {
    const ts = control.timings ? control.timings(timings) : timings;
    const failures = copyFailures({ pcmHash: sha256Hex(bytesOf(control.pcm.samples)), durationS: durationS(control.pcm), timingsHash: sha256Hex(new TextEncoder().encode(JSON.stringify(ts))), timings: ts, text: meta.text }, reference);
    say(failures.length > 0, `control ${control.name} refused: ${failures.slice(0, 3).join('; ')}`);
  }
  console.log(ok ? 'verify: PASS' : 'verify: FAIL');
  return ok;
}

if (process.argv[1]?.endsWith('audio-reference.ts')) {
  const [command, out] = process.argv.slice(2);
  if ((command !== 'capture' && command !== 'verify') || !out) {
    console.error('usage: audio-reference.ts capture|verify OUT_DIR');
    process.exit(2);
  }
  if (command === 'capture') void capture(out).catch((e) => { console.error(String(e)); process.exit(1); });
  else void verify(out).then((ok) => process.exit(ok ? 0 : 1)).catch((e) => { console.error(String(e)); process.exit(1); });
}
