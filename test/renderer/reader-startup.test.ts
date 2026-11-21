import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { DOMParser } from '@xmldom/xmldom';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { contentsOf, type NavigationEntry } from '../../src/core/document/contents';

const require = createRequire(import.meta.url);
const LIB = dirname(require.resolve('@epubjs-react-native/core/package.json'));
const BUILDS = ['commonjs', 'module'] as const;
type Build = (typeof BUILDS)[number];
type Posted = { type: string; reason?: string; toc?: NavigationEntry[] };
type Listener = (error?: unknown) => void;

/** Both shipped template formats, evaluated without editing their program. */
function literal(build: Build, name: string): string {
  if (build === 'commonjs') return require(join(LIB, 'lib', build, name)).default;
  const source = readFileSync(join(LIB, 'lib', build, name), 'utf8');
  const from = source.indexOf('export default `') + 'export default `'.length;
  return vm.runInNewContext('`' + source.slice(from, source.lastIndexOf('`')) + '`', {
    webViewJavaScriptFunctions: require(join(LIB, 'lib/commonjs/utils/webViewInjectFunctions.js')),
  });
}
const CONTAINER = '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
const opf = (spine: string) => `<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title><dc:identifier id="id">x</dc:identifier><dc:language>en</dc:language></metadata><manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine>${spine}</spine></package>`;
const CHAPTER = '<html xmlns="http://www.w3.org/1999/xhtml"><head/><body><p>Hello.</p></body></html>';
const archive = (members: Record<string, string>) => Buffer.from(zipSync(Object.fromEntries(Object.entries({ mimetype: 'application/epub+zip', ...members }).map(([name, text]) => [name, strToU8(text)])))).toString('base64');
const DOCUMENTS = {
  valid: archive({ 'META-INF/container.xml': CONTAINER, 'OEBPS/content.opf': opf('<itemref idref="c1"/>'), 'OEBPS/ch1.xhtml': CHAPTER }),
  'missing container': archive({ 'OEBPS/ch1.xhtml': CHAPTER }),
  'missing package': archive({ 'META-INF/container.xml': CONTAINER }),
  'empty spine': archive({ 'META-INF/container.xml': CONTAINER, 'OEBPS/content.opf': opf(''), 'OEBPS/ch1.xhtml': CHAPTER }),
  'missing chapter': archive({ 'META-INF/container.xml': CONTAINER, 'OEBPS/content.opf': opf('<itemref idref="c1"/>') }),
};

function signals() {
  const listeners = new Map<string, Listener[]>();
  return {
    on(name: string, listener: Listener) { listeners.set(name, [...listeners.get(name) ?? [], listener]); },
    emit(name: string, value?: unknown) { for (const listener of listeners.get(name) ?? []) listener(value); },
  };
}
const LOCATION = { start: { cfi: 'epubcfi(/6/2!/4/2)', href: 'OEBPS/ch1.xhtml' } };
const immediate = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Real archive/container/package parsing and section loads; no WebKit layout.
 * The rendition preserves epub.js's three initial display outcomes: success,
 * rejection for no section, and displayerror with a pending display promise.
 * The bug is in the installed template consuming those outcomes, not layout. */
async function open(build: Build, file: string) {
  const window: Record<string, unknown> = {};
  const context = vm.createContext({
    window, self: window, navigator: { userAgent: 'node' }, console,
    document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), documentElement: { style: {} }, addEventListener() {} },
    setTimeout, clearTimeout, setImmediate, Promise, Uint8Array, ArrayBuffer, Blob, URL, atob, btoa, TextDecoder, TextEncoder,
    XMLHttpRequest: function XMLHttpRequest() {}, DOMParser, requestAnimationFrame: (run: () => void) => setTimeout(run, 0),
  });
  Object.assign(window, {
    navigator: context.navigator, document: context.document, URL, Blob, setTimeout, clearTimeout,
    requestAnimationFrame: context.requestAnimationFrame, addEventListener() {}, removeEventListener() {},
    decodeURIComponent, encodeURIComponent, decodeURI, encodeURI, atob, btoa, DOMParser,
    location: { href: 'file:///index.html', origin: 'file://' },
  });
  vm.runInContext(literal(build, 'jszip.js'), context);
  window.JSZip ??= context.JSZip;
  vm.runInContext(literal(build, 'epubjs.js'), context);
  const make = window.ePub as (file: string, options: unknown) => {
    on(name: string, listener: Listener): void;
    renderTo: () => unknown;
    load: (url: string) => Promise<unknown>;
    spine: { get(): { load(request: unknown): Promise<unknown> } | undefined };
  };
  let finished!: () => void;
  const done = new Promise<void>((resolve) => { finished = resolve; });
  const posted: Posted[] = [];
  const failures: string[] = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (error: unknown) => { unhandled.push(error); finished(); };
  process.on('unhandledRejection', onUnhandled);
  const ePub = Object.assign((input: string, options: unknown) => {
    const book = make(input, options);
    book.on('openFailed', () => { failures.push('openFailed'); finished(); });
    const events = signals();
    book.renderTo = () => ({
      ...events,
      themes: { default() {}, register() {}, select() {} },
      currentLocation: () => LOCATION,
      display() {
        const section = book.spine.get();
        if (!section) {
          failures.push('No Section Found');
          return Promise.reject(new Error('No Section Found'));
        }
        return new Promise<void>((resolve) => {
          section.load(book.load.bind(book)).then(() => resolve(), (error) => {
            failures.push('displayerror');
            events.emit('displayerror', error);
            finished();
            // epub.js emits the failure and leaves display() pending.
          });
        });
      },
    });
    return book;
  }, { CFI: function CFI() {} });
  const template = literal(build, 'template.js');
  const script = template.slice(template.indexOf('<div id="viewer">')).match(/<script[^>]*>([\s\S]*?)<\/script>/)![1];
  Object.assign(window, {
    type: 'base64', book: file, theme: {}, locations: [], enable_selection: true,
    ReactNativeWebView: { postMessage(message: string) {
      const event = JSON.parse(message) as Posted;
      posted.push(event);
      if (event.type === 'onReady' || event.type === 'onDisplayError') finished();
    } },
  });
  try {
    vm.runInNewContext(script, {
      window, ePub, document: { addEventListener() {}, getElementById: () => ({}) }, alert() {}, console,
      FileReader: function FileReader() {}, fetch: async () => { throw new Error('no cover'); },
      Promise, setTimeout, clearTimeout, allowPopups: false, allowScriptedContent: true,
    });
    await done;
    await immediate();
    return { posted, failures, unhandled };
  } finally { process.off('unhandledRejection', onUnhandled); }
}

for (const build of BUILDS) describe(`the installed ${build} Reader startup (#217)`, () => {
  it.each(['', '<item id="gap" media-type="application/xhtml+xml"/>'])('can start Download preparation when the first spine slot has no file (#234): %j', async (manifestItem) => {
    const pack = opf('<itemref idref="gap"/><itemref idref="c1"/>').replace('</manifest>', manifestItem + '</manifest>');
    const result = await open(build, archive({
      'META-INF/container.xml': CONTAINER, 'OEBPS/content.opf': pack, 'OEBPS/ch1.xhtml': CHAPTER,
    }));
    expect(result.failures).toEqual([]);
    expect(result.posted.find(event => event.type === 'onDisplayError')?.reason).toBeUndefined();
    expect(result.posted.some(event => event.type === 'onReady')).toBe(true);
  });
  it('keeps chapters under the correct NCX parent when IDs repeat (#200)', async () => {
    const point = (id: string, name: string, children = '') =>
      `<navPoint id="${id}"><navLabel><text>${name}</text></navLabel><content src="ch1.xhtml#${name}"/>${children}</navPoint>`;
    const ncx = '<ncx><navMap>' +
      point('same', 'Part', point('same', 'First') + point('other', 'Second')) +
      point('same', 'NextPart', point('same', 'Third')) + '</navMap></ncx>';
    const pack = opf('<itemref idref="c1"/>')
      .replace('</manifest>', '<item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>')
      .replace('<spine>', '<spine toc="toc">');
    const result = await open(build, archive({
      'META-INF/container.xml': CONTAINER, 'OEBPS/content.opf': pack,
      'OEBPS/toc.ncx': ncx, 'OEBPS/ch1.xhtml': CHAPTER,
    }));
    const toc = result.posted.find(event => event.type === 'onNavigationLoaded')?.toc;
    expect(toc).toBeDefined();
    expect(contentsOf(toc!, ['ch1.xhtml']).rows.map(row => [row.label, row.depth, row.target, row.fragment])).toEqual([
      ['Part', 0, 0, 'Part'], ['First', 1, 0, 'First'], ['Second', 1, 0, 'Second'],
      ['NextPart', 0, 0, 'NextPart'], ['Third', 1, 0, 'Third'],
    ]);
  });
  it('control: opens a valid archive and reaches ready', async () => {
    const result = await open(build, DOCUMENTS.valid);
    expect(result.posted.filter((event) => event.type === 'onReady')).toHaveLength(1);
    expect(result.posted.some((event) => event.type === 'onDisplayError')).toBe(false);
    expect(result.failures).toEqual([]);
    expect(result.unhandled).toEqual([]);
  });
  for (const [name, file] of Object.entries(DOCUMENTS).filter(([name]) => name !== 'valid')) {
    it(`reports ${name} once instead of waiting forever`, async () => {
      const result = await open(build, file);
      expect(result.failures).not.toEqual([]);
      const errors = result.posted.filter((event) => event.type === 'onDisplayError');
      expect(errors).toHaveLength(1);
      expect(errors[0].reason).toBeTruthy();
      expect(errors[0].reason).not.toContain(file);
      const detail = { 'missing container': 'container.xml', 'missing package': 'content.opf', 'empty spine': 'No Section Found', 'missing chapter': 'ch1.xhtml' }[name];
      expect(errors[0].reason).toContain(detail);
      expect(result.posted.some((event) => event.type === 'onReady')).toBe(false);
      expect(result.unhandled).toEqual([]);
    });
  }
});

type Outcome = 'ready rejects' | 'display throws' | 'event and rejection' | 'event then success' | 'error after ready';
async function controlled(build: Build, outcome: Outcome) {
  const events = signals();
  const file = 'fixture-document-payload';
  const error = new Error(`Failure for ${file}: ${'x'.repeat(700)}`);
  const posted: Posted[] = [];
  const rendition = {
    ...events, themes: { default() {}, register() {}, select() {} }, currentLocation: () => LOCATION,
    display() {
      if (outcome === 'display throws') throw error;
      if (outcome === 'event and rejection' || outcome === 'event then success') events.emit('displayerror', error);
      return outcome === 'event and rejection' ? Promise.reject(error) : Promise.resolve();
    },
  };
  const book = {
    ...signals(), ready: outcome === 'ready rejects' ? Promise.reject(error) : Promise.resolve(),
    locations: { load() {}, total: 0, percentageFromCfi: () => 0 },
    renderTo: () => rendition, coverUrl: async () => { throw new Error('no cover'); },
    package: { metadata: {} }, loaded: { navigation: Promise.resolve({ toc: [], landmarks: [] }) },
  };
  const template = literal(build, 'template.js');
  const script = template.slice(template.indexOf('<div id="viewer">')).match(/<script[^>]*>([\s\S]*?)<\/script>/)![1];
  vm.runInNewContext(script, {
    window: { type: 'base64', book: file, theme: {}, locations: [], enable_selection: true, addEventListener() {},
      ReactNativeWebView: { postMessage(message: string) { posted.push(JSON.parse(message) as Posted); } } },
    ePub: Object.assign(() => book, { CFI: function CFI() {} }),
    document: { addEventListener() {} }, alert() {}, FileReader: function FileReader() {},
    Promise, allowPopups: false, allowScriptedContent: true,
  });
  await immediate();
  if (outcome === 'error after ready') {
    events.emit('displayerror', error);
    await immediate();
  }
  return { posted, file };
}

for (const build of BUILDS) describe(`${build} startup has one terminal result`, () => {
  for (const outcome of ['ready rejects', 'display throws', 'event and rejection', 'event then success'] as const) {
    it(`reports ${outcome} once and never reports ready afterward`, async () => {
      const { posted, file } = await controlled(build, outcome);
      const errors = posted.filter((event) => event.type === 'onDisplayError');
      expect(errors).toHaveLength(1);
      expect(errors[0].reason).not.toContain(file);
      expect(errors[0].reason!.length).toBeLessThanOrEqual(500);
      expect(posted.some((event) => event.type === 'onReady')).toBe(false);
    });
  }
  it('does not turn later rendition errors into a startup failure after ready', async () => {
    const { posted } = await controlled(build, 'error after ready');
    expect(posted.filter((event) => event.type === 'onReady')).toHaveLength(1);
    expect(posted.some((event) => event.type === 'onDisplayError')).toBe(false);
  });
});
