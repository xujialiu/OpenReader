import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { createLocator, readingPlaceAt, type ReadingPlace } from '../../src/core/document';
import type { ReportedBlock } from '../../src/renderer/messages';
import { DEFAULT_SETTINGS } from '../../src/app/settings';
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
 */

const bridge = vi.hoisted(() => ({
  goTo: vi.fn<(cfi: string) => void>(),
  goToSection: vi.fn<(index: number) => void>(),
  show: vi.fn(),
  options: null as null | { onBlocks?(blocks: readonly ReportedBlock[], section: { index: number; href: string; spine: number }): void },
}));

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
        clear() {},
        readerProps: {},
      };
    },
  };
});
vi.mock('../../src/playback', async () => ({
  ...(await vi.importActual<typeof import('../../src/playback/navigation')>('../../src/playback/navigation')),
  createPlaybackEngine: () => { throw new Error('no engine is built in this test'); },
}));
vi.mock('../../src/offline/runtime', () => ({ hasSavedVoice: () => false, inventoryReady: () => true, offlineProvider: () => null }));
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

function mount() {
  bridge.goTo.mockClear();
  bridge.goToSection.mockClear();
  let reading: Reading | undefined;
  function Probe() {
    reading = useReading(DEFAULT_SETTINGS, { hasKey: false, writtenAt: 0 }, null, DOCUMENT);
    return null;
  }
  let tree: ReactTestRenderer;
  return {
    async up() { await act(async () => { tree = create(createElement(Probe)); }); },
    async down() { await act(async () => { tree.unmount(); }); },
    async report(reported: readonly ReportedBlock[], section: number) {
      await act(async () => { bridge.options!.onBlocks!(reported, { index: section, href: `s${section}.xhtml`, spine: SPINE }); });
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
