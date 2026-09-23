import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { pin } from '../structural';

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
    const seekTo = within(reading, 'const seekTo = useCallback(', '}, [sectionOf');
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
    const seekTo = within(code('use-reading.ts'), 'const seekTo = useCallback(', '}, [sectionOf');
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

describe('coming back to a book resumes the reading, not only the page (ADR 0008, 0019)', () => {
  /**
   * ADR 0019 recorded this as the thing it had not done: "playback does not resume
   * *at* that Utterance. The page is where it was; Play starts from the first
   * Utterance of what has rendered." The resolution itself is `cursor.ts`'s and is
   * tested there. What cannot be tested there is the **order** the three lines are
   * in here, and getting that wrong is silent: the page is right, the highlight is
   * right for an instant, and the voice starts somewhere else.
   */
  it('finds the Utterance in one place, and that place is tried where the Blocks arrive', () => {
    // One attempt function since issue #20, because a place can now arrive from
    // another device while the book is open and has to be tried the same way the
    // one it opened with is. Two copies of the attempt would be two chances for
    // the order below to differ.
    const reading = code('use-reading.ts');
    expect(reading.match(/resolveResume\(/g)).toHaveLength(1);
    const attempt = within(reading, 'const tryResume = useCallback(', '[seekTo],');
    expect(attempt).toContain('resolveResume(stored, next, reported)');
    const blocks = within(reading, 'const handleBlocks = useCallback(', '[adopt, walkForward, tryResume, seekTo, revealPendingPlace],');
    // `true`: the resume has pointed the cursor into the new list already, so a
    // renumbering must not carry it across a second time (#46).
    expect(blocks).toContain('tryResume(next, reported, () => adopt(next, reported, true))');
  });

  it('anchors the engine at the resumed Utterance before the longer list is adopted', () => {
    // The Utterance being seeked to exists only in the new list, so `adopt` has to
    // have handed it to the engine before `seekTo` names it — seeking into the old
    // list lands somewhere else entirely. `before` is that `adopt`, handed in by
    // `handleBlocks`; the contents tap has the same ordering for the same reason.
    const resume = within(code('use-reading.ts'), 'const tryResume = useCallback(', '[seekTo],');
    expect(resume.indexOf('atRef.current = found.utterance;')).toBeLessThan(resume.indexOf('before?.();'));
    expect(resume.indexOf('before?.();')).toBeLessThan(resume.indexOf('seekTo(found.utterance);'));
  });

  it('stops competing the moment the owner points somewhere else', () => {
    // A 2,077-section book can report the section a position names half a minute
    // after the reader opened it. Without this the bookmark would take the reading
    // away from wherever the owner had just put it — ADR 0008's "silent landing
    // three paragraphs away", arriving late instead of wrong.
    const reading = code('use-reading.ts');
    expect(within(reading, 'const seekTo = useCallback(', '}, [sectionOf')).toContain('abandonResume();');
    expect(within(reading, 'const play = useCallback(', '}, [settings, build, report, walkForward')).toContain('abandonResume();');
    expect(within(reading, 'const abandonResume = useCallback(', '}, []);')).toContain('resumeRef.current = null;');
  });
});

describe('a section that arrives mid-reading reaches the engine at once (notes/NOTES_2026-09-20.md, 04:43)', () => {
  /**
   * The list used to be held back until the next Clip boundary, because the only
   * way to give the engine a new one was the destructive `load`. The boundary is a
   * Clip *starting*, and no Clip starts when the engine has run out of text — so
   * the one moment a longer list was most needed was the one moment it could never
   * be applied. `extend` restarts nothing, so there is nothing left to wait for.
   */
  const reading = code('use-reading.ts');

  it('hands a longer list over through extend, not load', () => {
    const adopt = within(reading, 'const adopt = useCallback(', '}, [sectionOf]);');
    // A list that continues the one the engine holds goes over whole, and returns
    // before any `load` is reached.
    const continued = within(adopt, 'if (samePrefix(held.utterances, next)) {', 'return;');
    expect(continued).toContain('engine?.extend(next);');
    expect(continued).not.toContain('load(');
    // The `load`s left are a renumbering's (#46): at the sentence carried across,
    // or at the top where the sentence itself has gone — and quiet while paused,
    // so that nothing centres the page on the reading while the owner scrolls.
    expect(adopt).toContain('engine?.load(next, at ?? 0, { quiet: !playIntent.current });');
    expect(adopt).toContain('engine?.load(next, 0, { quiet: true });');
    expect(adopt).not.toContain('show(');
    expect(adopt.indexOf('engine?.load(')).toBeGreaterThan(adopt.indexOf('engine?.extend(next);'));
  });

  it('holds nothing back for a Clip boundary', () => {
    // The whole deferral, gone: a ref to park the list in, and the effect that
    // applied it when `status.utterance` changed. Either one back is the deadlock
    // back, and it would not fail — it would go quiet.
    expect(reading).not.toContain('pendingRef');
    expect(reading).not.toMatch(/useEffect\([^)]*\[status\.utterance, adopt\]\)/);
  });

  it('is told when the engine has nothing left, and stops only at the end of the book', () => {
    // The engine cannot stop itself: a drained queue renders silence and stays in
    // the playing state (notes/NOTES.md footgun 3). Stopping anywhere but the last
    // spine item would stop a reading that is about to be fed.
    expect(reading).toContain('onOutOfText: ranOutOfText,');
    const ranOut = within(reading, 'const ranOutOfText = useCallback(', '}, []);');
    expect(ranOut).toContain('outOfTextSentence(furthestSectionRef.current, renderedRef.current?.spine ?? 0, {');
    expect(ranOut).toContain('if (ended) {');
    expect(ranOut).toContain('engineRef.current?.pause();');
    expect(ranOut).toContain('playing: ended ? false : was.playing');
  });

  /**
   * And the third sentence reaches it (ADR 0023, and 07:48). The engine counts the
   * Utterances that were never spoken; if this hand-over goes, `outOfTextSentence`
   * falls back to its own default of "nothing was lost" and a Provider that dropped
   * the last clips of a document is announced as the end of the book again — which is
   * the sentence design 0023 calls a worse lie than the silence it replaced.
   */
  it('passes what was never spoken, and the refusal, into the sentence', () => {
    const ranOut = within(reading, 'const ranOutOfText = useCallback(', '}, []);');
    pin(ranOut, 'count: report.unspoken,', 'use-reading.ts, ranOutOfText');
    pin(ranOut, 'reason: report.refusal === null ? null : describe(report.refusal),', 'use-reading.ts, ranOutOfText');
  });
});

describe('changing the Voice keeps the place (ADR 0025, notes/NOTES_2026-09-20.md, 07:45)', () => {
  /**
   * The cleanup on `engineIdentity(settings)@writtenAt` is where the audio session
   * is given back, and it used to clear `atRef` with it. `play()` then found a loaded
   * list with no cursor and read from the top: changing the Voice at chapter 100 of a
   * 2,000-chapter novel started it again at chapter one, and so did pasting a key
   * while reading, because a credential write runs the same cleanup. It fails
   * silently — the reading works perfectly, somewhere else.
   *
   * Measured on the device at 07:45 before the fix and after it; the mutation that
   * proves this rule is the line going back in.
   */
  const reading = code('use-reading.ts');

  it('leaves the cursor alone when the engine is thrown away', () => {
    const cleanup = within(reading, 'const disposeEngine = useCallback(', '}, []);');
    expect(cleanup).toContain('void engine?.dispose();');
    expect(cleanup).not.toContain('atRef.current = null;');
    expect(cleanup).not.toContain('utterance: null,');
    // The one place the cursor is cleared is a renumbering that could not find its
    // sentence again, because that sentence's own section changed (#46): every
    // other renumbering carries the cursor across (`carryUtterance`).
    expect(reading.match(/atRef\.current = null;/g)).toHaveLength(1);
    pin(within(reading, 'const adopt = useCallback(', '}, [sectionOf]);'), 'atRef.current = null;', 'use-reading.ts, adopt');
  });

  it('leaves the highlight on the sentence the cursor names, rather than clearing it', () => {
    // `clear()` here is the visible half of the same defect: the page loses the
    // highlight while the player still says where the reading is. `show` paints the
    // Utterance whole, which is also what replaces the words the previous Voice was
    // cued with.
    const cleanup = within(reading, 'const disposeEngine = useCallback(', '}, []);');
    pin(cleanup, 'if (at === null) bridgeRef.current?.clear();', 'use-reading.ts, the identity cleanup');
    pin(cleanup, 'else bridgeRef.current?.show(at);', 'use-reading.ts, the identity cleanup');
  });

  it('marks the furthest section reported, not the last one to report', () => {
    // Sections render out of order, so the last to report is routinely behind the
    // furthest — and a document's last spine items are where the sections that
    // render with no text in them live.
    const blocks = within(reading, 'const handleBlocks = useCallback(', '[adopt, walkForward, tryResume, seekTo, revealPendingPlace],');
    expect(blocks).toContain('furthestSectionRef.current = Math.max(furthestSectionRef.current, section.index);');
  });
});

describe('the player names the Voice, and a resume is not an error (design 0020)', () => {
  /**
   * Two things the device found in the same minute, both of them in the view rather
   * than in what the view was given.
   *
   * The line above the play button rendered `settings.voice`:
   * `Fish Audio · zh/74c6aba5cbf94a15bbdc547ffce5cb38`, while the sheet three taps
   * away knew the Voice as 「语彤 Yutong - Female Mandarin (Mainland)」 (07:14). And a
   * resume that worked was painted in the attention colour, because `ReadingStatus`
   * keeps `resume` out of `note` on purpose and this screen merged both into one array
   * that the player drew in one style (07:27) — the distinction was made in the model
   * and thrown away in the view.
   *
   * Both are one line each and both fail silently: the caption is wrong rather than
   * missing, and the colour is wrong rather than absent.
   */
  const view = code('reading-view.tsx');
  const player = code('player.tsx');

  it('looks the Voice up in the list the Provider published', () => {
    pin(view, 'voiceInList(voices.voicesOf(settings.provider), settings.voice)', 'reading-view.tsx');
    pin(view, 'voiceInUse={voiceInUse}', 'reading-view.tsx');
    pin(player, '{voiceLine(settings, voiceInUse)}', 'player.tsx');
    // Internal ids are not user-facing captions (design 0026).
    expect(player).not.toContain('return `${provider} · ${settings.voice}`');
  });

  it('carries the tone of each line from the model to the style that paints it', () => {
    pin(view, 'if (status.resumeNeedsAttention && status.resume) said.push({ said: status.resume, attention: true });', 'reading-view.tsx');
    pin(view, "if (status.note) said.push({ said: status.note, attention: true });", 'reading-view.tsx');
    pin(player, 'style={[styles.note, note.attention && styles.noteAttention]}', 'player.tsx');
    pin(player, 'noteAttention: { color: INK.attention },', 'player.tsx');
  });

  it('claims no Highlight Level until a Clip has answered with one', () => {
    // `utterance` is set the moment Play is pressed and `level` only when a Clip
    // arrives, so the line claimed "highlighting the whole Utterance" — the Level that
    // means the Provider reported no Word Timings — for the second before it knew.
    pin(view, 'if (status.level === null) return `Reading ${where}.`;', 'reading-view.tsx, readingLine');
  });
});

describe('each Document is read in the Voice it remembers (ADR 0010)', () => {
  /**
   * `LibraryEntry.voice` was in the file format, parsed and written, and **nothing
   * ever set it** — so design 0010 described an app that did not exist, and the
   * owner's shelf read an English document in a Mandarin Voice (07:38).
   *
   * What `settingsForDocument` decides is tested in `settings.test.ts`. What cannot
   * be tested there is the wiring: that the screen hands the reading the Document's
   * settings rather than the app's, asks the Keychain about *that* Provider, and
   * writes the choice down. Each is one line, and each fails by reading the book
   * perfectly in the wrong Voice.
   */
  const screen = code('reader-screen.tsx');

  it('hands the reading this Document settings, and asks the Keychain about its Provider', () => {
    pin(screen, 'settings={forDocument}', 'reader-screen.tsx');
    pin(screen, 'const key = useProviderKey(forDocument.provider);', 'reader-screen.tsx');
    expect(screen).not.toContain('settings={settings}');
  });

  it('writes the Voice down when it is chosen, and inherits the default only at the first open', () => {
    // The two writes are different: one is the owner choosing, the other is the
    // inheritance design 0010 promises — "and from then on the document keeps it",
    // which is only true if it is written.
    pin(screen, 'if (openedId) library.voiced(openedId, { provider, voice });', 'reader-screen.tsx, setVoice');
    pin(screen, 'if (recent) library.voiced(openedId, recent);', 'reader-screen.tsx');
    pin(screen, 'if (!openedId || voiceId) return;', 'reader-screen.tsx, the inheritance');
  });
});


describe('routine status is quiet, but lost positions still need attention (design 0026)', () => {
  it('marks an abandoned resume as needing attention', () => {
    const abandon = within(code('use-reading.ts'), 'const abandonResume = useCallback(', '}, []);');
    pin(abandon, 'resumeNeedsAttention: true,', 'use-reading.ts, abandonResume');
  });
  it('shows problems even when the player was collapsed', () => {
    pin(code('player.tsx'), 'if (collapsed && notes.length === 0)', 'player.tsx');
  });
});
