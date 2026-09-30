import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { createLocator, readingPlaceAt, type ReadingPlace } from '../../src/core/document';
import type { ReportedBlock } from '../../src/renderer/messages';
import { segmentDocument } from '../../src/app/segment';
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';
import { useReading, type Reading } from '../../src/app/use-reading';
import { SynthesisError } from '../../src/core/providers/errors';

/**
 * A place taken from another device while a book is open, in a section the
 * renderer has not rendered (defect 3, 2026-09-21): the real hook, mounted with
 * a null component and a fake bridge that records what it is asked to display
 * and lets the test report sections as the WebView would.
 *
 * Measured on the simulator: a fixture handed over while nothing was open
 * adopted the desktop's place in section 3 and opened at chapter 1, where it
 * stayed for sixteen minutes with the place pending, because nothing asked for
 * that section the way `initialLocation` asks for the place a book opens with.
 *
 * The same harness carries the reading across a renumbering (#46), and for that
 * it also records the engine a press of Play builds: where it is loaded and
 * sought, and whether anything pauses it. And it keeps a Contents row that is
 * only browsing apart from one that moves the reading (#52), so it records what
 * the page was asked to browse to and whether each highlight was revealed.
 */

const bridge = vi.hoisted(() => ({
  goTo: vi.fn<(cfi: string) => void>(),
  goToSection: vi.fn<(index: number) => void>(),
  browse: vi.fn<(index: number) => void>(),
  show: vi.fn<(utterance: number, options?: { reveal?: boolean }) => void>(),
  onClip: vi.fn<(cue: { utterance: number }, options?: { reveal?: boolean; recover?: boolean }) => void>(),
  clear: vi.fn<() => void>(),
  returnToReading: vi.fn<(utterance: number | null) => void>(),
  options: null as null | { onBlocks?(blocks: readonly ReportedBlock[], section: { index: number; href: string; spine: number }): void },
}));

/**
 * The engines a press of Play builds, recording what the hook asks of them —
 * where each load starts and whether it was quiet. Its clock and its state
 * callback are the hook's own, so a test can play a Clip boundary through them
 * as the real engine would.
 */
const engines = vi.hoisted(() => {
  interface Deps {
    clock: { onClip(cue: { utterance: number; words: null; duration: number; rate: number }): void };
    onState?(state: { playing: boolean; buffering: boolean }): void;
    onError(error: unknown): void;
  }
  interface Load { length: number; from: number; quiet: boolean }
  /** `calls` is every load, extend, seek, play and pause in the order they came, for a test about which came first. */
  const built: { deps: Deps; loads: Load[]; seeks: number[]; pauses: number; calls: string[] }[] = [];
  function create(deps: Deps) {
    const engine = { deps, loads: [] as Load[], seeks: [] as number[], pauses: 0, calls: [] as string[] };
    built.push(engine);
    return {
      load(list: readonly unknown[], from = 0, options: { quiet?: boolean } = {}) {
        engine.loads.push({ length: list.length, from, quiet: options.quiet === true });
        engine.calls.push(`load:${from}`);
      },
      extend() { engine.calls.push('extend'); },
      play() { engine.calls.push('play'); },
      pause() { engine.pauses++; engine.calls.push('pause'); },
      seek(utterance: number) { engine.seeks.push(utterance); engine.calls.push(`seek:${utterance}`); },
      setRate() {},
      switchVoice() {},
      cancelVoiceSwitch() {},
      snapshot: () => ({ playing: false, utterance: 0, rate: 1, queued: 0, fetching: 0 }),
      dispose: async () => {},
    };
  }
  return { built, create };
});

vi.mock('react-native', () => ({ useColorScheme: () => 'light' }));
vi.mock('../../src/renderer', async () => {
  const cursor = await vi.importActual<typeof import('../../src/renderer/cursor')>('../../src/renderer/cursor');
  return {
    ...cursor,
    useReaderBridge: (options: typeof bridge.options) => {
      bridge.options = options;
      return {
        goTo: bridge.goTo,
        goToSection: bridge.goToSection,
        browse: bridge.browse,
        show: bridge.show,
        clock: { onClip: bridge.onClip, onPosition() {} },
        setUtterances() {},
        setInset() {},
        setOpenPlayer() {},
        setLinePosition() {},
        setScrolling() {},
        setBar() {},
        setAppearance() {},
        setTheme() {},
        resumeFollowing() {},
        hold() {},
        clear: bridge.clear,
        returnToReading: bridge.returnToReading,
        setFollowOnly() {},
        readerProps: {},
      };
    },
  };
});
vi.mock('../../src/playback', async () => ({
  ...(await vi.importActual<typeof import('../../src/playback/navigation')>('../../src/playback/navigation')),
  createPlaybackEngine: engines.create,
}));
vi.mock('../../src/offline/runtime', () => ({
  hasSavedVoice: () => false,
  inventoryReady: () => true,
  offlineProvider: () => ({ capabilities: { wordTimestamps: false } }),
}));
vi.mock('../../src/now-playing', () => ({ lockScreenPosition: () => {} }));
vi.mock('../../src/app/body-text-sizes', () => ({ readBodyTextSize: () => null, writeBodyTextSize: () => {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const DOCUMENT = 'sha256:' + 'f'.repeat(64);
const SPINE = 3;

/** A section's Blocks as the renderer reports them, cumulative over the sections rendered so far. */
function blocks(section: number, texts: readonly string[]): ReportedBlock[] {
  return texts.map((text, at) => ({
    id: `${section}.${at}`,
    text,
    role: 'paragraph' as const,
    section: `s${section}.xhtml`,
    sectionIndex: section,
    cfi: `epubcfi(/6/${2 * (section + 1)}[s${section}]!/4/${2 * (at + 1)})`,
  }));
}

const CHAPTER_ONE = blocks(0, ['Chapter one begins here.', 'Nothing much happens in it.']);
const CHAPTER_THREE = blocks(2, ['Chapter three, at last.', 'The sentence the desktop stopped on. And one more.']);

/** The desktop's place: the second Block of section 3, first sentence, in the file's assertion-free spelling. */
const desktopPlace: ReadingPlace = readingPlaceAt(createLocator('epub', 'epubcfi(/6/6!/4/4)'), CHAPTER_THREE[1].text, 0, 'The sentence the desktop stopped on.'.length);

function mount(options: { settings?: AppSettings; resume?: ReadingPlace | null; spine?: number } = {}) {
  const { resume = null, spine = SPINE } = options;
  let settings = options.settings ?? DEFAULT_SETTINGS;
  bridge.goTo.mockClear();
  bridge.goToSection.mockClear();
  bridge.browse.mockClear();
  bridge.show.mockClear();
  bridge.onClip.mockClear();
  bridge.clear.mockClear();
  engines.built.length = 0;
  let reading: Reading | undefined;
  function Probe() {
    reading = useReading(settings, { hasKey: false, writtenAt: 0 }, resume, DOCUMENT);
    return null;
  }
  let tree: ReactTestRenderer;
  return {
    async up() { await act(async () => { tree = create(createElement(Probe)); }); },
    async down() { await act(async () => { tree.unmount(); }); },
    /** The owner's settings change under the open book, as choosing a Voice while paused changes them. */
    async settings(next: AppSettings) {
      settings = next;
      await act(async () => { tree.update(createElement(Probe)); });
    },
    async report(reported: readonly ReportedBlock[], section: number) {
      await act(async () => { bridge.options!.onBlocks!(reported, { index: section, href: `s${section}.xhtml`, spine }); });
    },
    /** Something the owner does, with everything it sets off — building an engine included — settled before the next line. */
    async press(action: (reading: Reading) => void) {
      await act(async () => {
        action(reading!);
        await new Promise((resolve) => setImmediate(resolve));
      });
    },
    /** Whatever the last report set off — an engine a waiting Play builds — settled before the next line. */
    async settle() {
      await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
    },
    get reading() { return reading!; },
  };
}

describe('an adopted place in a section not yet reported (defect 3)', () => {
  it('asks the renderer for that section once, and lands the moment the section reports', async () => {
    const m = mount();
    await m.up();
    await m.report(CHAPTER_ONE, 0);
    expect(m.reading.status.known).toBe(2);
    expect(m.reading.status.utterance).toBeNull();

    let taken = false;
    await act(async () => { taken = m.reading.resumeAt(desktopPlace); });
    expect(taken).toBe(true);
    // Not landed — the section is not among the Blocks — so its section is asked for, by the whole CFI.
    expect(m.reading.status.utterance).toBeNull();
    expect(bridge.goTo).toHaveBeenCalledTimes(1);
    expect(bridge.goTo).toHaveBeenCalledWith('epubcfi(/6/6!/4/4)');

    // The renderer displays it and reports; the pending place lands on the desktop's sentence.
    await m.report([...CHAPTER_ONE, ...CHAPTER_THREE], 2);
    expect(m.reading.status.utterance).toBe(3);
    expect(m.reading.status.section).toBe(2);
    // Landed exactly, so the sentence about it needs no attention (design 0026).
    expect(m.reading.status.resumeNeedsAttention).toBe(false);
    expect(bridge.goTo).toHaveBeenCalledTimes(1);
    await m.down();
  });

  it('asks again on a report of another section while the place is still pending, never for one that reported', async () => {
    const m = mount();
    await m.up();
    // Adopted before anything rendered: pending, and asked for at once.
    await act(async () => { m.reading.resumeAt(desktopPlace); });
    expect(bridge.goTo).toHaveBeenCalledTimes(1);
    // Chapter one renders first (a cover, a first chapter) and cannot hold the place: asked once more.
    await m.report(CHAPTER_ONE, 0);
    expect(bridge.goTo).toHaveBeenCalledTimes(2);
    expect(m.reading.status.utterance).toBeNull();
    // Section three reports without the sentence: it has reported, so a display cannot help, and nothing is asked.
    const changed = blocks(2, ['Chapter three, rewritten.', 'None of the old words remain here.']);
    await m.report([...CHAPTER_ONE, ...changed], 2);
    expect(bridge.goTo).toHaveBeenCalledTimes(2);
    expect(m.reading.status.utterance).toBeNull();
    await m.down();
  });

  it('is dropped, and asks for nothing more, once the owner points somewhere else (ADR 0019)', async () => {
    const m = mount();
    await m.up();
    await m.report(CHAPTER_ONE, 0);
    await act(async () => { m.reading.resumeAt(desktopPlace); });
    expect(bridge.goTo).toHaveBeenCalledTimes(1);
    await act(async () => { m.reading.seekTo(1); });
    expect(m.reading.status.utterance).toBe(1);
    // The section arrives late: the claim is gone, and the reading stays where the owner put it.
    await m.report([...CHAPTER_ONE, ...CHAPTER_THREE], 2);
    expect(m.reading.status.utterance).toBe(1);
    expect(bridge.goTo).toHaveBeenCalledTimes(1);
    await m.down();
  });

  it('lands at once, asking for nothing, when the section has already reported', async () => {
    const m = mount();
    await m.up();
    await m.report([...CHAPTER_ONE, ...CHAPTER_THREE], 2);
    await act(async () => { m.reading.resumeAt(desktopPlace); });
    expect(m.reading.status.utterance).toBe(3);
    expect(bridge.goTo).not.toHaveBeenCalled();
    // And the place it landed on is not a place to write again (observation b).
    expect(m.reading.readingPosition()).toBeNull();
    await m.down();
  });
});

/**
 * Coming back to a book left on a chapter heading (#51). The first sections to
 * report are the start of the book, because the highlighter installs before
 * epub.js runs the display `initialLocation` asked for; a web novel's contents
 * page is among them and lists the heading word for word. Measured on the owner's
 * book on 2026-09-23: the reading resumed on the contents line, the page went
 * there, and Play would have read the list of chapter titles.
 */
describe('a place on a chapter heading, with a contents page that lists it (#51)', () => {
  const CONTENTS = blocks(1, ['Contents', 'Chapter Three: The Forge', 'Chapter Four: The Letter', 'Chapter Five: The River']);
  const CHAPTER_FOUR = blocks(4, ['Chapter Four: The Letter', 'A letter arrived without a seal. Its ink was still wet.']);
  /** The heading, as `use-reading.ts` writes it: its Block's CFI without the assertion, and all of its text. */
  const heading = readingPlaceAt(createLocator('epub', 'epubcfi(/6/10!/4/2)'), CHAPTER_FOUR[0].text, 0, CHAPTER_FOUR[0].text.length);
  const READY: AppSettings = { ...DEFAULT_SETTINGS, provider: 'local', enabledProviders: ['local'], voice: 'af_bella' };

  it('waits through the contents page, and lands on the heading when its chapter reports', async () => {
    const m = mount({ resume: heading, spine: 8 });
    await m.up();
    await m.report(CONTENTS, 1);
    // The words are on this page, and are not the place: nothing lands, nothing is
    // shown, and nothing is said yet.
    expect(m.reading.status.utterance).toBeNull();
    expect(m.reading.status.resume).toBeNull();
    expect(bridge.show).not.toHaveBeenCalled();
    // The book's own opening already asked for the chapter, through `initialLocation`.
    expect(bridge.goTo).not.toHaveBeenCalled();

    const both = [...CONTENTS, ...CHAPTER_FOUR];
    await m.report(both, 4);
    const at = segmentDocument(both, 'en').findIndex((utterance) => utterance.text === 'Chapter Four: The Letter' && utterance.spans[0].block === CONTENTS.length);
    expect(at).toBe(4);
    expect(m.reading.status.utterance).toBe(at);
    expect(m.reading.status.section).toBe(4);
    expect(m.reading.status.resume).toBe('Resumed at the sentence the reading stopped on.');
    expect(m.reading.status.resumeNeedsAttention).toBe(false);
    expect(bridge.show).toHaveBeenLastCalledWith(at);
    expect(bridge.goTo).not.toHaveBeenCalled();
    await m.down();
  });

  it('waits for the chapter when Play comes first, and reads the heading once it reports (#54)', async () => {
    // Play used to give the place up here: the engine was loaded at the contents
    // page's first line, and the next place written was that page, on every device.
    const m = mount({ settings: READY, resume: heading, spine: 8 });
    await m.up();
    await m.report(CONTENTS, 1);
    await m.press((reading) => reading.play());
    // Starting, with nothing built and nothing given up.
    expect(m.reading.status.playing).toBe(true);
    expect(m.reading.status.buffering).toBe(true);
    expect(m.reading.status.resume).toBeNull();
    expect(engines.built).toHaveLength(0);

    const both = [...CONTENTS, ...CHAPTER_FOUR];
    await m.report(both, 4);
    await m.settle();
    expect(m.reading.status.utterance).toBe(4);
    expect(m.reading.status.resume).toBe('Resumed at the sentence the reading stopped on.');
    expect(engines.built[0].loads).toEqual([{ length: segmentDocument(both, 'en').length, from: 4, quiet: false }]);
    await m.down();
  });

  it('waits rather than walking past a cover when Play comes before anything has reported (#54)', async () => {
    const m = mount({ settings: READY, resume: heading, spine: 8 });
    await m.up();
    await m.press((reading) => reading.play());
    // The cover reports and holds nothing to read. The page is on its way to the
    // chapter, and a walk to the next section would take it somewhere else.
    await m.report([], 0);
    await m.report(CONTENTS, 1);
    expect(bridge.goToSection).not.toHaveBeenCalled();
    expect(engines.built).toHaveLength(0);

    const both = [...CONTENTS, ...CHAPTER_FOUR];
    await m.report(both, 4);
    await m.settle();
    expect(engines.built[0].loads).toEqual([{ length: segmentDocument(both, 'en').length, from: 4, quiet: false }]);
    await m.down();
  });
});

/**
 * A section reported above the ones already reported renumbers every later
 * Utterance (#46). Before this, the reading was dropped there: the cursor went to
 * null, a note said the reading had stopped, and the next Play loaded the engine
 * at 0 and read the book's first line — and the stored place was then overwritten
 * with it. The two orders below are the ones measured on the owner's book on
 * 2026-09-23 (notes/NOTES_2026-09-23.md, 13:35).
 */
describe('a section reported above the reading (#46)', () => {
  /** Eight spine items: a cover that holds no text, then seven chapters of a heading and a paragraph of two sentences. */
  const CHAPTERS = 8;
  /**
   * Every sentence different from every other, as a real book's are: the resume
   * resolves a place by its text, and near-twins would let it land by resemblance.
   */
  const TEXTS: Record<number, [string, string]> = {
    1: ['Cultivation Online.', 'Rain fell on the old harbour. Gulls argued over the nets.'],
    2: ['A note on this edition.', 'Every lantern in the valley was lit. Nobody could say why.'],
    3: ['Chapter Three.', 'The blacksmith counted his coins twice. Winter was coming early.'],
    4: ['Chapter Four.', 'A letter arrived without a seal. Its ink was still wet.'],
    5: ['Chapter Five.', 'The river had frozen overnight. Children skated where the boats had been.'],
    6: ['Chapter Six.', 'Yet with a single, effortless motion, Yuan swung his sword. The ogre staggered back.'],
    7: ['Chapter Seven.', 'Morning found the camp deserted. Only ashes remained.'],
  };
  const chapter = (section: number) => blocks(section, TEXTS[section]);
  /** The sentence the stored place names, and the last sentence of chapter 5. */
  const STORED = 'Yet with a single, effortless motion, Yuan swung his sword.';
  const LAST_OF_FIVE = 'Children skated where the boats had been.';
  /** What the renderer reports once these sections have rendered, in spine order whatever order they came in (`withSection`). */
  const reported = (...sections: number[]) => [...sections].sort((a, b) => a - b).flatMap(chapter);
  /** Where a sentence is once these sections have reported. */
  const indexIn = (sections: number[], text: string) => segmentDocument(reported(...sections), 'en').findIndex((utterance) => utterance.text === text);
  /** A Provider that is enabled and needs nothing, so Play builds an engine. */
  const READY: AppSettings = { ...DEFAULT_SETTINGS, provider: 'local', enabledProviders: ['local'], voice: 'af_bella' };
  const RENUMBERED = /renumbered/;

  it('keeps the chapter a Contents row chose while the sections above it report, and Play reads it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const m = mount({ settings: READY, spine: CHAPTERS });
      await m.up();
      await m.report(reported(1), 1);
      await m.report(reported(1, 2), 2);
      // Contents, to chapter 5: the page moves, and the reading follows once 5 reports.
      await m.press((reading) => reading.goToSection(5));
      await m.report(reported(1, 2, 5), 5);
      await m.report(reported(1, 2, 5, 6), 6);
      bridge.show.mockClear();
      // Then 3 and 4, above everything reported so far.
      await m.report(reported(1, 2, 3, 5, 6), 3);
      await m.report(reported(1, 2, 3, 4, 5, 6), 4);
      // Paused, so the page is left where it is: nothing is shown for the new numbers.
      expect(bridge.show).not.toHaveBeenCalled();

      const everything = [1, 2, 3, 4, 5, 6];
      const opening = indexIn(everything, 'Chapter Five.');
      expect(opening).toBe(12);
      expect(m.reading.status.utterance).toBe(opening);
      expect(m.reading.status.note ?? '').not.toMatch(RENUMBERED);

      // Play, inside the Contents tap's 600 ms: the engine is loaded at chapter 5 …
      await m.press((reading) => reading.play());
      expect(engines.built).toHaveLength(1);
      expect(engines.built[0].loads).toEqual([{ length: 18, from: opening, quiet: false }]);
      // … and the tap's own seek, which named the same sentence, is settled by
      // the press rather than sent 600 ms later to start that sentence again (#54).
      await act(async () => { vi.advanceTimersByTime(600); });
      expect(engines.built[0].seeks).toEqual([]);
      await m.down();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a resumed place while the sections above it report, writes nothing for it, and Play reads it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      // The stored place: the first sentence of section 6's second Block.
      const stored = readingPlaceAt(createLocator('epub', 'epubcfi(/6/14!/4/4)'), chapter(6)[1].text, 0, STORED.length);
      const m = mount({ settings: READY, spine: CHAPTERS, resume: stored });
      await m.up();
      await m.report(reported(1), 1);
      await m.report(reported(1, 2), 2);
      await m.report(reported(1, 2, 6), 6);
      expect(m.reading.status.resume).toBe('Resumed at the sentence the reading stopped on.');
      expect(m.reading.status.utterance).toBe(indexIn([1, 2, 6], STORED));
      bridge.show.mockClear();
      // The resume has landed; now 4, 5 and 7 report, the first two above it.
      await m.report(reported(1, 2, 4, 6), 4);
      await m.report(reported(1, 2, 4, 5, 6), 5);
      await m.report(reported(1, 2, 4, 5, 6, 7), 7);
      expect(bridge.show).not.toHaveBeenCalled();

      const place = indexIn([1, 2, 4, 5, 6, 7], STORED);
      expect(place).toBe(13);
      expect(m.reading.status.utterance).toBe(place);
      expect(m.reading.status.note ?? '').not.toMatch(RENUMBERED);
      expect(m.reading.status.resume).toBe('Resumed at the sentence the reading stopped on.');
      // Still the resumed sentence, so nothing is written over the stored place.
      expect(m.reading.readingPosition()).toBeNull();

      await m.press((reading) => reading.play());
      expect(engines.built[0].loads).toEqual([{ length: 18, from: place, quiet: false }]);
      // Loaded at the place, so the resume's own seek is settled by the press, not sent after it (#54).
      await act(async () => { vi.advanceTimersByTime(600); });
      expect(engines.built[0].seeks).toEqual([]);
      expect(m.reading.readingPosition()).toBeNull();
      await m.down();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads the chapter a Contents row chose when that chapter reports above the reading', async () => {
    // The row's own step points the cursor into the new list before adopting it,
    // so the cursor is not carried again from the old one.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const m = mount({ settings: READY, spine: CHAPTERS });
      await m.up();
      await m.report(reported(5, 6), 6);
      await m.press((reading) => reading.play());
      const engine = engines.built[0];
      await m.press((reading) => reading.pause());
      await m.press((reading) => reading.goToSection(3));
      await m.report(reported(3, 5, 6), 3);
      expect(engine.loads.at(-1)).toEqual({ length: 9, from: 0, quiet: true });
      expect(m.reading.status.utterance).toBe(0);
      expect(m.reading.status.note ?? '').not.toMatch(RENUMBERED);
      await act(async () => { vi.advanceTimersByTime(600); });
      expect(engine.seeks).toEqual([0]);
      await m.down();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reloads a playing reading at the sentence it is on, without pausing it', async () => {
    const m = mount({ settings: READY, spine: CHAPTERS });
    await m.up();
    await m.report(reported(5, 6), 6);
    await m.press((reading) => reading.play());
    const engine = engines.built[0];
    expect(engine.loads).toEqual([{ length: 6, from: 0, quiet: false }]);
    // The reading has moved on to the last sentence of chapter 5.
    await m.press(() => engine.deps.clock.onClip({ utterance: 2, words: null, duration: 1, rate: 1 }));
    bridge.show.mockClear();

    await m.report(reported(3, 5, 6), 3);
    const carried = indexIn([3, 5, 6], LAST_OF_FIVE);
    expect(carried).toBe(5);
    // Playing: not quiet, because the Clip the reload starts is the reading's own
    // cue, and the page follows the voice as it always does.
    expect(engine.loads.at(-1)).toEqual({ length: 9, from: carried, quiet: false });
    expect(engine.pauses).toBe(0);
    expect(bridge.show).not.toHaveBeenCalled();
    expect(m.reading.status.utterance).toBe(carried);
    expect(m.reading.status.playing).toBe(true);
    expect(m.reading.status.note ?? '').not.toMatch(RENUMBERED);
    await m.down();
  });

  it('lets go of a Voice being switched to, which the reload cancels, rather than leave it pending', async () => {
    const m = mount({ settings: READY, spine: CHAPTERS });
    await m.up();
    await m.report(reported(5, 6), 6);
    await m.press((reading) => reading.play());
    const engine = engines.built[0];
    await m.press(() => engine.deps.clock.onClip({ utterance: 2, words: null, duration: 1, rate: 1 }));
    await m.press((reading) => reading.chooseVoice('local', 'bf_emma', () => {}));
    expect(m.reading.status.pendingVoice).toEqual({ provider: 'local', voice: 'bf_emma' });

    await m.report(reported(3, 5, 6), 3);
    expect(engine.loads.at(-1)).toEqual({ length: 9, from: indexIn([3, 5, 6], LAST_OF_FIVE), quiet: false });
    expect(m.reading.status.pendingVoice).toBeNull();
    // And the same Voice can be chosen again: nothing is left claiming it is on its way.
    await m.press((reading) => reading.chooseVoice('local', 'bf_emma', () => {}));
    expect(m.reading.status.pendingVoice).toEqual({ provider: 'local', voice: 'bf_emma' });
    await m.down();
  });

  it('while paused, reloads quietly and shows nothing, so the page stays where the owner put it', async () => {
    // A renumbering while paused is what scrolling up does: epub.js renders a
    // section above that has not reported. A `show`, or the first cue of an
    // engine reloaded while paused, would pull the page back to the reading.
    const m = mount({ settings: READY, spine: CHAPTERS });
    await m.up();
    await m.report(reported(5, 6), 6);
    await m.press((reading) => reading.play());
    const engine = engines.built[0];
    await m.press(() => engine.deps.clock.onClip({ utterance: 2, words: null, duration: 1, rate: 1 }));
    await m.press((reading) => reading.pause());
    const paused = engine.pauses;
    bridge.show.mockClear();

    await m.report(reported(4, 5, 6), 4);
    const carried = indexIn([4, 5, 6], LAST_OF_FIVE);
    expect(engine.loads.at(-1)).toEqual({ length: 9, from: carried, quiet: true });
    expect(engine.pauses).toBe(paused);
    expect(bridge.show).not.toHaveBeenCalled();
    expect(m.reading.status.utterance).toBe(carried);
    expect(m.reading.status.note ?? '').not.toMatch(RENUMBERED);
    await m.down();
  });

  it('reloads at the top, and says nothing, where nothing has pointed the reading anywhere', async () => {
    const m = mount({ settings: READY, spine: CHAPTERS });
    await m.up();
    await m.report(reported(5, 6), 6);
    await m.press((reading) => reading.play());
    const engine = engines.built[0];
    // No Clip has started yet, so there is no cursor to carry.
    await m.report(reported(3, 5, 6), 3);
    expect(engine.loads.at(-1)).toEqual({ length: 9, from: 0, quiet: false });
    expect(engine.pauses).toBe(0);
    expect(m.reading.status.utterance).toBeNull();
    expect(m.reading.status.note ?? '').not.toMatch(RENUMBERED);
    await m.down();
  });

  it('still stops and says so when the sentence itself has gone, because its own section changed', async () => {
    const m = mount({ settings: READY, spine: CHAPTERS });
    await m.up();
    await m.report(reported(5, 6), 6);
    await m.press((reading) => reading.play());
    const engine = engines.built[0];
    await m.press(() => engine.deps.clock.onClip({ utterance: 2, words: null, duration: 1, rate: 1 }));

    // Section 5 reports again with other words in it: the sentence is nowhere.
    const rewritten = [...blocks(5, ['Chapter Five.', 'Other words entirely. Nothing like before.']), ...chapter(6)];
    await m.report(rewritten, 5);
    expect(engine.pauses).toBe(1);
    expect(bridge.clear).toHaveBeenCalled();
    // Quiet, like any reload of a stopped reading: a cue of the top of the document
    // would move the page there under a note saying the reading stopped here.
    expect(engine.loads.at(-1)).toEqual({ length: 6, from: 0, quiet: true });
    expect(m.reading.status.utterance).toBeNull();
    expect(m.reading.status.note ?? '').toMatch(RENUMBERED);
    await m.down();
  });
});

/**
 * A Contents row while paused is Browsing (#52, CONTEXT.md): the page goes to the
 * chapter, and the reading, its highlight and the stored place stay on the
 * sentence the reading is on. Measured on the owner's book on 2026-09-23 at 23:19,
 * before this: a book reopened on Utterance 176 in section 10, paused, and a
 * Contents row to section 14 moved the reading to 423, that chapter's heading,
 * highlighted it and wrote it over the stored place.
 *
 * Two cases keep the old two steps, because there is no sentence to keep: while
 * playing, where the page follows the voice and could not stay on a chapter the
 * voice is not in; and in a book with no Reading Position yet, where the row
 * chooses where the first Play starts.
 */
describe('a Contents row only moves the page, paused (#52) or playing (#107)', () => {
  const ONE = blocks(1, ['Chapter One.', 'The ferry left before dawn. Nobody waved.']);
  const TWO = blocks(2, ['Chapter Two.', 'Snow had covered the pass. The mules refused to climb.']);
  const THREE = blocks(3, ['Chapter Three.', 'The archive burned for a week. Its keeper wept.']);
  const ALL = [...ONE, ...TWO, ...THREE];
  /** Where a sentence is once all three chapters have reported. */
  const at = (text: string) => segmentDocument(ALL, 'en').findIndex((utterance) => utterance.text === text);
  const FERRY = 'The ferry left before dawn.';
  /** A Provider that is enabled and needs nothing, so Play builds an engine. */
  const READY: AppSettings = { ...DEFAULT_SETTINGS, provider: 'local', enabledProviders: ['local'], voice: 'af_bella' };
  const SPINE_OF_FIVE = 5;
  const cue = (utterance: number) => ({ utterance, words: null, duration: 1, rate: 1 });

  it('moves only the page when paused on a sentence the owner pointed at', async () => {
    const m = mount({ settings: READY, spine: SPINE_OF_FIVE });
    await m.up();
    await m.report([...ONE, ...TWO], 2);
    // A tapped sentence: the owner has pointed the reading, so it is a place.
    await m.press((reading) => reading.seekTo(at(FERRY)));
    const place = m.reading.readingPosition();
    expect(place).not.toBeNull();
    bridge.show.mockClear();
    bridge.goToSection.mockClear();

    await m.press((reading) => reading.goToSection(3));
    expect(bridge.browse).toHaveBeenCalledWith(3);
    expect(bridge.goToSection).not.toHaveBeenCalled();
    expect(bridge.show).not.toHaveBeenCalled();
    expect(m.reading.status.utterance).toBe(at(FERRY));
    expect(m.reading.status.section).toBe(1);

    // The chapter arriving is the page arriving, not the reading.
    await m.report(ALL, 3);
    expect(bridge.show).not.toHaveBeenCalled();
    expect(m.reading.status.utterance).toBe(at(FERRY));
    expect(m.reading.readingPosition()).toEqual(place);

    // And Play reads from where the reading was paused.
    await m.press((reading) => reading.play());
    expect(engines.built[0].loads).toEqual([{ length: 9, from: at(FERRY), quiet: false }]);
    await m.down();
  });

  it('seeks no engine, so nothing is synthesized for a chapter the owner only looked at', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const m = mount({ settings: READY, spine: SPINE_OF_FIVE });
      await m.up();
      await m.report(ALL, 3);
      await m.press((reading) => reading.play());
      const engine = engines.built[0];
      await m.press(() => engine.deps.clock.onClip(cue(at(FERRY))));
      await m.press((reading) => reading.pause());

      await m.press((reading) => reading.goToSection(3));
      await act(async () => { vi.advanceTimersByTime(600); });
      expect(bridge.browse).toHaveBeenCalledWith(3);
      expect(engine.seeks).toEqual([]);
      expect(m.reading.status.utterance).toBe(at(FERRY));
      await m.down();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a resumed place, and writes nothing over it', async () => {
    const stored = readingPlaceAt(createLocator('epub', 'epubcfi(/6/4!/4/4)'), ONE[1].text, 0, FERRY.length);
    const m = mount({ settings: READY, resume: stored, spine: SPINE_OF_FIVE });
    await m.up();
    // The place waits for its own section, spine item 1, to report (#51).
    await m.report(ONE, 1);
    await m.report([...ONE, ...TWO], 2);
    expect(m.reading.status.resume).toBe('Resumed at the sentence the reading stopped on.');
    expect(m.reading.status.utterance).toBe(at(FERRY));
    bridge.show.mockClear();

    await m.press((reading) => reading.goToSection(3));
    await m.report(ALL, 3);
    expect(bridge.browse).toHaveBeenCalledWith(3);
    expect(bridge.show).not.toHaveBeenCalled();
    expect(m.reading.status.utterance).toBe(at(FERRY));
    expect(m.reading.status.resume).toBe('Resumed at the sentence the reading stopped on.');
    // Still the resumed sentence: the stored place already is it.
    expect(m.reading.readingPosition()).toBeNull();
    await m.down();
  });

  it('moves only the page while playing too: the voice goes on, and its next sentence leaves the page on the chapter (#107)', async () => {
    const m = mount({ settings: READY, spine: SPINE_OF_FIVE });
    await m.up();
    await m.report(ALL, 3);
    await m.press((reading) => reading.play());
    const engine = engines.built[0];
    await m.press(() => engine.deps.clock.onClip(cue(at(FERRY))));
    bridge.show.mockClear();
    bridge.goToSection.mockClear();
    const calls = engine.calls.length;

    await m.press((reading) => reading.goToSection(3));
    expect(bridge.browse).toHaveBeenCalledWith(3);
    expect(bridge.goToSection).not.toHaveBeenCalled();
    expect(bridge.show).not.toHaveBeenCalled();
    // Nothing reaches the engine: no seek, no silence, no pause.
    expect(engine.calls.slice(calls)).toEqual([]);
    expect(m.reading.status.playing).toBe(true);
    expect(m.reading.status.utterance).toBe(at(FERRY));
    expect(m.reading.status.section).toBe(1);

    // The chapter arriving is the page arriving, not the reading.
    await m.report(ALL, 3);
    expect(bridge.show).not.toHaveBeenCalled();
    expect(m.reading.status.utterance).toBe(at(FERRY));

    // The voice moving on recovers, as after a finger drag: the page stays on the
    // chapter unless the sentence begins where the owner can see it (#71).
    await m.press(() => engine.deps.clock.onClip(cue(at(FERRY) + 1)));
    expect(bridge.onClip).toHaveBeenLastCalledWith(expect.objectContaining({ utterance: at(FERRY) + 1 }), { reveal: false, recover: true });
    expect(m.reading.status.utterance).toBe(at(FERRY) + 1);
    await m.down();
  });

  it('is not undone by the first cue after Play when the row comes before that cue (#107)', async () => {
    const m = mount({ settings: READY, spine: SPINE_OF_FIVE });
    await m.up();
    await m.report(ALL, 3);
    await m.press((reading) => reading.seekTo(at(FERRY)));
    await m.press((reading) => reading.play());
    const engine = engines.built[0];

    // Pressed while the first Clip is still being fetched.
    await m.press((reading) => reading.goToSection(3));
    expect(bridge.browse).toHaveBeenCalledWith(3);
    await m.press(() => engine.deps.clock.onClip(cue(at(FERRY))));
    expect(bridge.onClip).toHaveBeenLastCalledWith(expect.objectContaining({ utterance: at(FERRY) }), { reveal: false, recover: true });

    // Play after a pause still asks for the reading.
    await m.press((reading) => reading.pause());
    await m.press((reading) => reading.play());
    await m.press(() => engine.deps.clock.onClip(cue(at(FERRY))));
    expect(bridge.onClip).toHaveBeenLastCalledWith(expect.objectContaining({ utterance: at(FERRY) }), { reveal: true });
    await m.down();
  });

  it('while playing with no sentence yet, still takes the reading to the chapter (#86)', async () => {
    // Play in a book with no place, before its first Clip: there is no sentence
    // being read to keep, so the row chooses where the reading starts.
    const m = mount({ settings: READY, spine: SPINE_OF_FIVE });
    await m.up();
    await m.report(ALL, 3);
    await m.press((reading) => reading.play());
    expect(m.reading.status.utterance).toBeNull();

    await m.press((reading) => reading.goToSection(2));
    expect(bridge.browse).not.toHaveBeenCalled();
    expect(bridge.goToSection).toHaveBeenCalledWith(2);
    expect(m.reading.status.utterance).toBe(at('Chapter Two.'));
    await m.down();
  });

  it('in a book with no place yet, still chooses where the first Play starts, the latest choice winning, and writes none', async () => {
    const m = mount({ settings: READY, spine: SPINE_OF_FIVE });
    await m.up();
    await m.report(ALL, 3);

    await m.press((reading) => reading.goToSection(3));
    expect(bridge.browse).not.toHaveBeenCalled();
    expect(m.reading.status.utterance).toBe(at('Chapter Three.'));
    expect(m.reading.readingPosition()).toBeNull();

    await m.press((reading) => reading.goToSection(2));
    expect(bridge.browse).not.toHaveBeenCalled();
    expect(m.reading.status.utterance).toBe(at('Chapter Two.'));
    expect(m.reading.readingPosition()).toBeNull();

    // Play reads from the latest choice, and from then on it is the book's place …
    await m.press((reading) => reading.play());
    expect(engines.built[0].loads).toEqual([{ length: 9, from: at('Chapter Two.'), quiet: false }]);
    expect(m.reading.readingPosition()).not.toBeNull();
    // … so a row after a pause only browses.
    await m.press((reading) => reading.pause());
    await m.press((reading) => reading.goToSection(1));
    expect(bridge.browse).toHaveBeenCalledWith(1);
    expect(m.reading.status.utterance).toBe(at('Chapter Two.'));
    await m.down();
  });

  it('in a book with no place yet, a skip points the reading like a tap does, and the next row browses', async () => {
    const m = mount({ settings: READY, spine: SPINE_OF_FIVE });
    await m.up();
    await m.report(ALL, 3);
    await m.press((reading) => reading.skip('next-sentence'));
    expect(m.reading.status.utterance).toBe(1);
    expect(m.reading.readingPosition()).not.toBeNull();

    await m.press((reading) => reading.goToSection(3));
    expect(bridge.browse).toHaveBeenCalledWith(3);
    expect(m.reading.status.utterance).toBe(1);
    await m.down();
  });

  it('takes the reading to the chapter when a stored place has not been found yet, having no sentence to keep', async () => {
    // The place names spine item 4, which has not reported: nothing is highlighted
    // yet, so the row does what it did before and the place is given up on (#51).
    const stored = readingPlaceAt(createLocator('epub', 'epubcfi(/6/10!/4/4)'), 'A sentence in chapter four.', 0, 27);
    const m = mount({ settings: READY, resume: stored, spine: SPINE_OF_FIVE });
    await m.up();
    await m.report([...ONE, ...TWO], 2);
    expect(m.reading.status.utterance).toBeNull();

    await m.press((reading) => reading.goToSection(2));
    expect(bridge.browse).not.toHaveBeenCalled();
    expect(bridge.goToSection).toHaveBeenCalledWith(2);
    expect(m.reading.status.utterance).toBe(at('Chapter Two.'));
    expect(m.reading.status.resume).toBe(
      'The place this book was left at had not rendered yet when the reading was moved, so it starts there instead.',
    );
    await m.down();
  });

  it('brings the page to a cue only while playing: a cue while paused repaints where the page is', async () => {
    // A paused seek's Clip is cued when it arrives, and a speed change re-cues the
    // Clip it re-scales (`engine.ts`); either can land while the owner is browsing.
    const m = mount({ settings: READY, spine: SPINE_OF_FIVE });
    await m.up();
    await m.report(ALL, 3);
    await m.press((reading) => reading.play());
    const engine = engines.built[0];
    await m.press(() => engine.deps.clock.onClip(cue(at(FERRY))));
    expect(bridge.onClip).toHaveBeenLastCalledWith(expect.objectContaining({ utterance: at(FERRY) }), { reveal: true });

    await m.press((reading) => reading.pause());
    await m.press(() => engine.deps.clock.onClip(cue(at(FERRY))));
    expect(bridge.onClip).toHaveBeenLastCalledWith(expect.objectContaining({ utterance: at(FERRY) }), { reveal: false });
    await m.down();
  });

  it('reveals only the first cue after Play: the reading moving on recovers, and leaves a browsed page where it is (#71)', async () => {
    const m = mount({ settings: READY, spine: SPINE_OF_FIVE });
    await m.up();
    await m.report(ALL, 3);
    await m.press((reading) => reading.play());
    const engine = engines.built[0];
    await m.press(() => engine.deps.clock.onClip(cue(at(FERRY))));
    expect(bridge.onClip).toHaveBeenLastCalledWith(expect.objectContaining({ utterance: at(FERRY) }), { reveal: true });
    // The next Clip, the reading moving on while it plays, and a speed change's
    // re-cue of it: neither is the owner asking for the reading.
    await m.press(() => engine.deps.clock.onClip(cue(at(FERRY) + 1)));
    expect(bridge.onClip).toHaveBeenLastCalledWith(expect.objectContaining({ utterance: at(FERRY) + 1 }), { reveal: false, recover: true });
    await m.press(() => engine.deps.clock.onClip(cue(at(FERRY) + 1)));
    expect(bridge.onClip).toHaveBeenLastCalledWith(expect.objectContaining({ utterance: at(FERRY) + 1 }), { reveal: false, recover: true });

    // Play again after a pause is the owner asking again.
    await m.press((reading) => reading.pause());
    await m.press((reading) => reading.play());
    await m.press(() => engine.deps.clock.onClip(cue(at(FERRY) + 1)));
    expect(bridge.onClip).toHaveBeenLastCalledWith(expect.objectContaining({ utterance: at(FERRY) + 1 }), { reveal: true });
    await m.down();
  });

  it('brings the page back without starting anything when M is pressed (#71, #53)', async () => {
    const m = mount({ settings: READY, spine: SPINE_OF_FIVE });
    await m.up();
    await m.report(ALL, 3);
    await m.press((reading) => reading.play());
    await m.press(() => engines.built[0].deps.clock.onClip(cue(at(FERRY))));
    await m.press((reading) => reading.pause());
    expect(m.reading.status.playing).toBe(false);

    await m.press((reading) => reading.returnToReading());
    expect(bridge.returnToReading).toHaveBeenLastCalledWith(at(FERRY));
    expect(m.reading.status.playing).toBe(false);
    await m.down();
  });

  it('repaints the sentence without moving the page when a new Voice replaces the engine while paused', async () => {
    const m = mount({ settings: READY, spine: SPINE_OF_FIVE });
    await m.up();
    await m.report(ALL, 3);
    await m.press((reading) => reading.play());
    await m.press(() => engines.built[0].deps.clock.onClip(cue(at(FERRY))));
    await m.press((reading) => reading.pause());
    bridge.show.mockClear();

    await m.settings({ ...READY, voice: 'bf_emma' });
    expect(bridge.show).toHaveBeenCalledTimes(1);
    expect(bridge.show).toHaveBeenLastCalledWith(at(FERRY), { reveal: false });
    expect(m.reading.status.utterance).toBe(at(FERRY));
    await m.down();
  });
});

/**
 * Play after the desktop has read further (#54). The phone resumed in chapter
 * one and paused; the desktop's newer place, in section 3, is taken from the
 * Positions File by the sync Play waits for, or by one a moment before, and the
 * phone has not rendered section 3. Measured on 2026-09-24 against this harness:
 * Play gave the place up, the engine was loaded at the phone's own sentence, and
 * the section reporting a moment later moved nothing — so the phone read its old
 * place and then wrote it over the desktop's.
 */
describe('Play with a newer place still on its way (#54)', () => {
  const READY: AppSettings = { ...DEFAULT_SETTINGS, provider: 'local', enabledProviders: ['local'], voice: 'af_bella' };
  /** The phone's own place: the second Block of chapter one, where the owner paused before going to the desktop. */
  const phonePlace = readingPlaceAt(createLocator('epub', 'epubcfi(/6/2!/4/4)'), CHAPTER_ONE[1].text, 0, CHAPTER_ONE[1].text.length);
  const BOTH = [...CHAPTER_ONE, ...CHAPTER_THREE];
  const LENGTH = segmentDocument(BOTH, 'en').length;
  /** The desktop's sentence, once chapters one and three have reported. */
  const DESKTOP_AT = segmentDocument(BOTH, 'en').findIndex((utterance) => utterance.text === 'The sentence the desktop stopped on.');

  /** Mounted on the phone's own place, resumed in chapter one and paused there. */
  async function resumedOnThePhone() {
    const m = mount({ settings: READY, resume: phonePlace });
    await m.up();
    await m.report(CHAPTER_ONE, 0);
    expect(m.reading.status.utterance).toBe(1);
    return m;
  }

  it('waits for the section when Play comes in the same moment as the place, and reads from the place', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const m = await resumedOnThePhone();
      // What `reading-view.tsx`'s `play` does once its sync has adopted the desktop's place.
      let taken = false;
      await m.press((reading) => {
        taken = reading.resumeAt(desktopPlace);
        reading.play();
      });
      expect(taken).toBe(true);
      expect(bridge.goTo).toHaveBeenCalledTimes(1);
      expect(bridge.goTo).toHaveBeenCalledWith('epubcfi(/6/6!/4/4)');
      // Starting, with nothing built and nothing given up.
      expect(m.reading.status.playing).toBe(true);
      expect(m.reading.status.buffering).toBe(true);
      expect(m.reading.status.resume).toBeNull();
      expect(engines.built).toHaveLength(0);

      await m.report(BOTH, 2);
      await m.settle();
      expect(DESKTOP_AT).toBe(3);
      expect(m.reading.status.utterance).toBe(DESKTOP_AT);
      expect(engines.built).toHaveLength(1);
      expect(engines.built[0].loads).toEqual([{ length: LENGTH, from: DESKTOP_AT, quiet: false }]);
      // Loaded at the place, so the landing's own seek is not sent after it.
      await act(async () => { vi.advanceTimersByTime(600); });
      expect(engines.built[0].seeks).toEqual([]);
      await m.down();
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits the same way for a place taken a moment before Play, while its section was loading', async () => {
    const m = await resumedOnThePhone();
    // The adopted-place effect, after a foreground sync.
    await act(async () => { m.reading.resumeAt(desktopPlace); });
    await m.press((reading) => reading.play());
    expect(engines.built).toHaveLength(0);
    await m.report(BOTH, 2);
    await m.settle();
    expect(engines.built[0].loads).toEqual([{ length: LENGTH, from: DESKTOP_AT, quiet: false }]);
    await m.down();
  });

  it('reads from the place at once when its section has already reported (control)', async () => {
    const m = await resumedOnThePhone();
    await m.report(BOTH, 2);
    await m.press((reading) => {
      reading.resumeAt(desktopPlace);
      reading.play();
    });
    expect(engines.built[0].loads).toEqual([{ length: LENGTH, from: DESKTOP_AT, quiet: false }]);
    await m.down();
  });

  it('seeks an engine that already exists to the place before it plays, so the old sentence is never spoken', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const m = await resumedOnThePhone();
      // The phone reads from its own place and is paused, before the owner goes to the desktop.
      await m.press((reading) => reading.play());
      const engine = engines.built[0];
      expect(engine.loads).toEqual([{ length: 2, from: 1, quiet: false }]);
      await m.press(() => engine.deps.clock.onClip({ utterance: 1, words: null, duration: 1, rate: 1 }));
      await m.press((reading) => reading.pause());
      await act(async () => { vi.advanceTimersByTime(600); });
      engine.calls.length = 0;

      await m.press((reading) => {
        reading.resumeAt(desktopPlace);
        reading.play();
      });
      // Waiting: the paused engine is not asked to play the queue it holds, which is the old sentence.
      expect(engine.calls).toEqual([]);
      expect(m.reading.status.playing).toBe(true);

      await m.report(BOTH, 2);
      await m.settle();
      expect(engine.calls).toEqual(['extend', `seek:${DESKTOP_AT}`, 'play']);
      // The landing's own seek has gone out already, and is not sent a second time.
      await act(async () => { vi.advanceTimersByTime(600); });
      expect(engine.calls).toEqual(['extend', `seek:${DESKTOP_AT}`, 'play']);
      await m.down();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the player starting while it waits, whatever the paused engine publishes', async () => {
    const m = await resumedOnThePhone();
    await m.press((reading) => reading.play());
    const engine = engines.built[0];
    await m.press((reading) => reading.pause());
    await m.press((reading) => {
      reading.resumeAt(desktopPlace);
      reading.play();
    });
    // A paused engine says it is paused — after a quiet reload, say — and the player must not believe it.
    await m.press(() => engine.deps.onState!({ playing: false, buffering: false }));
    expect(m.reading.status.playing).toBe(true);
    expect(m.reading.status.buffering).toBe(true);
    await m.down();
  });

  it('gives the place up, saying why, when its own section reports without it, and reads from the phone\'s place', async () => {
    const m = await resumedOnThePhone();
    await m.press((reading) => {
      reading.resumeAt(desktopPlace);
      reading.play();
    });
    // Section 3 reports with other words in it: nothing the desktop quoted is there.
    const rewritten = [...CHAPTER_ONE, ...blocks(2, ['Chapter three, rewritten.', 'None of the old words remain here.'])];
    await m.report(rewritten, 2);
    await m.settle();
    expect(m.reading.status.resume).toMatch(/^The sentence this book was left on is not in the text that has rendered\./);
    expect(m.reading.status.resumeNeedsAttention).toBe(true);
    expect(engines.built[0].loads).toEqual([{ length: segmentDocument(rewritten, 'en').length, from: 1, quiet: false }]);
    await m.down();
  });

  it('lets Pause end the wait and keep the place, which then lands on the paused book', async () => {
    const m = await resumedOnThePhone();
    await m.press((reading) => {
      reading.resumeAt(desktopPlace);
      reading.play();
    });
    await m.press((reading) => reading.pause());
    expect(m.reading.status.playing).toBe(false);
    expect(m.reading.status.resume).toBeNull();

    await m.report(BOTH, 2);
    await m.settle();
    expect(m.reading.status.utterance).toBe(DESKTOP_AT);
    expect(m.reading.status.playing).toBe(false);
    expect(engines.built).toHaveLength(0);
    // Landed: the stored position already is that sentence, with the desktop's Stamp.
    expect(m.reading.readingPosition()).toBeNull();
    await m.down();
  });

  it('lets a tapped word end the claim while Play waits, and reads from the word', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const m = await resumedOnThePhone();
      await m.press((reading) => {
        reading.resumeAt(desktopPlace);
        reading.play();
      });
      await m.press((reading) => reading.seekTo(0));
      expect(m.reading.status.resume).toBe(
        'The place this book was left at had not rendered yet when the reading was moved, so it starts there instead.',
      );
      expect(m.reading.status.resumeNeedsAttention).toBe(true);
      expect(engines.built[0].loads).toEqual([{ length: 2, from: 0, quiet: false }]);

      // The section arriving afterwards takes nothing back.
      await m.report(BOTH, 2);
      expect(m.reading.status.utterance).toBe(0);
      await act(async () => { vi.advanceTimersByTime(600); });
      expect(engines.built[0].seeks).toEqual([]);
      await m.down();
    } finally {
      vi.useRealTimers();
    }
  });

  it('writes no place while one is on its way, because the stored position already is that place', async () => {
    const m = mount({ settings: READY });
    await m.up();
    await m.report(CHAPTER_ONE, 0);
    // A sentence the owner pointed at is a place to write …
    await act(async () => { m.reading.seekTo(1); });
    expect(m.reading.readingPosition()).not.toBeNull();
    // … until a newer one is taken from another device and is on its way.
    await act(async () => { m.reading.resumeAt(desktopPlace); });
    expect(m.reading.readingPosition()).toBeNull();
    // Landed, the cursor is on the sentence the stored position names: still nothing to write.
    await m.report(BOTH, 2);
    expect(m.reading.readingPosition()).toBeNull();
    // Moved by the owner, it is theirs again.
    await act(async () => { m.reading.seekTo(0); });
    expect(m.reading.readingPosition()).not.toBeNull();
    await m.down();
  });

  it('takes one arrival once when Play passes it first and the arrival effect passes it again', async () => {
    const m = await resumedOnThePhone();
    await m.press((reading) => {
      reading.resumeAt(desktopPlace);
      reading.play();
    });
    // The next render hands the same adoption to the adopted-place effect.
    await act(async () => { m.reading.resumeAt(desktopPlace); });
    expect(bridge.goTo).toHaveBeenCalledTimes(1);
    await m.report(BOTH, 2);
    await m.settle();
    expect(engines.built[0].loads).toEqual([{ length: LENGTH, from: DESKTOP_AT, quiet: false }]);
    await m.down();
  });

  it('takes one arrival once when the arrival effect passes it first and Play passes it again', async () => {
    const m = await resumedOnThePhone();
    await act(async () => { m.reading.resumeAt(desktopPlace); });
    await m.press((reading) => {
      reading.resumeAt(desktopPlace);
      reading.play();
    });
    expect(bridge.goTo).toHaveBeenCalledTimes(1);
    await m.report(BOTH, 2);
    await m.settle();
    expect(engines.built[0].loads).toEqual([{ length: LENGTH, from: DESKTOP_AT, quiet: false }]);
    await m.down();
  });
});

/**
 * Reopening a book whose place was taken from another device earlier in the
 * session (#55). `reader-screen.tsx` used to hand that adoption over again at
 * mount, and `resumeAt` with the very place the book opens with asked the
 * renderer for its section as well — a second display of a section
 * `initialLocation` is already displaying. Measured on 2026-09-24: `goTo` twice.
 */
describe('the place a book opens with, passed to resumeAt again (#55)', () => {
  it('asks the renderer for nothing: initialLocation is already displaying its section', async () => {
    const CONTENTS = blocks(0, ['Contents', 'Chapter three, at last.']);
    const m = mount({ resume: desktopPlace });
    await m.up();
    await act(async () => { m.reading.resumeAt(desktopPlace); });
    // The start of the book reports first (#51); the place's own section is still loading.
    await m.report(CONTENTS, 0);
    expect(bridge.goTo).not.toHaveBeenCalled();
    await m.down();
  });
});

/**
 * #109. What the player shows when the engine reports that a Provider was not
 * allowed. The engine is the harness's fake, so this is the hook's half only.
 * The engine's half is to stop quietly at the refused sentence (ADR 0027). The
 * fetch half, that no clock gives up while the question is up, is in
 * `test/offline/runtime-consent.test.ts`.
 */
describe('a Provider the owner did not allow (#109)', () => {
  const READY: AppSettings = { ...DEFAULT_SETTINGS, provider: 'local', enabledProviders: ['local'], voice: 'af_bella' };

  it('is not a note, and moves nothing, where a Provider that did not answer is a note', async () => {
    const m = mount({ settings: READY });
    await m.up();
    await m.report(CHAPTER_ONE, 0);
    await m.press((reading) => reading.play());
    const engine = engines.built.at(-1)!;
    await act(async () => { engine.deps.clock.onClip({ utterance: 1, words: null, duration: 1, rate: 1 }); });
    expect(m.reading.status.utterance).toBe(1);

    await act(async () => { engine.deps.onError(new SynthesisError('declined', 'The server at 127.0.0.1:8795 was not allowed to receive this document\'s text.')); });
    expect(m.reading.status.note).toBeNull();
    expect(m.reading.status.utterance).toBe(1);
    expect(engine.seeks).toEqual([]);

    // What the simulator showed instead, at 60.09 s, from the clip fetcher's
    // clock: a Provider that did not answer is a note, and rightly so. So the fix
    // is that no clock runs while the owner is asked, not that the note is hidden.
    await act(async () => { engine.deps.onError(new SynthesisError('network', 'local: no audio within 60s')); });
    expect(m.reading.status.note).toBe('local: no audio within 60s');
    await m.down();
  });
});
