import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { contentsOf } from '../../src/core/document/contents';
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';
import { useReading, type Reading } from '../../src/app/use-reading';
import { BLOCKS_MESSAGE, DOCUMENT_MESSAGE, type ReportedBlock, type SectionAnchors } from '../../src/renderer/messages';

/**
 * A Contents row that names a fragment opens its chapter, not the top of the
 * file that holds it (#307).
 *
 * The Gutenberg Pride and Prejudice keeps its 61 chapters in 7 files, and each
 * Contents row points at a fragment, as `1342-h-0.htm.xhtml#pgepubid00046` for
 * CHAPTER V. The owner's iPhone logged every Contents tap as "the app asks
 * epub.js to display section 1 (browse)": the fragment never left the app, so
 * every chapter after the first of a file opened at the top of that file.
 *
 * Real: `contentsOf`, `useReading` and the bridge `useReaderBridge` builds,
 * with the page's messages arriving through `onWebViewMessage` in the shape the
 * page sends them. Stand-ins: the library's `goToLocation`, which records what
 * epub.js would be asked to display, and the playback engine, which records
 * where it is sought.
 */

const world = vi.hoisted(() => ({ displays: [] as string[] }));

vi.mock('react-native', () => ({ useColorScheme: () => 'light' }));
vi.mock('@epubjs-react-native/core', () => {
  const reader = {
    injectJavascript() {},
    goToLocation: (target: string) => world.displays.push(target),
    theme: null,
    changeTheme() {},
  };
  return { useReader: () => reader };
});
vi.mock('../../src/playback', async () => ({
  ...(await vi.importActual<typeof import('../../src/playback/navigation')>('../../src/playback/navigation')),
  createPlaybackEngine: () => ({
    load() {}, extend() {}, play() {}, pause() {}, silence() {}, seek() {}, setRate() {},
    switchVoice() {}, cancelVoiceSwitch() {}, stopAfter() {},
    snapshot: () => ({ playing: false, utterance: 0, rate: 1, queued: 0, fetching: 0 }),
    dispose: async () => {},
  }),
}));
vi.mock('../../src/offline/runtime', () => ({
  hasSavedVoice: () => false,
  inventoryReady: () => true,
  offlineProvider: () => ({ capabilities: { wordTimestamps: false } }),
}));
vi.mock('../../src/now-playing', () => ({ lockScreenPosition: () => {}, restateNowPlaying: () => {} }));
vi.mock('../../src/app/body-text-sizes', () => ({ readBodyTextSize: () => 16, writeBodyTextSize: () => {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const DOCUMENT = 'sha256:' + 'c'.repeat(64);
const READY: AppSettings = { ...DEFAULT_SETTINGS, provider: 'local', enabledProviders: ['local'], voice: 'af_bella' };

/** The book's shape: a cover, then one file holding a title page and three chapters, as Gutenberg's 1342-h-0 does. */
const FILE = '1342-h-0.htm.xhtml';
const SPINE = ['wrap0000.xhtml', FILE];
/** The Contents as epub.js's EPUB 3 `navItem` hands it over: a leading slash, and the fragment (#125). */
const TOC = [
  { id: 'np-1', href: `/${FILE}#pgepubid00022`, label: 'Chapter I.', subitems: [] },
  { id: 'np-2', href: `/${FILE}#pgepubid00028`, label: 'CHAPTER II.', subitems: [] },
  { id: 'np-3', href: `/${FILE}#pgepubid00033`, label: 'CHAPTER III.', subitems: [] },
];
const TEXTS = [
  'PRIDE AND PREJUDICE.',
  'Chapter I.',
  'It is a truth universally acknowledged.',
  'CHAPTER II.',
  'Mr. Bennet was among the earliest.',
  'CHAPTER III.',
  'Not all that Mrs. Bennet could ask.',
];
/** Where the page says each fragment starts in the file: the Block ordinal of its heading. */
const ANCHORS: SectionAnchors = [['pgepubid00022', 1], ['pgepubid00028', 3], ['pgepubid00033', 5]];
const BLOCKS: ReportedBlock[] = TEXTS.map((text, at) => ({
  id: `1.${at}`,
  text,
  role: text.toUpperCase().startsWith('CHAPTER') ? 'heading' : 'paragraph',
  section: FILE,
  sectionIndex: 1,
  cfi: `epubcfi(/6/4!/4/${2 * (at + 1)})`,
}));

const rows = contentsOf(TOC, SPINE).rows;
const chapterTwo = rows[1];

let tree: ReactTestRenderer | null = null;
afterEach(async () => {
  await act(async () => { tree?.unmount(); });
  tree = null;
  world.displays.length = 0;
});

async function open() {
  let reading!: Reading;
  function Probe() {
    reading = useReading(READY, { hasKey: false, writtenAt: 0 }, null, DOCUMENT);
    return null;
  }
  await act(async () => { tree = create(createElement(Probe)); });
  const arrive = async (message: unknown) => {
    await act(async () => { reading.bridge.readerProps.onWebViewMessage(JSON.parse(JSON.stringify(message))); });
  };
  await arrive({ type: DOCUMENT_MESSAGE, spine: SPINE.length, hrefs: SPINE });
  return {
    get reading() { return reading; },
    /** The file's Blocks, with where its fragments start, as the page reports them once it is laid out. */
    report: (anchors: SectionAnchors | undefined = ANCHORS) =>
      arrive({ type: BLOCKS_MESSAGE, sectionIndex: 1, section: FILE, blocks: BLOCKS, sizes: null, anchors }),
    /** `contents-sheet.tsx`'s row press, as `reading-view.tsx` wires it. */
    press: async (row: typeof chapterTwo) => {
      await act(async () => { reading.goToSection(row.target!, row.fragment); });
    },
  };
}

const indexOf = (text: string) => TEXTS.indexOf(text);

describe('a Contents row that names a fragment (#307)', () => {
  it('the fixture: the row is the file\'s second chapter, and it names its fragment', () => {
    expect(chapterTwo).toMatchObject({ label: 'CHAPTER II.', target: 1, fragment: 'pgepubid00028' });
  });

  it('asks epub.js for the fragment, in a book with no Reading Position yet', async () => {
    const book = await open();
    await book.press(chapterTwo);
    expect(world.displays.at(-1)).toBe(`${FILE}#pgepubid00028`);
  });

  it('reads from the chapter\'s heading once the file reports, in a book with no Reading Position yet', async () => {
    const book = await open();
    await book.press(chapterTwo);
    await book.report();
    // One Utterance per Block here: every Block is one sentence.
    expect(book.reading.status.utterance).toBe(indexOf('CHAPTER II.'));
  });

  it('reads from the chapter\'s heading at once when the file has already reported', async () => {
    const book = await open();
    await book.report();
    await book.press(chapterTwo);
    expect(world.displays.at(-1)).toBe(`${FILE}#pgepubid00028`);
    expect(book.reading.status.utterance).toBe(indexOf('CHAPTER II.'));
  });

  it('Browsing with a Reading Position: the page goes to the fragment, and the reading stays', async () => {
    const book = await open();
    await book.report();
    await act(async () => { book.reading.seekTo(indexOf('It is a truth universally acknowledged.')); });
    await book.press(chapterTwo);
    expect(world.displays.at(-1)).toBe(`${FILE}#pgepubid00028`);
    expect(book.reading.status.utterance).toBe(indexOf('It is a truth universally acknowledged.'));
  });

  it('a fragment the file does not contain: the top of the file, as before', async () => {
    const book = await open();
    await book.press(chapterTwo);
    await book.report([['pgepubid00022', 1]]);
    expect(book.reading.status.utterance).toBe(0);
  });

  it('a row with no fragment still opens its file by its spine index', async () => {
    const book = await open();
    const whole = contentsOf([{ id: 'x', href: FILE, label: 'The book', subitems: [] }], SPINE).rows[0];
    await book.press(whole);
    expect(world.displays.at(-1)).toBe('1');
  });
});
