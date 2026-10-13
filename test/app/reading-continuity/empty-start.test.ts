import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, type AppSettings } from '../../../src/app/settings';
import { useReading, type Reading } from '../../../src/app/use-reading';
import { BLOCKS_MESSAGE, DOCUMENT_MESSAGE, type ReportedBlock } from '../../../src/renderer/messages';

/**
 * Play with nothing to read walks the Document forward to the first section
 * with text. When the last section to report lies above one that has already
 * reported with no text, the walk asks the page for that reported section, and
 * no report of that section reaches the hook.
 *
 * The real `useReading` over the real `useReaderBridge` (so the real
 * `withSection`). Doubled: the page (the library's `useReader` records every
 * `goToLocation`, and the test sends the messages the page's program would
 * send) and the playback engine, as in test/app/use-reading-resume.test.ts.
 */

const page = vi.hoisted(() => ({
  /** Every target `rendition.display` was asked for, in order. */
  displayed: [] as string[],
}));
const reader = vi.hoisted(() => ({
  injectJavascript() {},
  goToLocation(target: string) { page.displayed.push(target); },
  theme: null,
  changeTheme() {},
}));
const engines = vi.hoisted(() => {
  const built: { loads: { length: number; from: number }[] }[] = [];
  function create() {
    const engine = { loads: [] as { length: number; from: number }[] };
    built.push(engine);
    return {
      load(list: readonly unknown[], from = 0) { engine.loads.push({ length: list.length, from }); },
      extend() {}, play() {}, pause() {}, silence() {}, seek() {}, setRate() {}, switchVoice() {}, cancelVoiceSwitch() {},
      snapshot: () => ({ playing: false, utterance: 0, rate: 1, queued: 0, fetching: 0 }),
      dispose: async () => {},
    };
  }
  return { built, create };
});

vi.mock('react-native', () => ({ useColorScheme: () => 'light' }));
vi.mock('@epubjs-react-native/core', () => ({ useReader: () => reader }));
vi.mock('../../../src/playback', async () => ({
  ...(await vi.importActual<typeof import('../../../src/playback/navigation')>('../../../src/playback/navigation')),
  createPlaybackEngine: engines.create,
}));
vi.mock('../../../src/offline/runtime', () => ({
  hasSavedVoice: () => false,
  inventoryReady: () => true,
  offlineProvider: () => ({ capabilities: { wordTimestamps: false } }),
}));
vi.mock('../../../src/now-playing', () => ({ lockScreenPosition: () => {}, restateNowPlaying: () => {} }));
vi.mock('../../../src/app/body-text-sizes', () => ({ readBodyTextSize: () => null, writeBodyTextSize: () => {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const DOCUMENT = 'sha256:' + 'f'.repeat(64);
const READY: AppSettings = { ...DEFAULT_SETTINGS, provider: 'local', enabledProviders: ['local'], voice: 'af_bella' };

/** Nine spine items: sections 0 to 5 hold no text (a cover, pictures, a title page), the chapters start at 6. */
const SPINE = 9;
const FIRST_WITH_TEXT = 6;
const TEXT: Record<number, string[]> = {
  6: ['Chapter One.', 'Rain fell on the old harbour.'],
  7: ['Chapter Two.', 'Every lantern in the valley was lit.'],
  8: ['Chapter Three.', 'The blacksmith counted his coins twice.'],
};
function blocksOf(section: number): ReportedBlock[] {
  return (TEXT[section] ?? []).map((text, at) => ({
    id: `${section}.${at}`,
    text,
    role: 'paragraph' as const,
    section: `s${section}.xhtml`,
    sectionIndex: section,
    cfi: `epubcfi(/6/${2 * (section + 1)}[s${section}]!/4/${2 * (at + 1)})`,
  }));
}

const settled = () => act(async () => { await new Promise((resolve) => setImmediate(resolve)); });

async function open() {
  page.displayed.length = 0;
  engines.built.length = 0;
  let reading: Reading | undefined;
  function Probe() {
    reading = useReading(READY, { hasKey: false, writtenAt: 0 }, null, DOCUMENT);
    return null;
  }
  let tree: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Probe)); });
  const send = (message: unknown) => act(async () => { reading!.bridge.readerProps.onWebViewMessage(message); });
  // The page's program installs and says how long the spine is.
  await send({ type: DOCUMENT_MESSAGE, spine: SPINE, hrefs: Array.from({ length: SPINE }, (_, at) => `s${at}.xhtml`) });
  /** The sections the page has rendered and reported so far. */
  const reported = new Set<number>();
  /** The page renders a section and its program reports the section's Blocks. */
  async function report(section: number) {
    reported.add(section);
    await send({ type: BLOCKS_MESSAGE, sectionIndex: section, section: `s${section}.xhtml`, blocks: blocksOf(section), sizes: null });
  }
  return {
    report,
    async press(action: (reading: Reading) => void) {
      await act(async () => {
        action(reading!);
        await new Promise((resolve) => setImmediate(resolve));
      });
    },
    /**
     * The page answers every display it was asked for since `from`, in order,
     * by rendering that section anew and reporting it. A section epub.js
     * still holds is only scrolled to and sends nothing, which comes to the
     * same at the bridge. Left out: the layout check epub.js runs after a
     * display, which on the phone can add a section that has never reported.
     */
    async answer(from = 0) {
      const asked: { section: number; alreadyReported: boolean }[] = [];
      for (let at = from; at < page.displayed.length && at < from + 2 * SPINE; at++) {
        const section = Number(page.displayed[at]);
        asked.push({ section, alreadyReported: reported.has(section) });
        await report(section);
        await settled();
      }
      return asked;
    },
    get reading() { return reading!; },
    async down() { await act(async () => { tree.unmount(); }); },
  };
}

describe('Play looking for the first section with text', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }); });
  afterEach(() => { vi.useRealTimers(); });

  // The orders a Contents row can produce: epub.js displays the section chosen,
  // then lays out the sections around it. The third is the order measured on
  // the simulator for a row to section 5 with sections 1 and 2 laid out at
  // opening (notes/NOTES_2026-09-23.md, 13:35: "reported 5 and 6, then 3 and
  // 4"), moved one section up.
  it.each([
    { order: [3, 2], why: 'the section above reports after the one chosen' },
    { order: [3, 4, 2], why: 'both neighbours are laid out and the one above reports last' },
    { order: [0, 1, 4, 5, 2, 3], why: 'the opening, a row to section 4, the one below, then the two above' },
  ])('finds the first section with text and starts reading when sections report in the order $order: $why', async ({ order }) => {
    const m = await open();
    for (const section of order) await m.report(section);
    expect(m.reading.status.known).toBe(0);

    await m.press((reading) => reading.play());
    expect(m.reading.status.seeking).toBe(true);
    const asked = await m.answer();
    await act(async () => { vi.advanceTimersByTime(10 * 60 * 1000); });
    await settled();

    expect.soft(asked.filter((one) => one.alreadyReported).map((one) => one.section), 'sections Play asked the page for although they had already reported with no text').toEqual([]);
    expect.soft(asked.at(-1)?.section, 'the last section Play asked the page for').toBe(FIRST_WITH_TEXT);
    const { seeking, known } = m.reading.status;
    expect.soft({ seeking, known }, 'ten minutes after Play').toEqual({ seeking: false, known: 2 });
    expect.soft(engines.built.map((engine) => engine.loads), 'the reading started at the first sentence of section 6').toEqual([[{ length: 2, from: 0 }]]);

    // Pause and Play again.
    await m.press((reading) => reading.pause());
    const from = page.displayed.length;
    await m.press((reading) => reading.play());
    const again = await m.answer(from);
    expect.soft(again.filter((one) => one.alreadyReported).map((one) => one.section), 'sections the second Play asked the page for although they had reported').toEqual([]);
    expect.soft(m.reading.status.seeking, 'the second Play is still looking').toBe(false);
    await m.down();
  });

  it('control, passes today: the same two sections with the lower one reporting first', async () => {
    const m = await open();
    for (const section of [2, 3]) await m.report(section);
    await m.press((reading) => reading.play());
    const asked = await m.answer();
    expect(asked).toEqual([4, 5, 6].map((section) => ({ section, alreadyReported: false })));
    expect(m.reading.status.seeking).toBe(false);
    expect(engines.built.map((engine) => engine.loads)).toEqual([[{ length: 2, from: 0 }]]);
    await m.down();
  });
});
