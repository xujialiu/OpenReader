import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Three properties of the player that were proved on the device and cannot be
 * proved here, kept as tripwires over the source text.
 *
 * `test/README.md` is explicit that React Native components and hooks are not
 * tested in this suite by design, and that is not a gap to fill with a different
 * runner: a renderer mock would prove the mock was called. But each of the three
 * below is **one line**, deleting it is easy and plausible, and every one of them
 * fails **silently** — the reading starts at the wrong place, or the contents open
 * at the top of a two-thousand-chapter book, or a burst of presses quietly spends
 * five synthesis requests where it should spend one.
 *
 * So the same shape as `test/renderer/rules.test.ts` and
 * `test/app/no-outgoing-links.test.ts`: read the line that obeys the rule and fail
 * when it goes. Each one names the measurement in `notes/NOTES_2026-09-20.md` that
 * is the actual evidence. **These are tripwires, not proofs.**
 */

const SOURCE = new URL('../../src/app/', import.meta.url).pathname;

/**
 * The code, without the comments — the same reason `rules.test.ts` needs it: this
 * directory explains each rule where it obeys it, so a naive search finds the
 * explanation and calls it the offence.
 */
function code(name: string): string {
  return readFileSync(SOURCE + name, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * One function of a file, from its opening line to its closing one.
 *
 * Load-bearing rather than tidy: `clearTimeout(seekTimerRef.current)` and
 * `pendingSeekRef.current = null` **both appear twice** in `use-reading.ts` — once
 * in the debounce and once in the cleanup that runs when the screen goes away — so
 * a rule asserted over the whole file passes while the debounce is gutted. Three
 * mutations got through this file before it was scoped.
 */
function within(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  if (start < 0) throw new Error('no ' + from);
  const end = source.indexOf(to, start);
  if (end < 0) throw new Error('no ' + to + ' after ' + from);
  return source.slice(start, end + to.length);
}

describe('a burst of skip presses is one synthesis request (ADR 0020)', () => {
  /**
   * Measured on the device (`notes/NOTES_2026-09-20.md`, 01:12): five presses of
   * previous-sentence produced **one** `engine.seek`, 612 ms after the burst. With
   * the debounce removed and nothing else changed, the same five presses produced
   * **five** seeks in 24 ms — five restarts, five Utterances fetched, four thrown
   * away. That is the owner's money, and nothing on the screen would say so.
   */
  it('reaches the engine from exactly one place, and that place is the timer', () => {
    const reading = code('use-reading.ts');
    const seekTo = within(reading, 'const seekTo = useCallback(', '}, [sectionOf]);');
    // One call into the engine in the whole file, and it is inside this timer.
    expect(reading.match(/\.seek\(/g)).toHaveLength(1);
    expect(seekTo).toContain('setTimeout(');
    expect(seekTo).toContain('}, SKIP_DEBOUNCE_MS);');
    expect(seekTo.indexOf('setTimeout(')).toBeLessThan(seekTo.indexOf('.seek('));
    expect(seekTo).toContain('.seek(');
  });

  it('keeps both guards, because only one of them was carrying it', () => {
    // Removing the `clearTimeout` alone still produced one seek on the device,
    // because the first timer to fire takes the pending target and leaves null
    // behind for the rest — so neither half can be dropped as redundant on the
    // evidence of the other. The timer keeps one call; the payload keeps one target.
    const seekTo = within(code('use-reading.ts'), 'const seekTo = useCallback(', '}, [sectionOf]);');
    expect(seekTo).toContain('if (seekTimerRef.current) clearTimeout(seekTimerRef.current);');
    expect(seekTo).toContain('const target = pendingSeekRef.current;');
    expect(seekTo).toContain('pendingSeekRef.current = null;');
    expect(seekTo).toContain('if (target === null) return;');
  });

  it('is the number Zotero debounces by, not a number of our own', () => {
    // 600 ms, `SKIP_DEBOUNCE_DELAY` at `reader.js:39904`. A narrower one would let a
    // fast hand through; a wider one would make the reading feel stuck.
    expect(code('use-reading.ts')).toContain('const SKIP_DEBOUNCE_MS = 600;');
  });
});

describe('the reading starts where it was pointed, not at the top of the book (ADR 0020)', () => {
  /**
   * A word tapped or a chapter chosen before Play was ever pressed moves the
   * Reading Position and builds no engine — there is nothing to build one for yet.
   * The engine that is built afterwards has to be loaded there. Loading it at 0
   * reads the book from its beginning instead, with the highlight sitting on the
   * sentence the owner tapped for as long as it takes them to notice.
   */
  it('loads the engine at the Reading Position', () => {
    const reading = code('use-reading.ts');
    expect(reading).toContain('engine.load(loadedRef.current, atRef.current ?? 0);');
    expect(reading).not.toContain('engine.load(loadedRef.current, 0);');
  });
});

describe('the contents open at the chapter being read (ADR 0020)', () => {
  /**
   * The whole reason the progress bar could go: "it must mount scrolled to the
   * current chapter with that row marked, because with the progress bar gone this is
   * the only thing that answers 'where am I'." A list that opens at the top of 2,076
   * rows looks perfectly healthy and answers neither question.
   *
   * Measured on the device (01:05): 仙逆 resumed at spine item 4 and the list mounted
   * on 第1章 离乡, marked.
   */
  it('mounts scrolled to the row the reading is in, and never to the first row', () => {
    const sheet = code('contents-sheet.tsx');
    expect(sheet).toContain('initialScrollIndex={here?.row}');
    expect(sheet).not.toMatch(/initialScrollIndex=\{0\}/);
    // Without a row height it cannot scroll to an index at all, and React Native
    // drops the prop rather than saying so.
    expect(sheet).toContain('getItemLayout=');
    expect(sheet).toContain('currentRow(contents, { sectionIndex: section })');
  });
});
