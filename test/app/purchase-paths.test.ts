import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { endedQuestion, readAloudValue, trialQuestion, UNAVAILABLE } from '../../src/app/purchase';
import { DAY_MS } from '../../src/purchase/products';
import { pin } from '../structural';

/**
 * #148, ADR 0075: every way the app speaks waits on the Trial and the Unlock.
 *
 * The gate's behaviour is tested beside it (`test/purchase/`,
 * `runtime-purchase.test.ts`). What those cannot see is a new way to speak
 * that never reaches it, so this sweep reads the source, as
 * `consent-paths.test.ts` does for Consent.
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
const calling = (pattern: RegExp) => files.filter((path) => pattern.test(read(path)));
function between(text: string, start: string, end: string, where: string): string {
  pin(text, start, where);
  pin(text, end, where);
  return text.slice(text.indexOf(start), text.indexOf(end));
}
/** The text with its comments removed, roughly: what the app can show, not what its authors wrote about it. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('a Reading speaks only through the gate', () => {
  const reading = read('src/app/use-reading.ts');

  it('asks in play() before anything starts, and starts only when allowed', () => {
    const play = between(reading, '  const play = useCallback(() => {', '   * The section Play was looking for has arrived', 'play() in src/app/use-reading.ts');
    pin(play, 'if (endedRef.current || purchases.allowsSpeech()) {', 'play()');
    pin(play, 'void purchases.askForSpeech().then((yes) => {', 'play()');
    pin(play, 'if (yes) startRef.current();', 'play()');
  });

  it('asks Consent only after that, inside start(), which builds the one engine', () => {
    const start = between(reading, '  const start = useCallback(() => {', '  }, [settings, build, report, walkForward', 'start() in src/app/use-reading.ts');
    pin(start, 'consent.again();', 'start()');
    pin(start, 'const job = build();', 'start()');
    // The engine is built in one place, and saved clips play only through it (ADR 0075).
    expect(reading.split('build()').length - 1).toBe(1);
  });

  it('carries a Reading on without asking only after a press already let through, or a Pronunciation', () => {
    // The cover-page walk and the wait for a place, both after a press; and `carryOn`.
    expect(reading.match(/\bstart\(\);/g)).toHaveLength(3);
    pin(reading, 'carryOn: start,', 'src/app/use-reading.ts');
    expect(calling(/\.carryOn\(\)/)).toEqual(['src/app/use-lookup.ts']);
    pin(read('src/app/use-lookup.ts'), 'resume: () => latest.current.reading.carryOn(),', 'src/app/use-lookup.ts');
  });

  it('gives the Player, the Lock Screen and the headphones the gated play', () => {
    const view = read('src/app/reading-view.tsx');
    pin(view, "onIntent: (intent) => (intent === 'play' ? play() : pause()),", 'src/app/reading-view.tsx');
    const wrapper = between(view, '  const play = useCallback(() => {', '  }, [reading.play, reading.resumeAt', 'play in src/app/reading-view.tsx');
    pin(wrapper, 'reading.play();', 'play in src/app/reading-view.tsx');
  });
});

describe('a download speaks only through the gate', () => {
  const runtime = read('src/offline/runtime.ts');

  it('asks before Consent when it is started, so a refusal leaves no task', () => {
    const starting = between(runtime, 'export async function startDownload(', 'export function enqueue(', 'startDownload()');
    const gate = 'if (!(await purchases.askForSpeech())) return false;';
    pin(starting, gate, 'startDownload()');
    expect(starting.indexOf(gate)).toBeLessThan(starting.indexOf('consent.ensure(recipient)'));
    expect(starting.indexOf(gate)).toBeLessThan(starting.indexOf('enqueue(document, voice, chapters);'));
  });

  it('asks before Resume all and a resuming ring', () => {
    const task = between(runtime, 'export function toggleTask(', 'export function toggleChapter(', 'toggleTask()');
    pin(task, 'void purchases.askForSpeech().then((yes) => { if (yes) toggleTask(task); });', 'toggleTask()');
    expect(task.indexOf('purchases.allowsSpeech()')).toBeLessThan(task.indexOf('pausing.resumeAll(task);'));
    const ring = between(runtime, 'export function toggleChapter(', 'export async function deleteDownloaded(', 'toggleChapter()');
    pin(ring, 'if (resumes && !purchases.allowsSpeech()) {', 'toggleChapter()');
    expect(ring.indexOf('purchases.allowsSpeech()')).toBeLessThan(ring.indexOf('pausing.tapChapter('));
  });

  it('holds the scheduler back without a question, and lets it go when allowed', () => {
    const allowed = between(runtime, '  allowed: () =>', '  // Where the hidden rendering prepares', 'the scheduler\'s allowed()');
    pin(allowed, 'purchases.allowsSpeech() &&', 'the scheduler\'s allowed()');
    expect(allowed).not.toContain('askForSpeech');
    pin(runtime, 'const unlocked = purchases.subscribe(() => {', 'src/offline/runtime.ts');
  });
});

describe('the pretend App Store and the build without the lock', () => {
  it('builds the pretend App Store only in a build with Debug Mode, and the harness reaches it only there', () => {
    expect(calling(/createFakeStore\(/)).toEqual(['src/app/purchase-setup.ts', 'src/purchase/fake-store.ts']);
    const setup = read('src/app/purchase-setup.ts');
    pin(setup, 'const choice = DEBUG_MODE ? readDebugChoice() : null;', 'src/app/purchase-setup.ts');
    pin(setup, "if (choice?.use === 'fake') {", 'src/app/purchase-setup.ts');
    pin(setup.slice(setup.indexOf('export function storeCommand(')), 'if (!DEBUG_MODE) return;', 'storeCommand()');
  });

  it('configures nothing, and so calls no StoreKit, without the lock', () => {
    const configure = between(read('src/app/purchase-setup.ts'), 'function configure(): void {', 'export function startPurchases(', 'configure()');
    const off = 'if (!PURCHASE_LOCK) {';
    pin(configure, off, 'configure()');
    expect(configure.indexOf(off)).toBeLessThan(configure.indexOf('storeKitStore()'));
    expect(calling(/storeKitStore\(\)/)).toEqual(['src/app/purchase-setup.ts', 'src/purchase/storekit.ts']);
    expect(calling(/storeNative\b/)).toEqual(['src/purchase/storekit.ts']);
  });

  it('configures the gate before the downloads start', () => {
    const shell = read('src/app/shell.tsx');
    pin(shell, 'useEffect(() => startPurchases(), []);', 'src/app/shell.tsx');
    pin(shell, 'useEffect(() => startDownloads(), []);', 'src/app/shell.tsx');
    expect(shell.indexOf('startPurchases()')).toBeLessThan(shell.indexOf('startDownloads()'));
  });
});

describe('what the app says (#148)', () => {
  it('puts the questions in the words the owner approved on 2026-10-09', () => {
    expect(trialQuestion('$4.99')).toEqual({
      title: 'Read Aloud Free for 30 Days',
      message: 'After 30 days, reading aloud and offline narration need a one-time purchase of $4.99. Reading documents stays free.',
      start: 'Start Free Trial',
      notNow: 'Not Now',
    });
    expect(endedQuestion('$4.99')).toEqual({
      title: 'Your Free Trial Has Ended',
      message: 'Unlock reading aloud and offline narration for good with a one-time purchase of $4.99.',
      unlock: 'Unlock for $4.99',
      restore: 'Restore Purchase',
      notNow: 'Not Now',
    });
    expect(UNAVAILABLE).toEqual({ title: 'Purchases Unavailable', message: "The App Store can't be reached right now.", ok: 'OK' });
  });

  it('says on the Settings row only the state: days left, ended, or unlocked', () => {
    const now = Date.UTC(2026, 9, 9);
    expect(readAloudValue({ kind: 'trial', endsAt: now + 12 * DAY_MS - 60_000 }, now)).toBe('12 days left');
    expect(readAloudValue({ kind: 'trial', endsAt: now + 1 }, now)).toBe('1 day left');
    expect(readAloudValue({ kind: 'ended' }, now)).toBe('Trial ended');
    expect(readAloudValue({ kind: 'unlocked' }, now)).toBe('Unlocked');
    expect(readAloudValue({ kind: 'not-started' }, now)).toBeUndefined();
    expect(readAloudValue(null, now)).toBeUndefined();
  });

  it('names no free route anywhere the app can show: not TestFlight, not building from source', () => {
    const naming = files.filter((path) => /testflight|from source|build it yourself|EXPO_PUBLIC_OPENREADER_UNLOCKED/i.test(code(read(path))));
    // The switch's own read, which no screen shows.
    expect(naming).toEqual(['src/purchase/mode.ts']);
    expect(code(read('src/purchase/mode.ts')).match(/EXPO_PUBLIC_OPENREADER_UNLOCKED/g)).toHaveLength(1);
  });
});
