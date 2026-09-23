import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { createLocator, readingPlaceAt, type ReadingPlace } from '../../src/core/document';
import type { ReportedBlock } from '../../src/renderer/messages';
import { segmentDocument } from '../../src/app/segment';
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';
import { spineIndexOf, useReading, type Reading } from '../../src/app/use-reading';

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
 * sought, and whether anything pauses it.
 */

const bridge = vi.hoisted(() => ({
  goTo: vi.fn<(cfi: string) => void>(),
  goToSection: vi.fn<(index: number) => void>(),
  show: vi.fn<(utterance: number) => void>(),
  clear: vi.fn<() => void>(),
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
  }
  interface Load { length: number; from: number; quiet: boolean }
  const built: { deps: Deps; loads: Load[]; seeks: number[]; pauses: number }[] = [];
  function create(deps: Deps) {
    const engine = { deps, loads: [] as Load[], seeks: [] as number[], pauses: 0 };
    built.push(engine);
    return {
      load(list: readonly unknown[], from = 0, options: { quiet?: boolean } = {}) {
        engine.loads.push({ length: list.length, from, quiet: options.quiet === true });
      },
      extend() {},
      play() {},
      pause() { engine.pauses++; },
      seek(utterance: number) { engine.seeks.push(utterance); },
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
        show: bridge.show,
        clock: { onClip() {}, onPosition() {} },
        setUtterances() {},
        setInset() {},
        setAppearance() {},
        setTheme() {},
        hold() {},
        clear: bridge.clear,
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
  const { settings = DEFAULT_SETTINGS, resume = null, spine = SPINE } = options;
  bridge.goTo.mockClear();
  bridge.goToSection.mockClear();
  bridge.show.mockClear();
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
    get reading() { return reading!; },
  };
}

describe('spineIndexOf', () => {
  it('reads the spine index off the step both readers number the same way', () => {
    expect(spineIndexOf('epubcfi(/6/2!/4/4)')).toBe(0);
    expect(spineIndexOf('epubcfi(/6/6!/4/2/4)')).toBe(2);
    expect(spineIndexOf('epubcfi(/6/34!/4/2/4/2/4)')).toBe(16);
    expect(spineIndexOf('epubcfi(/6/3!/4)')).toBeNull();
    expect(spineIndexOf('/6/6!/4/4')).toBeNull();
    expect(spineIndexOf('')).toBeNull();
  });
});

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
      // … and the tap's own seek, when it goes out, names the same sentence.
      await act(async () => { vi.advanceTimersByTime(600); });
      expect(engines.built[0].seeks).toEqual([opening]);
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
      await act(async () => { vi.advanceTimersByTime(600); });
      expect(engines.built[0].seeks).toEqual([place]);
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
