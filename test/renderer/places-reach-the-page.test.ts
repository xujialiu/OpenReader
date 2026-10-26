import { createRequire } from 'node:module';
import vm from 'node:vm';
import { createElement, useContext, type Context, type FunctionComponent, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { segmentDocument } from '../../src/app/segment';
import { planAdoption } from '../../src/app/sync-items';
import { readLocator, type DocumentId, type LibraryEntry } from '../../src/core/document';
import { parsePositionsFile, usableItems } from '../../src/core/sync/positions-file';
import { BLOCKS_MESSAGE, DOCUMENT_MESSAGE, type ReportedBlock } from '../../src/renderer/messages';
import { useReaderBridge, type ReaderBridge } from '../../src/renderer/reader-bridge';

/**
 * ADR 0077: a place the app asks the page to display is displayed as given,
 * whatever characters it holds, and nothing in it runs as script.
 *
 * A place crossed into the page through two splices, and each needed its own
 * quoting. The library's `goToLocation` put it between single quotes in
 * `rendition.display('…')`, so an apostrophe ended the string: a Block whose id
 * held one came back at the start of the Document after its page was opened
 * again (#120), and text after a quote in a Positions File locator ran in the
 * page. And epub.js put each id assertion of a CFI between single quotes in an
 * XPath, so even a well-quoted `rendition.display` of such a Block threw inside
 * epub.js and left its section hidden (measured in a WKWebView,
 * notes/NOTES_2026-10-12.md). The first half is tested over the installed
 * library's real `ReaderProvider`; the second over the bundled epub.js itself.
 */

interface WebView {
  injectJavaScript(script: string): void;
}
interface LibraryContext {
  registerBook(book: WebView): void;
  goToLocation(target: string): void;
}

const require = createRequire(import.meta.url);
const library = require('@epubjs-react-native/core/lib/commonjs/context.js') as {
  ReaderProvider: FunctionComponent<{ children?: ReactNode }>;
  ReaderContext: Context<LibraryContext>;
};

vi.mock('@epubjs-react-native/core', async () => {
  const { createRequire: requireFrom } = await import('node:module');
  const hook = requireFrom(import.meta.url)('@epubjs-react-native/core/lib/commonjs/hooks/useReader.js') as { useReader: unknown };
  return { useReader: hook.useReader };
});
vi.mock('../../src/debug/debug-log', () => ({ debugLog: () => {}, cutText: (text: string) => text }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const injected: string[] = [];
let bridge: ReaderBridge;
let libraryGoToLocation: (target: string) => void;
let renderer: ReactTestRenderer | null = null;

/** The real bridge over the real `ReaderProvider`; the WebView is an object that records each script. */
function mount() {
  let latest: ReaderBridge | null = null;
  function Probe() {
    const context = useContext(library.ReaderContext);
    context.registerBook({ injectJavaScript: (script) => injected.push(script) });
    libraryGoToLocation = context.goToLocation;
    latest = useReaderBridge({});
    return null;
  }
  act(() => {
    renderer = create(createElement(library.ReaderProvider, null, createElement(Probe)));
  });
  bridge = latest!;
}

/** One injected script, run as the page would run it, against a stub `rendition.display`. */
function evaluate(script: string) {
  const displayed: unknown[] = [];
  const posted: string[] = [];
  const context = vm.createContext({
    rendition: { display: (target: unknown) => displayed.push(target) },
    window: { ReactNativeWebView: { postMessage: (message: string) => posted.push(message) } },
  });
  let error: string | null = null;
  try {
    vm.runInContext(script, context);
  } catch (thrown) {
    error = String(thrown);
  }
  return { displayed, posted, error };
}

function report(blocks: ReportedBlock[]) {
  bridge.readerProps.onWebViewMessage({ type: BLOCKS_MESSAGE, sectionIndex: blocks[0].sectionIndex, section: blocks[0].section, blocks, sizes: null });
}

/** A Reading whose sentence is in the second section, in a Block at `cfi`; then its page's process ends and a new page opens at `restart()`. */
function reopenedAt(cfi: string) {
  const first: ReportedBlock[] = [{ id: '0.0', text: 'The first chapter opens.', role: 'paragraph', section: 's0.xhtml', sectionIndex: 0, cfi: 'epubcfi(/6/2[ch1]!/4/2)' }];
  const second: ReportedBlock[] = [{ id: '1.0', text: 'Newton laws apply here.', role: 'heading', section: 's1.xhtml', sectionIndex: 1, cfi }];
  mount();
  bridge.readerProps.onWebViewMessage({ type: DOCUMENT_MESSAGE, spine: 2, hrefs: ['s0.xhtml', 's1.xhtml'] });
  report(first);
  report(second);
  const all = [...first, ...second];
  const utterances = segmentDocument(all, 'en');
  bridge.setUtterances(utterances, all);
  bridge.clock.onClip({ utterance: utterances.findIndex((one) => one.spans[0].block === 1), words: null, duration: 2, rate: 1 } as never);
  const at = bridge.restart();
  injected.length = 0;
  // reading-view.tsx hands `at` to <Reader initialLocation>, and the library's
  // View.js calls its goToLocation with it once the new page is ready.
  libraryGoToLocation(at!);
  return { at, run: evaluate(injected[0]) };
}

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  injected.length = 0;
});

describe('a place reaches rendition.display as the string it is', () => {
  it('a Block with a plain id, after its page is opened again', () => {
    const cfi = 'epubcfi(/6/4[ch2]!/4/2[Newtons_laws])';
    const result = reopenedAt(cfi);
    expect(result.at).toBe(cfi);
    expect(result.run).toEqual({ displayed: [cfi], posted: [], error: null });
  });

  it('a Block with an apostrophe in its id, after its page is opened again', () => {
    const cfi = "epubcfi(/6/4[ch2]!/4/2[Newton's_laws])";
    const result = reopenedAt(cfi);
    expect(result.at).toBe(cfi);
    expect(result.run).toEqual({ displayed: [cfi], posted: [], error: null });
  });

  it('a section index, which epub.js reads as a spine position', () => {
    mount();
    injected.length = 0;
    bridge.goToSection(3);
    expect(evaluate(injected[0])).toEqual({ displayed: ['3'], posted: [], error: null });
  });

  it('a Positions File locator with a quote and script after it runs nothing', () => {
    const id = `sha256:${'b'.repeat(64)}` as DocumentId;
    const locator = "epubcfi(/6/4!/4/2)');window.ReactNativeWebView.postMessage('x');('";
    const file = JSON.stringify({
      format: 'xujialiu-positions',
      version: 1,
      items: [{ id, format: 'epub', publicationId: null, locator, anchor: { exact: 'x', prefix: '', suffix: '' }, stamp: { at: 5, device: 'Desktop' } }],
    });
    const parsed = parsePositionsFile(file);
    if (!parsed.ok) throw new Error('the Positions File was not read');
    const entry: LibraryEntry = { id, format: 'epub', publicationId: null, publicationIdSource: 'none', title: 'A Document', position: null, stamp: { at: 1, device: 'iPhone' } };
    const adoption = planAdoption([entry], usableItems(parsed.items));
    const position = adoption.entries[0].position;
    const place = position ? readLocator(position.locator, 'epub') : null;
    // Adopted today: what keeps it harmless is the quoting, not the file's reader.
    expect(place).toBe(locator);

    mount();
    injected.length = 0;
    bridge.goTo(place!);
    expect(evaluate(injected[0])).toEqual({ displayed: [locator], posted: [], error: null });
  });
});

/** The bundled epub.js, loaded under Node: its CFI parser and XPath writer need no DOM. */
function bundledCfi(): new (cfi: string) => { path: { steps: unknown[] }; stepsToXpath(steps: unknown[]): string } {
  const source = (require('@epubjs-react-native/core/lib/commonjs/epubjs.js') as { default: string }).default;
  const module = { exports: {} as { CFI?: unknown } };
  const global: Record<string, unknown> = { module, exports: module.exports, require: () => function JSZip() {}, navigator: { userAgent: '' }, document: {}, setTimeout, clearTimeout };
  global.window = global;
  global.self = global;
  vm.runInContext(source, vm.createContext(global));
  return module.exports.CFI as never;
}

/** What an XPath 1.0 string literal, or a `concat()` of them, denotes. XPath has no escapes: a literal ends at its own quote. */
function xpathString(expression: string): string {
  const literal = /^\s*(?:'([^']*)'|"([^"]*)")\s*/;
  const one = (text: string): [string, string] => {
    const found = literal.exec(text);
    if (!found) throw new Error(`not an XPath literal: ${text}`);
    return [found[1] ?? found[2], text.slice(found[0].length)];
  };
  if (!expression.startsWith('concat(')) {
    const [value, rest] = one(expression);
    if (rest !== '') throw new Error(`text after the literal: ${rest}`);
    return value;
  }
  let rest = expression.slice('concat('.length);
  let value = '';
  for (;;) {
    const [part, after] = one(rest);
    value += part;
    if (after.startsWith(',')) rest = after.slice(1);
    else if (after === ')') return value;
    else throw new Error(`not a concat() of literals: ${expression}`);
  }
}

describe("epub.js names an element by its id in an XPath that holds the id's own text", () => {
  const CFI = bundledCfi();
  const idInXpath = (id: string) => {
    const cfi = new CFI(`epubcfi(/6/4!/4/2[${id}])`);
    const xpath = cfi.stepsToXpath(cfi.path.steps);
    const found = /^\.\/\*\/\*\[2\]\/\*\[position\(\)=1 and @id=(.*)\]$/.exec(xpath);
    if (!found) throw new Error(`unexpected XPath: ${xpath}`);
    return { xpath, denotes: xpathString(found[1]) };
  };

  it('an ordinary id is written exactly as before', () => {
    expect(idInXpath('Newtons_laws').xpath).toBe("./*/*[2]/*[position()=1 and @id='Newtons_laws']");
  });

  it.each([["Newton's_laws"], ['say"hi'], [`it's "quoted"`], [`'"'"`]])('the id %s', (id) => {
    expect(idInXpath(id).denotes).toBe(id);
  });
});
