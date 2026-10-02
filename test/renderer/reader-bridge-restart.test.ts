import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { segmentDocument } from '../../src/app/segment';
import { BLOCKS_MESSAGE, DOCUMENT_MESSAGE, type ReportedBlock } from '../../src/renderer/messages';
import { useReaderBridge, type ReaderBridge } from '../../src/renderer/reader-bridge';

/**
 * The page's web content process ended and a new page is mounted in its place
 * (#120): the real bridge, with the library's `useReader` faked so every message
 * the page would be sent is recorded.
 *
 * On the owner's iPhone iOS ended the process while the app was suspended, and
 * the reader came back blank with a paused Reading. The new page knows none of
 * the Blocks the Reading was built from, so the sentence can be painted again
 * only once the new page has reported its section, and only once.
 */

const page = vi.hoisted(() => ({
  sent: [] as Record<string, unknown>[],
  displayed: [] as string[],
}));

vi.mock('@epubjs-react-native/core', () => ({
  useReader: () => ({
    injectJavascript(code: string) {
      const found = /\((\{.*\})\); true;$/.exec(code);
      if (found) page.sent.push(JSON.parse(found[1]) as Record<string, unknown>);
    },
    goToLocation(cfi: string) {
      page.displayed.push(cfi);
    },
    theme: null,
    changeTheme() {},
  }),
}));
vi.mock('../../src/debug/debug-log', () => ({ debugLog: () => {}, cutText: (text: string) => text }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function section(index: number, texts: readonly string[]): ReportedBlock[] {
  return texts.map((text, at) => ({
    id: `${index}.${at}`,
    text,
    role: 'paragraph' as const,
    section: `s${index}.xhtml`,
    sectionIndex: index,
    cfi: `epubcfi(/6/${2 * (index + 1)}!/4/${2 * (at + 1)})`,
  }));
}

const FIRST = section(0, ['The first chapter opens.', 'It goes on a while.']);
const SECOND = section(1, ['The second chapter is where the reading stopped.', 'Another sentence follows it.']);
const THIRD = section(2, ['A third chapter, further on.']);

let bridge: ReaderBridge;
let renderer: ReactTestRenderer | null = null;

/** The real bridge, mounted in a component that renders nothing; `bridge` is what it returned last. */
function mount() {
  let latest: ReaderBridge | null = null;
  function Probe() {
    latest = useReaderBridge({});
    return null;
  }
  act(() => {
    renderer = create(createElement(Probe));
  });
  bridge = latest!;
}

function report(blocks: ReportedBlock[]) {
  bridge.readerProps.onWebViewMessage({
    type: BLOCKS_MESSAGE,
    sectionIndex: blocks[0].sectionIndex,
    section: blocks[0].section,
    blocks,
    sizes: null,
  });
}

/** A bridge with three sections reported and segmented, as an open Reading has them. */
function opened() {
  mount();
  bridge.readerProps.onWebViewMessage({ type: DOCUMENT_MESSAGE, spine: 3, hrefs: ['s0.xhtml', 's1.xhtml', 's2.xhtml'] });
  for (const blocks of [FIRST, SECOND, THIRD]) report(blocks);
  const all = [...FIRST, ...SECOND, ...THIRD];
  const utterances = segmentDocument(all, 'en');
  bridge.setUtterances(utterances, all);
  return utterances;
}

/** The Utterance that starts in Block `id`. */
function utteranceIn(utterances: ReturnType<typeof segmentDocument>, id: string, all: ReportedBlock[]): number {
  const at = all.findIndex((block) => block.id === id);
  return utterances.findIndex((one) => one.spans[0].block === at);
}

const kinds = () => page.sent.map((message) => message.kind);

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  page.sent.length = 0;
  page.displayed.length = 0;
});

describe('a new page after the web content process ended (#120)', () => {
  it('opens at the Block of the sentence last cued, and paints it once its section reports, with the correction and the hold', () => {
    const utterances = opened();
    const at = utteranceIn(utterances, '1.0', [...FIRST, ...SECOND, ...THIRD]);
    bridge.clock.onClip({ utterance: at, words: [{ start: 0, end: 0.4, charStart: 0, charEnd: 3 }, { start: 0.4, end: 0.9, charStart: 4, charEnd: 10 }], duration: 2, rate: 1 } as never);
    bridge.clock.onPosition({ utterance: at, clipPosition: 0.6, contentPosition: 0.6, inGap: false });
    bridge.hold({ stop: true });

    expect(bridge.restart()).toBe(SECOND[0].cfi);

    page.sent.length = 0;
    bridge.readerProps.onWebViewMessage({ type: DOCUMENT_MESSAGE, spine: 3, hrefs: ['s0.xhtml', 's1.xhtml', 's2.xhtml'] });
    report(FIRST);
    expect(kinds()).not.toContain('speak');

    report(SECOND);
    const after = page.sent.filter((message) => ['speak', 'correct', 'hold'].includes(String(message.kind)));
    expect(after.map((message) => message.kind)).toEqual(['speak', 'correct', 'hold']);
    expect(after[0]).toMatchObject({ utterance: at, reveal: true });
    expect(after[1]).toMatchObject({ utterance: at, word: 1 });

    page.sent.length = 0;
    report(SECOND);
    expect(kinds()).not.toContain('speak');
  });

  it('holds back the cues and corrections of a playing Reading until the new page knows their section', () => {
    const utterances = opened();
    const all = [...FIRST, ...SECOND, ...THIRD];
    const at = utteranceIn(utterances, '1.0', all);
    bridge.clock.onClip({ utterance: at, words: null, duration: 2, rate: 1 } as never);
    expect(bridge.restart()).toBe(SECOND[0].cfi);

    page.sent.length = 0;
    const next = utteranceIn(utterances, '1.1', all);
    bridge.clock.onClip({ utterance: next, words: null, duration: 2, rate: 1 } as never);
    bridge.clock.onPosition({ utterance: next, clipPosition: 0.5, contentPosition: 0.5, inGap: false });
    expect(kinds()).toEqual([]);

    report(SECOND);
    expect(page.sent.filter((message) => message.kind === 'speak')).toEqual([expect.objectContaining({ utterance: next, reveal: true })]);
    expect(kinds()).not.toContain('hold');

    page.sent.length = 0;
    const later = utteranceIn(utterances, '2.0', all);
    bridge.clock.onClip({ utterance: later, words: null, duration: 2, rate: 1 } as never);
    expect(page.sent).toEqual([expect.objectContaining({ kind: 'speak', utterance: later })]);
  });

  it('asks the new page for the section the Reading moved into while it loaded', () => {
    const utterances = opened();
    const all = [...FIRST, ...SECOND, ...THIRD];
    bridge.clock.onClip({ utterance: utteranceIn(utterances, '1.1', all), words: null, duration: 2, rate: 1 } as never);
    expect(bridge.restart()).toBe(SECOND[1].cfi);

    const later = utteranceIn(utterances, '2.0', all);
    bridge.clock.onClip({ utterance: later, words: null, duration: 2, rate: 1 } as never);
    page.sent.length = 0;
    report(SECOND);
    expect(kinds()).not.toContain('speak');
    expect(page.displayed).toEqual([THIRD[0].cfi]);

    report(THIRD);
    expect(page.sent.filter((message) => message.kind === 'speak')).toEqual([expect.objectContaining({ utterance: later, reveal: true })]);
  });

  it('has nothing to paint and holds nothing back when no sentence had been cued', () => {
    opened();
    expect(bridge.restart()).toBeNull();
    page.sent.length = 0;
    report(SECOND);
    expect(kinds()).not.toContain('speak');
    bridge.hold();
    expect(kinds()).toContain('hold');
  });

  it('sends the decided body text size again, so the new page stops measuring', () => {
    mount();
    bridge.readerProps.onWebViewMessage({ type: DOCUMENT_MESSAGE, spine: 3, hrefs: ['s0.xhtml', 's1.xhtml', 's2.xhtml'] });
    const long = section(0, ['A long paragraph of plain body text. '.repeat(40)]);
    bridge.readerProps.onWebViewMessage({ type: BLOCKS_MESSAGE, sectionIndex: 0, section: 's0.xhtml', blocks: long, sizes: [[16, 5000]] });
    expect(kinds()).toContain('measured');

    bridge.restart();
    page.sent.length = 0;
    bridge.readerProps.onWebViewMessage({ type: DOCUMENT_MESSAGE, spine: 3, hrefs: ['s0.xhtml', 's1.xhtml', 's2.xhtml'] });
    expect(kinds()).toContain('measured');
  });
});
