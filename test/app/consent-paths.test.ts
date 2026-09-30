import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { pin } from '../structural';

/**
 * #109, ADR 0064: every way text leaves the phone goes through the consent gate.
 *
 * The gate's behaviour is tested beside it (`test/core/consent.test.ts`,
 * `runtime-consent.test.ts`, `use-lookup-consent.test.ts`). What those cannot
 * see is a new path that never reaches it: a second call to a Provider's
 * `synthesize`, or a lookup sent from somewhere else. A gate that nothing
 * passes through protects nothing, so this sweep reads the source.
 */

const ROOT = join(__dirname, '..', '..');
const SOURCE = join(ROOT, 'src');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}
const files = sourceFiles(SOURCE).map((path) => path.slice(ROOT.length + 1));
/** The files under `src/` whose text matches, outside the Provider layer, whose Providers call each other. */
const calling = (pattern: RegExp) => files.filter((path) => !path.startsWith('src/core/providers/') && pattern.test(read(path)));

/** `text` from `start` up to `end`, both markers pinned, so a slice cannot silently be the wrong one. */
function between(text: string, start: string, end: string, where: string): string {
  pin(text, start, where);
  pin(text, end, where);
  return text.slice(text.indexOf(start), text.indexOf(end));
}

describe('a Document\'s text reaches a Provider only through the gate', () => {
  it('finds source to sweep, so an empty sweep cannot pass for a clean one', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('calls a Provider\'s synthesize in two places: the runtime, and the engine\'s Clips, which call the runtime\'s', () => {
    expect(calling(/\.synthesize\s*\(/)).toEqual(['src/offline/runtime.ts', 'src/playback/clips.ts'].sort());
    pin(read('src/playback/clips.ts'), 'deps.provider.synthesize(text, {', 'src/playback/clips.ts');
  });

  it('asks in the runtime before anything is built or sent, in the one function that sends', () => {
    const runtime = read('src/offline/runtime.ts');
    pin(runtime, 'provider.synthesize(text, {', 'src/offline/runtime.ts');
    const sending = between(runtime, 'async function synthesize(', 'function clipFacts(', 'src/offline/runtime.ts');
    const gate = 'if (!(await consent.ensure(recipient)))';
    pin(sending, gate, 'synthesize() in src/offline/runtime.ts');
    expect(sending.indexOf(gate)).toBeLessThan(sending.indexOf('createProvider('));
    expect(sending.indexOf(gate)).toBeLessThan(sending.indexOf('provider.synthesize(text, {'));
  });

  it('gives the engine only the runtime\'s Provider, for the Reading and for a Voice switched to', () => {
    const reading = read('src/app/use-reading.ts');
    pin(reading, 'const provider = offlineProvider(document, settings);', 'src/app/use-reading.ts');
    pin(reading, 'const target = offlineProvider(document, next);', 'src/app/use-reading.ts');
    expect(calling(/createPlaybackEngine\s*\(/)).toEqual(['src/app/use-reading.ts', 'src/playback/engine.ts'].sort());
  });

  it('builds a Provider elsewhere only to list its Voices, which sends no text', () => {
    // A call, not the `createProvider(id, settings, deps)` that comments quote in backticks.
    expect(calling(/(?<!`)\bcreateProvider\s*\(/)).toEqual(['src/app/provider-connection.ts', 'src/app/use-voices.ts', 'src/offline/runtime.ts'].sort());
  });

  it('starts a download from the drawer only by asking first', () => {
    const sheet = read('src/app/download-sheet.tsx');
    pin(sheet, 'downloads.startDownload(document, choice, chosen)', 'src/app/download-sheet.tsx');
    expect(calling(/downloads\.enqueue\s*\(/)).toEqual([]);
    const runtime = read('src/offline/runtime.ts');
    const starting = between(runtime, 'export async function startDownload(', 'export function enqueue(', 'src/offline/runtime.ts');
    pin(starting, 'if (!(await consent.ensure(recipient))) return false;', 'startDownload() in src/offline/runtime.ts');
    expect(starting.indexOf('consent.ensure(recipient)')).toBeLessThan(starting.indexOf('enqueue(document, voice, chapters);'));
  });
});

describe('a selection reaches a lookup service only through the gate', () => {
  it('sends a lookup from one place, after asking', () => {
    expect(calling(/\bawait lookup\s*\(/)).toEqual(['src/app/use-lookup.ts']);
    const hook = read('src/app/use-lookup.ts');
    pin(hook, 'if (!(await consent.ensure(recipient))) {', 'src/app/use-lookup.ts');
    pin(hook, 'const answer = await lookup(', 'src/app/use-lookup.ts');
    expect(hook.indexOf('consent.ensure(recipient)')).toBeLessThan(hook.indexOf('const answer = await lookup('));
  });
});

/**
 * #109, the simulator run of 2026-09-30: asked only inside `synthesize`, the
 * question sat inside the clip fetcher's 60 s clock, and a Voice switch's
 * 120 s deadline was running from the choice. So an alert left open read as a
 * Provider that had stopped answering. The owner's answer is taken before
 * either clock now. These pin where, because the engine that holds the second
 * clock cannot run under Node (`engine.ts`).
 */
describe('the owner\'s answer is taken before any clock starts (#109)', () => {
  it('asks in the clip fetcher before its timed synthesis, inside the job every Utterance wanting the text shares', () => {
    const clips = read('src/playback/clips.ts');
    const job = between(clips, 'const result = (async () => {', 'job = { cleared: through, result };', 'src/playback/clips.ts');
    const ask = 'await deps.provider.ensureConsent?.(speech, { voice: deps.voice });';
    pin(job, ask, 'the job in src/playback/clips.ts');
    pin(job, 'return synthesize(key, speech);', 'the job in src/playback/clips.ts');
    expect(job.indexOf(ask)).toBeLessThan(job.indexOf('return synthesize(key, speech);'));
    // The one clock is inside `synthesize`, which the job reaches only after the answer.
    pin(clips, 'withTimeout(', 'src/playback/clips.ts');
    const timed = between(clips, 'async function synthesize(key: string, text: string)', '  return {\n    fetch(', 'src/playback/clips.ts');
    pin(timed, 'withTimeout(', 'synthesize() in src/playback/clips.ts');
  });

  it('gives the Reading\'s Provider that step, deciding who would receive the text with synthesize\'s own reading of the settings', () => {
    const runtime = read('src/offline/runtime.ts');
    pin(runtime, 'ensureConsent: (text, options) =>', 'src/offline/runtime.ts');
    const asking = between(runtime, 'async function ensureConsent(', 'async function synthesize(', 'src/offline/runtime.ts');
    const sending = between(runtime, 'async function synthesize(', 'function clipFacts(', 'src/offline/runtime.ts');
    for (const [where, text] of [['ensureConsent()', asking], ['synthesize()', sending]] as const) {
      pin(text, 'await sendable(voice, current)', `${where} in src/offline/runtime.ts`);
      pin(text, 'if (!(await consent.ensure(recipient)))', `${where} in src/offline/runtime.ts`);
    }
    // It asks and sends nothing: only `synthesize` builds a Provider.
    expect(asking).not.toMatch(/\bcreateProvider\s*\(/);
  });

  it('starts a Voice switch\'s deadline once nothing it asked for waits on the owner, never at the choice', () => {
    const engine = read('src/playback/engine.ts');
    const choosing = between(engine, 'switchVoice(provider, voice, selected, failed) {', '    cancelVoiceSwitch,\n', 'src/playback/engine.ts');
    expect(choosing).not.toMatch(/setTimeout\s*\(/);
    const starting = between(engine, 'function startDeadline(target: PendingSwitch)', 'function prepareSwitch()', 'src/playback/engine.ts');
    pin(starting, '}, 120_000);', 'startDeadline() in src/playback/engine.ts');
    pin(engine, 'if (target.uncleared.size === 0) startDeadline(target);', 'src/playback/engine.ts');
    expect(engine.match(/\bstartDeadline\(/g)).toHaveLength(2);
  });
});
