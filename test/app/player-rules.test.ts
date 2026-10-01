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
 * at the top of a two-thousand-chapter book, or the old sentence plays on after
 * the owner has pointed the reading somewhere else.
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
 * Load-bearing rather than tidy: the skip debounce this file once guarded had
 * two lines that each **appeared twice** in `use-reading.ts` — once
 * in the debounce and once in the cleanup that ran when the screen went away — so
 * a rule asserted over the whole file passed while the debounce was gutted. Three
 * mutations got through this file before it was scoped.
 */
function within(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  if (start < 0) throw new Error('no ' + from);
  const end = source.indexOf(to, start);
  if (end < 0) throw new Error('no ' + to + ' after ' + from);
  return source.slice(start, end + to.length);
}

describe('a tap, a skip or a Contents row stops the sound at the press (#86)', () => {
  /**
   * The 600 ms debounce ADR 0020 copied from Zotero deferred `engine.seek`, and
   * `engine.seek` is the first thing that stops the source node, so the old
   * sentence played on through the wait and its next cue could move the highlight
   * back to it. Zotero stops the sound before its own wait
   * (notes/NOTES_2026-09-29.md, 19:04); the owner chose no wait at all.
   */
  it('seeks from the press itself, with no timer in between', () => {
    const reading = code('use-reading.ts');
    const seekTo = within(reading, 'const seekTo = useCallback(', '}, [sectionOf');
    // Three calls into the engine's seek in the whole file: this one, and the two
    // that end a Contents row's silenced wait at the sentence the reading is on.
    expect(reading.match(/\.seek\(/g)).toHaveLength(3);
    pin(seekTo, 'engineRef.current?.seek(at);', 'use-reading.ts seekTo');
    expect(seekTo).not.toContain('setTimeout(');
    expect(reading).not.toContain('SKIP_DEBOUNCE');
  });

  it('counts a skip from the sentence the previous press already sought to', () => {
    const skip = within(code('use-reading.ts'), 'const skip = useCallback(', '[pointAt]');
    pin(skip, 'const from = atRef.current ?? 0;', 'use-reading.ts skip');
  });

  it('stops the sound while a Contents row waits for its chapter, and only a seek ends the wait', () => {
    const reading = code('use-reading.ts');
    const goToSection = within(reading, 'const goToSection = useCallback(', '[followRow]');
    pin(goToSection, 'followRow(section, playIntent.current);', 'use-reading.ts goToSection');
    pin(goToSection, 'if (waited?.onward) engineRef.current?.seek(atRef.current);', 'use-reading.ts goToSection');
    const followRow = within(reading, 'const followRow = useCallback(', '}, [seekTo]);');
    pin(followRow, 'if (onward) engineRef.current?.silence();', 'use-reading.ts followRow');
    pin(followRow, 'if (atRef.current !== null) engine?.seek(atRef.current);', 'use-reading.ts followRow');
    const engine = readFileSync(new URL('../../src/playback/engine.ts', import.meta.url).pathname, 'utf8');
    const pump = within(engine, '  function pump(): void {', '\n  }\n');
    // Nothing is fetched or queued while waiting: the front of the empty queue is
    // the sentence the owner has just left.
    expect(pump.indexOf('if (waiting)')).toBeGreaterThan(-1);
    expect(pump.indexOf('if (waiting)')).toBeLessThan(pump.indexOf('fetchWindow('));
    const seek = within(engine, '    seek(utterance) {', '\n    },\n');
    pin(seek, 'waiting = false;', 'engine.ts seek');
    // Beside its declaration, the one place it is cleared.
    expect(engine.match(/^\s+waiting = false;/gm)).toHaveLength(1);
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
    expect(attempt).toContain('resolveResume(stored, next, reported, rendered)');
    // What has rendered goes with it, so a place waits for its own section rather
    // than being found in whatever reported first — a contents page (#51).
    expect(attempt).toContain('reported: reportedSectionsRef.current');
    const blocks = within(reading, 'const handleBlocks = useCallback(', '[adopt, walkForward, tryResume, seekTo, followRow, revealPendingPlace, stopWaitingIfArrived],');
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

  it('waits for a place still on its way when Play is pressed, rather than giving it up (#54)', () => {
    // Giving it up started the engine at this device's older sentence and wrote
    // that over the newer place on every device. The wait is asked first, before
    // the claim is ended and before the cover-page walk moves the page elsewhere.
    const play = within(code('use-reading.ts'), 'const play = useCallback(', '}, [settings, build, report, walkForward');
    const waits = play.indexOf('awaitedSection(');
    expect(waits).toBeGreaterThan(-1);
    expect(waits).toBeLessThan(play.indexOf('abandonResume();'));
    expect(waits).toBeLessThan(play.indexOf('walkForward('));
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
    // cued with. Where the page is, without revealing it: the reading has not
    // moved, and a Voice chosen while paused may be chosen while browsing (#52).
    const cleanup = within(reading, 'const disposeEngine = useCallback(', '}, []);');
    pin(cleanup, 'if (at === null) bridgeRef.current?.clear();', 'use-reading.ts, the identity cleanup');
    pin(cleanup, 'else bridgeRef.current?.show(at, { reveal: false });', 'use-reading.ts, the identity cleanup');
  });

  it('marks the furthest section reported, not the last one to report', () => {
    // Sections render out of order, so the last to report is routinely behind the
    // furthest — and a document's last spine items are where the sections that
    // render with no text in them live.
    const blocks = within(reading, 'const handleBlocks = useCallback(', '[adopt, walkForward, tryResume, seekTo, followRow, revealPendingPlace, stopWaitingIfArrived],');
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
    pin(view, 'if (status.resumeNeedsAttention && status.resume) say(status.resume, true);', 'reading-view.tsx');
    pin(view, 'if (status.note) say(status.note, true);', 'reading-view.tsx');
    pin(view, 'said.push({ said: words, attention });', 'reading-view.tsx');
    pin(player, 'style={[styles.note, note.attention && styles.noteAttention]}', 'player.tsx');
    pin(player, 'noteAttention: { color: INK.attention },', 'player.tsx');
  });

  it('says each sentence once, whichever of its sources says it (#72)', () => {
    // The readiness sentence and a refused Play's `status.note` are the same words,
    // and the player keys each note by its text.
    pin(view, '!said.some((note) => note.said === words)', 'reading-view.tsx');
    pin(player, 'key={note.said}', 'player.tsx');
  });

  it('names no Provider on the Voice button while no Voice is chosen (#103)', () => {
    pin(player, "if (!settings.voice) return 'Choose a Voice';", 'player.tsx');
  });

  it('leaves the no-provider sentence to the Voice sheet while it is open (#103)', () => {
    // Measured on the simulator: the sheet is one line tall then, and the player's
    // sentence stood just above its `Enable a provider in Settings to choose a voice.`
    pin(view, 'const hidden = voicesOpen ? NO_PROVIDER_SENTENCE : null;', 'reading-view.tsx');
    pin(view, 'if (words !== hidden && !said.some((note) => note.said === words))', 'reading-view.tsx');
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
   * be tested there is the wiring: that the shell's Reading (the Reader screen's
   * until #68) hands the reading the Document's
   * settings rather than the app's, asks the Keychain about *that* Provider, and
   * writes the choice down. Each is one line, and each fails by reading the book
   * perfectly in the wrong Voice.
   */
  const screen = code('reading-host.tsx');

  it('hands the reading this Document settings, and asks the Keychain about its Provider', () => {
    pin(screen, 'settings={forDocument}', 'reading-host.tsx');
    pin(screen, 'const key = useProviderKey(forDocument.provider);', 'reading-host.tsx');
    expect(screen).not.toContain('settings={settings}');
  });

  it('writes the Voice down when it is chosen, and inherits the default only at the first open', () => {
    // The two writes are different: one is the owner choosing, the other is the
    // inheritance design 0010 promises — "and from then on the document keeps it",
    // which is only true if it is written.
    pin(screen, 'if (openedId) library.voiced(openedId, { provider, voice });', 'reading-host.tsx, setVoice');
    pin(screen, 'if (recent) library.voiced(openedId, recent);', 'reading-host.tsx');
    pin(screen, 'if (!openedId || voiceId) return;', 'reading-host.tsx, the inheritance');
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

describe('the navigation bar comes and goes with the player, and floats (#67, ADR 0048)', () => {
  it('is shown exactly when the player is shown in full, notes included', () => {
    // One state for what is on the screen: a note opens the player, and a bar
    // left hidden over an open player would be a second state nothing asked for.
    const view = code('reading-view.tsx');
    pin(view, 'const chrome = !(collapsed && notes.length === 0);', 'reading-view.tsx');
    // The screen takes it from the Reading it shows (#68).
    pin(code('reader-screen.tsx'), 'const chrome = mine?.chrome ?? true;', 'reader-screen.tsx');
    pin(view, 'useEffect(() => { onChrome(chrome); }, [chrome, onChrome]);', 'reading-view.tsx');
    // What the bar covers goes to the centring only while it is shown; the room
    // the page keeps for it stays, so the text does not move.
    pin(view, 'setBar(chrome ? barHeight : 0, barHeight);', 'reading-view.tsx');
  });

  it('floats over the page, so hiding it does not resize the WebView', () => {
    // An opaque bar gives its height back to the page when it hides, the WebView
    // resizes, and epub.js destroys every view on a resize (the blank open).
    const screen = code('reader-screen.tsx');
    pin(screen, 'navigation.setOptions({ headerTransparent: true, headerShown: chrome });', 'reader-screen.tsx');
    pin(screen, '{ paddingTop: insets.top }', 'reader-screen.tsx');
  });

  it('remembers the bar’s height while it is hidden', () => {
    // The header height is zero while the bar is hidden; the room kept for it
    // must not follow, or every hide and show would move the text by that much.
    // Since #68 the Reading holds it, so it also outlives the Reader screen.
    pin(code('reader-screen.tsx'), 'if (shownBar > 0) setBarHeight(shownBar);', 'reader-screen.tsx');
  });

  it('leaves a Reading Button that shows the player and never plays or pauses', () => {
    const button = code('reading-button.tsx');
    expect(button).not.toMatch(/onPlay|onPause|toggle/);
    pin(button, 'onPress={onPress}', 'reading-button.tsx');
    pin(code('player.tsx'), 'onPress={() => onCollapsed(false)}', 'player.tsx');
  });
});

describe('the Document’s name in the bar takes two lines before it is cut (#85, ADR 0057)', () => {
  it('is the app’s own title in the reader, and still the screen’s title for the back menu', () => {
    const screen = code('reader-screen.tsx');
    pin(screen, 'headerTitle: () => <ReaderTitle title={title} />,', 'reader-screen.tsx');
    // The back button's long-press menu names the screen by `title`.
    pin(screen, '      title,\n', 'reader-screen.tsx');
  });

  it('wraps onto a second line, then ends that line in an ellipsis after a whole word (design 0060)', () => {
    const title = code('reader-title.tsx');
    pin(title, '<NameText name={title} lines={2} width={room}', 'reader-title.tsx');
    const name = code('name-text.tsx');
    pin(name, 'numberOfLines={lines}', 'name-text.tsx');
    pin(name, 'wordCuts(event.nativeEvent.lines.map((line) => line.text), lines)', 'name-text.tsx');
    // VoiceOver reads the whole name, not the cut one.
    pin(name, '<Text accessibilityLabel={name}', 'name-text.tsx');
  });

  it('is the phone’s own bar title: Headline, centred, and as large as the other bars’ titles', () => {
    // The phone grows its bar titles with the text size from 17 to 21 (#100);
    // at 21 two lines still fit the 54-point bar. The size comes from
    // `barTitle`, so React Native's own scaling, which has no such limit, is off.
    const title = code('reader-title.tsx');
    pin(title, "title: { color: INK.text, textAlign: 'center' }", 'reader-title.tsx');
    pin(title, 'style={[styles.title, barTitle(fontScale), { maxWidth: room }]}', 'reader-title.tsx');
    pin(title, 'allowFontScaling={false}', 'reader-title.tsx');
  });

  it('is as wide as the window less the measured room for a button on each side', () => {
    // Measured on the iPhone 18 Pro simulator, iOS 27.0: More actions' glass
    // starts at 333 of 402 points and the phone leaves about 12 before it.
    const title = code('reader-title.tsx');
    pin(title, 'export const TITLE_SIDE = 81;', 'reader-title.tsx');
    pin(title, 'const room = Math.max(0, width - 2 * TITLE_SIDE);', 'reader-title.tsx');
    pin(title, 'maxWidth: room', 'reader-title.tsx');
  });
});

describe('Play is in the middle of the player (#115)', () => {
  /**
   * The row spreads its buttons with equal gaps, so Play is in its middle only
   * while as many buttons stand on each side of it and the two ends are as wide
   * as each other. Contents at 44 against the speed's 58 put Play 7 points left
   * of the player's centre, under a Voice name that is centred (#70).
   */
  it('stands between two ends of one width, in a row that spreads its buttons evenly', () => {
    const player = code('player.tsx');
    pin(player, "transport: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }", 'player.tsx');
    pin(player, 'footTap: { width: TRANSPORT_END,', 'player.tsx');
    pin(player, 'rateHost: { height: 44, width: TRANSPORT_END }', 'player.tsx');

    const row = within(player, '<View style={styles.transport}>', '<SpeedBubble');
    const [before, after] = row.split(' primary ');
    expect(after).toBeDefined();
    expect(before).toContain('styles.footTap');
    expect(before.split('<Transport ').length).toBe(after.split('<Transport ').length + 1);
  });
});
