import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BLOCKS_MESSAGE,
  DOCUMENT_MESSAGE,
  FOLLOWING_STATE_MESSAGE,
  PROBLEM_MESSAGE,
  SELECTION_MESSAGE,
  TAP_MESSAGE,
} from '../../src/renderer/messages';
import { useReaderBridge, type ReaderBridge, type ReaderBridgeOptions } from '../../src/renderer/reader-bridge';

/**
 * A message from the page is taken only with every field its type carries (ADR
 * 0077). The real bridge, with the library's `useReader` faked as in
 * `reader-bridge-restart.test.ts`, and each message parsed from JSON the way the
 * library's `View.js` parses it before handing it over.
 *
 * Found in the bug hunt of 2026-10-11: the bridge went by `type` alone, so a
 * Blocks message without `blocks` threw out of `onWebViewMessage` and a problem
 * without a `detail` still became the Player's note.
 */

vi.mock('@epubjs-react-native/core', () => ({
  useReader: () => ({ injectJavascript() {}, goToLocation() {}, theme: null, changeTheme() {} }),
}));
vi.mock('../../src/debug/debug-log', () => ({ debugLog: () => {}, cutText: (text: string) => text }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let renderer: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});

const callbacks = () => ({ onBlocks: vi.fn(), onDocument: vi.fn(), onProblem: vi.fn(), onFollowing: vi.fn(), onTap: vi.fn() });

function mount(options: ReaderBridgeOptions) {
  let latest: ReaderBridge | null = null;
  function Probe() {
    latest = useReaderBridge(options);
    return null;
  }
  act(() => {
    renderer = create(createElement(Probe));
  });
  return latest! as ReaderBridge;
}

function arrive(bridge: ReaderBridge, message: unknown) {
  bridge.readerProps.onWebViewMessage(JSON.parse(JSON.stringify(message)));
}

const BLOCK = { id: '0.0', text: 'Chapter One.', role: 'heading', section: 'a.xhtml', sectionIndex: 0, cfi: 'epubcfi(/6/2!/4/2)' };

describe('a message with a known type is taken only whole', () => {
  it('takes each well-formed message', () => {
    const seen = callbacks();
    const bridge = mount(seen);
    arrive(bridge, { type: DOCUMENT_MESSAGE, spine: 1, hrefs: ['a.xhtml'] });
    arrive(bridge, { type: BLOCKS_MESSAGE, sectionIndex: 0, section: 'a.xhtml', blocks: [], sizes: null });
    arrive(bridge, { type: BLOCKS_MESSAGE, sectionIndex: 0, section: 'a.xhtml', blocks: [BLOCK], sizes: [[16, 120]] });
    arrive(bridge, { type: PROBLEM_MESSAGE, utterance: -1, detail: 'a Range moved' });
    arrive(bridge, { type: FOLLOWING_STATE_MESSAGE, following: false });
    expect(seen.onDocument).toHaveBeenCalledTimes(1);
    expect(seen.onBlocks).toHaveBeenCalledTimes(2);
    expect(seen.onProblem).toHaveBeenCalledWith(expect.objectContaining({ detail: 'a Range moved' }));
    // The document message's own `onFollowing(true)`, then this one.
    expect(seen.onFollowing).toHaveBeenLastCalledWith(false);
  });

  it.each([
    ['a Blocks message with no blocks', { type: BLOCKS_MESSAGE, sectionIndex: 0 }],
    ['a Blocks message whose blocks are not Blocks', { type: BLOCKS_MESSAGE, sectionIndex: 0, section: 'a.xhtml', blocks: [{ text: 'x' }], sizes: null }],
    ['a Blocks message with no section index', { type: BLOCKS_MESSAGE, section: 'a.xhtml', blocks: [BLOCK], sizes: null }],
    ['a Blocks message with sizes that are not sizes', { type: BLOCKS_MESSAGE, sectionIndex: 0, section: 'a.xhtml', blocks: [BLOCK], sizes: 'many' }],
    ['a document message with no hrefs', { type: DOCUMENT_MESSAGE, spine: 1 }],
    ['a problem with no detail', { type: PROBLEM_MESSAGE }],
    ['a following state that is not a boolean', { type: FOLLOWING_STATE_MESSAGE, following: 'yes' }],
    ['a tap with no offset', { type: TAP_MESSAGE, block: '0.0' }],
  ])('drops %s, and throws nothing', (_, message) => {
    const seen = callbacks();
    const bridge = mount(seen);
    expect(() => arrive(bridge, message)).not.toThrow();
    for (const callback of Object.values(seen)) expect(callback).not.toHaveBeenCalled();
  });

  it('drops a selection with no text while Look Up is on', () => {
    const bridge = mount({});
    const selected = vi.fn();
    bridge.setLookupEnabled(true);
    bridge.onSelection(selected);
    arrive(bridge, { type: SELECTION_MESSAGE, expanded: true, selecting: false });
    expect(selected).not.toHaveBeenCalled();
    arrive(bridge, { type: SELECTION_MESSAGE, text: 'word', expanded: true, selecting: false });
    expect(selected).toHaveBeenCalledWith(expect.objectContaining({ text: 'word' }));
  });
});
