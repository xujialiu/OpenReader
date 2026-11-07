import { createRequire } from 'node:module';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { EPUB_GUARDS_SOURCE } from '../../src/renderer/epub-guards';
import { highlighterSource } from '../../src/renderer/highlighter';
import { pin } from '../structural';

const require = createRequire(import.meta.url);
const bundled = (require('@epubjs-react-native/core/lib/commonjs/epubjs.js') as { default: string }).default;

class Box {
  style: Record<string, string> = {};
  get clientWidth() { return Number.parseFloat(this.style.width) || 0; }
  get clientHeight() { return Number.parseFloat(this.style.height) || 0; }
  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: this.clientWidth, bottom: this.clientHeight,
      width: this.clientWidth, height: this.clientHeight };
  }
}

/** #359's two callers: reportLocation's next frame and the native resize
 * observer. Run the installed reportLocation/currentLocation/updateLayout/
 * resize/setLayout and IframeView size/lock/expand/reframe. Only DOM boxes,
 * text mapping, CSS layout arithmetic and creating a replacement view are
 * doubled. In particular, neither the getter's layout side effect nor the
 * iframe's locked width is mocked away. One view is enough to fail. */
function page(oldWidth: number, { guarded = true, count = 1 } = {}) {
  const frames: (() => void)[] = [];
  const module = { exports: {} as { Rendition: { prototype: {
    requireManager(name: string): { prototype: object };
    requireView(name: string): { prototype: object };
  } } } };
  const global: Record<string, unknown> = {
    module, exports: module.exports, require: () => function JSZip() {},
    navigator: { userAgent: '' }, document: {}, innerWidth: oldWidth, innerHeight: 669,
    setTimeout, clearTimeout,
    requestAnimationFrame: (fn: () => void) => { frames.push(fn); return frames.length; },
    getComputedStyle: () => new Proxy({}, { get: () => '0px' }),
  };
  global.window = global;
  global.self = global;
  vm.runInNewContext(bundled, global);
  const prototype = module.exports.Rendition.prototype;
  const managerPrototype = prototype.requireManager.call({}, 'continuous').prototype;
  const viewPrototype = prototype.requireView.call({}, 'iframe').prototype;
  let viewport = oldWidth;
  const layout = {
    width: oldWidth, height: 669, name: 'reflowable', props: {},
    calculate(width: number, height: number) { this.width = width; this.height = height; },
    format: vi.fn(),
  };
  const views: { iframe: Box; lockedWidth: number; settings: { width: number } }[] = [];
  const mapping = [{ index: 0, href: 'one.xhtml', pages: [1], totalPages: 1,
    mapping: { start: 'epubcfi(/6/2!/4/2:0)', end: 'epubcfi(/6/2!/4/2:9)' } }];
  const rendition = Object.assign(Object.create(prototype), {
    book: { locations: { locationFromCfi: () => null }, pageList: { pageFromCfi: () => -1 },
      spine: { first: () => ({ index: 0 }), last: () => ({ index: 1 }) } },
    getContents: () => [], emit: vi.fn(),
    // The real reportLocation still schedules its own frame. Dispatching the
    // queued task immediately isolates the native change before THAT frame.
    q: { enqueue: (fn: () => void) => fn() },
  });
  function makeView() {
    const view = Object.assign(Object.create(viewPrototype), {
      element: new Box(), iframe: new Box(), displayed: true, layout,
      settings: { width: layout.width, height: layout.height, axis: 'vertical', flow: 'scrolled' },
      contents: { textHeight: () => 600 }, marks: {}, onResize: vi.fn(), emit: vi.fn(),
    });
    view.size();
    return view;
  }
  const clear = vi.fn(() => { views.length = 0; });
  const manager = Object.assign(Object.create(managerPrototype), {
    _stageSize: { width: oldWidth, height: 669 },
    stage: { size: (width = viewport, height = 669) => ({ width, height }) },
    bounds: () => ({}), container: { getBoundingClientRect: () => ({ top: 0 }) },
    viewSettings: { width: oldWidth, height: 669 }, layout, isPaginated: false,
    settings: { axis: 'vertical', direction: 'ltr' }, views, clear,
    scrolledLocation: () => mapping,
    emit(event: string) { if (event === 'resized') for (let i = 0; i < count; i++) views.push(makeView()); },
  });
  rendition.manager = manager;
  for (let i = 0; i < count; i++) views.push(makeView());
  frames.splice(0).forEach(fn => { fn(); }); // initial iframe mark-placement frames
  const environment = vm.createContext({
    window: global, rendition, browsing: true, state: null, resizeAnchor: null, barCovered: 0,
    lookupHeld: false, lookupSelection: null, lookupResize: null,
    report: (message: string) => { throw new Error(message); },
  });
  const program = highlighterSource();
  const begin = program.indexOf('  function keepPlaceOnResize(manager) {');
  const end = program.indexOf('\n  }\n', begin) + '\n  }\n'.length;
  vm.runInContext(EPUB_GUARDS_SOURCE + '\n' + program.slice(begin, end) +
    '\nkeepPlaceOnResize(rendition.manager);\n' +
    // Before the fix, run the actual unguarded path and fail on iframe width,
    // not a missing helper. The unguarded control stays after the fix.
    (guarded ? 'if (typeof readLocationWithoutReflow === "function") readLocationWithoutReflow(rendition.manager);' : ''), environment);
  return {
    manager, rendition, clear, views, mapping,
    nativeWidth(width: number) { viewport = width; },
    scheduleLocation() { rendition.reportLocation(); },
    frame() { frames.shift()?.(); },
    finishPriorFrames() { frames.splice(0).forEach(fn => { fn(); }); },
    resize(width: number) { manager.resize(width, 669); },
    widths: () => views.map(view => view.iframe.clientWidth),
    installAgain() { vm.runInContext('readLocationWithoutReflow(rendition.manager)', environment); },
  };
}

function locationBeforeObserver(p: ReturnType<typeof page>, width: number) {
  p.finishPriorFrames(); // prior iframe mark-placement work is not this location read
  p.scheduleLocation();
  p.nativeWidth(width); // real DOM size changes before the observer runs
  p.frame(); // unrelated reportLocation reads that size first
  p.resize(width); // native resize observer must still rebuild the iframes
}

describe('reading a location cannot consume the native resize (#359)', () => {
  it.each([[951, 867], [585, 669], [800, 375]])('reflows %i to %i despite the intervening location frame', (before, after) => {
    const p = page(before);
    locationBeforeObserver(p, after);
    expect(p.manager._stageSize.width).toBe(after);
    expect(p.widths()).toEqual([after]);
    expect(p.clear).toHaveBeenCalledTimes(1);
    expect(p.rendition.location.start.cfi).toBe(p.mapping[0].mapping.start);
  });

  it('the unguarded installed getter reproduces the exact stale iframe, not a fake size failure', () => {
    const p = page(951, { guarded: false });
    locationBeforeObserver(p, 867);
    expect(p.manager._stageSize.width).toBe(867);
    expect(p.manager.layout.width).toBe(867);
    expect(p.views[0].lockedWidth).toBe(951);
    expect(p.views[0].settings.width).toBe(951);
    expect(p.widths()).toEqual([951]);
    expect(p.clear).not.toHaveBeenCalled();
  });

  it('reflows every live iframe through repeated shrink/grow transitions', () => {
    const p = page(951, { count: 3 });
    for (const width of [867, 669, 585, 669, 951, 867]) {
      locationBeforeObserver(p, width);
      expect(p.widths()).toEqual([width, width, width]);
    }
  });

  it('leaves the old cache and iframe locks intact until the real resize runs', () => {
    const p = page(951);
    p.scheduleLocation();
    p.nativeWidth(867);
    p.frame();
    expect(p.manager._stageSize.width).toBe(951);
    expect(p.manager.layout.width).toBe(951);
    expect(p.widths()).toEqual([951]);
    expect(p.rendition.location.start.cfi).toBe(p.mapping[0].mapping.start);
    p.resize(867);
    expect(p.widths()).toEqual([867]);
  });

  it('keeps location reads and unchanged-size notifications free of reflow', () => {
    const p = page(867);
    p.scheduleLocation(); p.frame(); p.resize(867);
    expect(p.clear).not.toHaveBeenCalled();
    expect(p.widths()).toEqual([867]);
  });

  it('installs once and keeps the original paginated-horizontal fallback', () => {
    const p = page(867);
    const getter = p.manager.currentLocation;
    p.installAgain();
    expect(p.manager.currentLocation).toBe(getter);
    p.manager.isPaginated = true;
    p.manager.settings.axis = 'horizontal';
    p.manager.paginatedLocation = vi.fn(() => p.mapping);
    p.nativeWidth(900);
    p.manager.currentLocation();
    expect(p.manager.paginatedLocation).toHaveBeenCalledOnce();
    expect(p.manager._stageSize.width).toBe(900);
  });

  it('installs the guard in the actual page, beside the resize/queue adapters', () => {
    pin(highlighterSource(), '  readLocationWithoutReflow(rendition.manager);', 'the installed page');
  });
});
