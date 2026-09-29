import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { pin } from '../structural';

/**
 * Tripwires over the sync wiring (issue #20), in the shape of
 * `player-rules.test.ts`: each is one line the simulator found missing or
 * wrong on 2026-09-21, and each fails silently when it goes — a sync that
 * runs itself in a loop, a place re-stamped under the phone's name.
 * `use-sync.test.ts` proves the hook; these pin the callers.
 */

const SOURCE = new URL('../../src/app/', import.meta.url).pathname;

function code(name: string): string {
  return readFileSync(SOURCE + name, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function within(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  if (start < 0) throw new Error('no ' + from);
  const end = source.indexOf(to, start);
  if (end < 0) throw new Error('no ' + to + ' after ' + from);
  return source.slice(start, end + to.length);
}

describe('nothing that pokes depends on the last outcome (defect 2)', () => {
  it('takes the stable handle and the outcome apart in the shell', () => {
    const shell = code('shell.tsx');
    pin(shell, 'const { sync, last: syncLast } = useSync(settings, library);', 'shell.tsx');
    // The two app-wide moments depend on the handle and nothing else that changes per run.
    pin(shell, "if (!libraryLoading) sync.poke('launch');", 'shell.tsx, the launch effect');
    expect(within(shell, "if (!libraryLoading) sync.poke('launch');", '[libraryLoading, sync]')).not.toContain('syncLast');
    const appState = within(shell, "AppState.addEventListener('change'", '}, [sync]);');
    expect(appState).not.toContain('syncLast');
    expect(appState).toContain("sync.poke('foreground')");
    expect(appState).toContain("sync.poke('background')");
  });

  it('never lets an effect or a callback put the outcome in a dependency list', () => {
    for (const file of ['reader-screen.tsx', 'reading-view.tsx', 'library-screen.tsx', 'sync-screen.tsx']) {
      expect(code(file), file).not.toMatch(/use(Effect|Callback)\([\s\S]*?\[[^\]]*\bsyncLast\b[^\]]*\]\)/);
    }
    // The shell carries it to the screens through its one memo, which pokes nothing; nowhere else.
    const shell = code('shell.tsx');
    const memo = within(shell, 'const shell = useMemo<Shell>(', ');');
    expect(memo).toContain('syncLast');
    expect(shell.replace(memo, '')).not.toMatch(/\[[^\]]*\bsyncLast\b[^\]]*\]/);
  });

  it('opens a book once per Document Id, however many runs complete meanwhile', () => {
    // The shell's Reading opens it since #68, once per Reading.
    const screen = code('reading-host.tsx');
    const open = within(screen, "sync.poke('open');", '}, [heldId]);');
    expect(open).not.toContain('[sync');
  });
});

describe('the switch runs its first sync from the hook, once the settings are in force (defect 1)', () => {
  it('pokes on the false-to-true edge, after the refs have been updated', () => {
    const hook = code('use-sync.ts');
    const refs = hook.indexOf('settingsRef.current = settings;');
    const edge = hook.indexOf("if (!was && enabled) transport().poke('switch-on');");
    expect(refs).toBeGreaterThan(0);
    expect(edge).toBeGreaterThan(refs);
    expect(code('sync-screen.tsx')).not.toContain("poke('switch-on')");
  });
});

describe('a place a resume landed on is never written again (observation b, ADR 0031)', () => {
  const reading = code('use-reading.ts');

  it('answers no place while the cursor is on the resumed sentence', () => {
    const fn = within(reading, 'const readingPosition = useCallback(', '}, []);');
    pin(fn, 'if (at === resumedAtRef.current) return null;', 'use-reading.ts, readingPosition');
  });

  it('answers no place while a place is still pending, whose Stamp the stored position already carries (#54)', () => {
    // Without it a pause, a renumbering or leaving the screen wrote this device's
    // older sentence above a place just taken from the desktop, and carried it back.
    const fn = within(reading, 'const readingPosition = useCallback(', '}, []);');
    pin(fn, 'if (resumeRef.current) return null;', 'use-reading.ts, readingPosition');
  });

  it('remembers the landing after the seek that made it, and forgets it when the cursor moves for any other reason', () => {
    const attempt = within(reading, 'const tryResume = useCallback(', '[seekTo],');
    expect(attempt.indexOf('seekTo(found.utterance);')).toBeLessThan(attempt.indexOf('resumedAtRef.current = found.utterance;'));
    const seek = within(reading, 'const seekTo = useCallback(', '[sectionOf, abandonResume]);');
    pin(seek, 'resumedAtRef.current = null;', 'use-reading.ts, seekTo');
    const clip = within(reading, 'onClip(cue) {', 'atRef.current = cue.utterance;');
    expect(within(reading, 'onClip(cue) {', 'resumedAtRef.current = null;')).toContain('if (cue.utterance !== resumedAtRef.current) resumedAtRef.current = null;');
    expect(clip).toContain('atRef.current = cue.utterance;');
  });

  it('drops the place held for the way out when the cursor yields none, and after an adoption is taken', () => {
    const view = code('reading-view.tsx');
    pin(view, 'if (status.utterance !== null) positionRef.current = null;', 'reading-view.tsx, the position effect');
    pin(view, 'if (adopted && takePlace(adopted.position)) positionRef.current = null;', 'reading-view.tsx, the adoption effect');
    pin(view, 'if (place && reading.resumeAt(place)) positionRef.current = null;', 'reading-view.tsx, play');
  });
});

describe('leaving or pausing on an unmoved place writes nothing (defect 4, ADR 0031)', () => {
  it('asks samePlace before every write, at the one place every write goes through', () => {
    const library = code('use-library.ts');
    const reached = within(library, 'const reached = useCallback(', '[change, stamp],');
    pin(reached, 'if (held?.position && samePlace(held.position, place, held.format)) return;', 'use-library.ts, reached');
    expect(reached.indexOf('samePlace(')).toBeLessThan(reached.indexOf('change(id,'));
  });
});

describe('an adopted place asks for its section (defect 3)', () => {
  it('reveals from resumeAt and again from a failed report, and hands the renderer the whole CFI', () => {
    const reading = code('use-reading.ts');
    const reveal = within(reading, 'const revealPendingPlace = useCallback(', '}, []);');
    pin(reveal, 'bridgeRef.current?.goTo(cfi);', 'use-reading.ts, revealPendingPlace');
    // "Has that section reported" is the one set a stored place also waits on (#51),
    // which counts a section that reported no Block as reported.
    pin(reveal, 'reportedSectionsRef.current.has(section)', 'use-reading.ts, revealPendingPlace');
    const blocks = within(reading, 'const handleBlocks = useCallback(', '[adopt, walkForward, tryResume, seekTo, followRow, revealPendingPlace, stopWaitingIfArrived],');
    pin(blocks, 'if (resumeRef.current && adoptedPendingRef.current) revealPendingPlace(resumeRef.current);', 'use-reading.ts, handleBlocks');
    const resume = within(reading, 'const resumeAt = useCallback(', '[tryResume, revealPendingPlace, stopWaitingIfArrived],');
    pin(resume, 'revealPendingPlace(place);', 'use-reading.ts, resumeAt');
  });
});

describe('the status line follows the run (observation c)', () => {
  it('shows the folder line only until a run completes after the check', () => {
    const screen = code('sync-screen.tsx');
    pin(screen, 'syncLast === folderCheck.before', 'sync-screen.tsx, the folder line');
    pin(screen, 'setFolderCheck({ missing: checked.folderMissing, before: syncLast });', 'sync-screen.tsx, the check');
  });
});
