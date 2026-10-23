import { createRequire } from 'node:module';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { highlighterSource } from '../../src/renderer/highlighter';
import { pin } from '../structural';

const require = createRequire(import.meta.url);
const source = (require('@epubjs-react-native/core/lib/commonjs/epubjs.js') as { default: string }).default;

/** Real bundled manager.resize/currentLocation/updateLayout and Rendition's
 * location/redisplay methods. Only browser geometry/mapping and view layout
 * application are doubled. currentLocation MUST retain its layout side effect:
 * A stale last-reported location is exactly what a resize during scrolling sees. */
function page(patched: boolean, covered = 0) {
  const module = { exports: {} as { Rendition: { prototype: { requireManager(name: string): { prototype: object } } } } };
  const global: Record<string, unknown> = {
    module, exports: module.exports, require: () => function JSZip() {},
    navigator: { userAgent: '' }, document: {}, innerWidth: 800, innerHeight: 800,
    setTimeout, clearTimeout,
  };
  global.window = global;
  global.self = global;
  vm.runInNewContext(source, global);
  const proto = module.exports.Rendition.prototype;
  const Manager = proto.requireManager.call({}, 'continuous');
  let fresh = 'epubcfi(/6/8!/4/2/10:7)';
  let visible = true;
  const trace: string[] = [];
  const display = vi.fn();
  let viewport = { width: 800, height: 800 };
  const layout = { width: 800, height: 800, calculate(width: number, height: number) { this.width = width; this.height = height; } };
  const rendition = Object.assign(Object.create(proto), {
    location: { start: { cfi: 'earlier-passage' } }, display,
    getContents: () => [{ sectionIndex: 3, cfiBase: '/6/8', document: {
      defaultView: { frameElement: { getBoundingClientRect: () => ({ top: 0, bottom: 2000 }) } },
    } }],
    emit: vi.fn(),
    book: {
      locations: { locationFromCfi: () => null }, pageList: { pageFromCfi: () => -1 },
      spine: { first: () => ({ index: 0 }), last: () => ({ index: 100 }) },
    },
  });
  const manager = Object.assign(Object.create(Manager.prototype), {
    _stageSize: { width: 800, height: 800 },
    stage: { size: (width = viewport.width, height = viewport.height) => ({ width, height }) },
    bounds: () => ({}), viewSettings: {}, layout, isPaginated: false, setLayout: vi.fn(),
    container: { getBoundingClientRect: () => ({ top: 0 }) },
    mapping: { page: (_contents: unknown, _base: string, start: number) => ({
      start: start === 54 ? 'epubcfi(visible-below-header)' : fresh, end: 'end',
    }) },
    clear() { trace.push('clear'); visible = false; },
    scrolledLocation() {
      trace.push('map visible text');
      return visible ? [{ index: 3, href: 'chapter.xhtml', pages: [4], totalPages: 20, mapping: { start: fresh, end: 'end' } }] : [];
    },
    emit(event: string, size: object, target: string) {
      if (event === 'resized') rendition.onResized(size, target);
    },
  });
  rendition.manager = manager;
  const environment = vm.createContext({
    rendition, browsing: true, state: null, resizeAnchor: null, barCovered: covered,
    report: (message: string) => { throw new Error(message); },
  });
  if (patched) {
    const program = highlighterSource();
    const begin = program.indexOf('  function keepPlaceOnResize(manager) {');
    if (begin < 0) throw new Error('resize wrapper missing');
    const end = program.indexOf('\n  }\n', begin) + '\n  }\n'.length;
    vm.runInContext(`${program.slice(begin, end)}\nkeepPlaceOnResize(rendition.manager);`, environment);
  }
  return {
    resize: (width: number, height: number, target?: string) => {
      // A native window resize changes the container BEFORE the observer calls
      // manager.resize. A location getter that updates _stageSize masks it.
      viewport = { width, height };
      return manager.resize(width, height, target);
    },
    nextPassage: (cfi: string) => { fresh = cfi; visible = true; },
    userBrowses: () => { environment.resizeAnchor = null; },
    loseReportedLocation: () => { rendition.location = undefined; },
    display, trace,
    location: () => rendition.location,
  };
}

describe('resize keeps the current upper passage, not the last reported one (#319)', () => {
  it('captures text below the visible header, not the earlier text hidden behind it', () => {
    const p = page(true, 54);
    p.resize(375, 476);
    expect(p.display).toHaveBeenCalledExactlyOnceWith('epubcfi(visible-below-header)');
  });

  it('unmodified epub.js goes back to its stale reported passage', () => {
    const p = page(false);
    p.resize(500, 800);
    expect(p.trace).toEqual(['clear']);
    expect(p.display).toHaveBeenCalledExactlyOnceWith('earlier-passage');
  });

  it('captures live text before destruction and lets the normal redisplay use it once', () => {
    const p = page(true);
    p.resize(500, 800);
    expect(p.trace).toEqual(['map visible text', 'clear']);
    expect(p.display).toHaveBeenCalledExactlyOnceWith('epubcfi(/6/8!/4/2/10:7)');
    // A subsequent user scroll, then a height-only resize, captures the new passage.
    p.userBrowses();
    p.nextPassage('epubcfi(/6/8!/4/2/18:12)');
    p.resize(500, 500);
    expect(p.display).toHaveBeenLastCalledWith('epubcfi(/6/8!/4/2/18:12)');
    expect(p.display).toHaveBeenCalledTimes(2);
  });

  it('does not recapture hidden text above the restored line during a multi-step native resize', () => {
    const p = page(true);
    p.resize(800, 790); // the first native height adjustment in the drag
    p.nextPassage('earlier-text-under-the-header'); // redraw changes raw viewport start
    p.resize(375, 476); // real width adjustment arrives later, even after frames settled
    expect(p.display.mock.calls.map(([target]) => target)).toEqual([
      'epubcfi(/6/8!/4/2/10:7)', 'epubcfi(/6/8!/4/2/10:7)',
    ]);
  });

  it('retains the last captured passage when another resize lands before views return', () => {
    const p = page(true);
    p.resize(500, 800);
    p.resize(450, 700);
    expect(p.display.mock.calls.map(([target]) => target)).toEqual([
      'epubcfi(/6/8!/4/2/10:7)', 'epubcfi(/6/8!/4/2/10:7)',
    ]);
  });

  it('recovers a displayed passage even before the first reportLocation', () => {
    const p = page(true);
    p.loseReportedLocation();
    p.resize(500, 800);
    expect(p.display).toHaveBeenCalledExactlyOnceWith('epubcfi(/6/8!/4/2/10:7)');
  });

  it('does not replace an explicit target, or redisplay an unchanged size', () => {
    const p = page(true);
    p.resize(800, 800);
    expect(p.display).not.toHaveBeenCalled();
    p.resize(500, 800, 'explicit-target');
    expect(p.display).toHaveBeenCalledExactlyOnceWith('explicit-target');
  });

  it('installs the capture without writing a Reading Position or sending a speech command', () => {
    const program = highlighterSource();
    pin(program, 'keepPlaceOnResize(rendition.manager);', 'highlighter resize install');
    const begin = program.indexOf('  function keepPlaceOnResize(manager) {');
    const body = program.slice(begin, program.indexOf('\n  }\n', begin));
    expect(body).not.toMatch(/post\(|dispatch\(|setBrowsing\(/);
  });
});
