import { createRequire } from 'node:module';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { highlighterSource } from '../../src/renderer/highlighter';
import { pin } from '../structural';

const require = createRequire(import.meta.url);
const source = (require('@epubjs-react-native/core/lib/commonjs/epubjs.js') as { default: string }).default;

/** Real bundled manager.resize and Rendition.currentLocation/located/onResized.
 * Only the browser's stage/views and their visible-text mapping are doubled.
 * A stale last-reported location is exactly what a resize during scrolling sees. */
function page(patched: boolean) {
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
  const rendition = Object.assign(Object.create(proto), {
    location: { start: { cfi: 'earlier-passage' } }, display,
    emit: vi.fn(),
    book: {
      locations: { locationFromCfi: () => null }, pageList: { pageFromCfi: () => -1 },
      spine: { first: () => ({ index: 0 }), last: () => ({ index: 100 }) },
    },
  });
  const manager = Object.assign(Object.create(Manager.prototype), {
    _stageSize: { width: 800, height: 800 },
    stage: { size: (width = 800, height = 800) => ({ width, height }) },
    bounds: () => ({}), viewSettings: {}, updateLayout: vi.fn(),
    clear() { trace.push('clear'); visible = false; },
    currentLocation() {
      trace.push('map visible text');
      return visible ? [{ index: 3, href: 'chapter.xhtml', pages: [4], totalPages: 20, mapping: { start: fresh, end: 'end' } }] : [];
    },
    emit(event: string, size: object, target: string) {
      if (event === 'resized') rendition.onResized(size, target);
    },
  });
  rendition.manager = manager;
  if (patched) {
    const program = highlighterSource();
    const begin = program.indexOf('  function keepPlaceOnResize(manager) {');
    if (begin < 0) throw new Error('resize wrapper missing');
    const end = program.indexOf('\n  }\n', begin) + '\n  }\n'.length;
    vm.runInNewContext(`${program.slice(begin, end)}\nkeepPlaceOnResize(rendition.manager);`, {
      rendition, report: (message: string) => { throw new Error(message); },
    });
  }
  return {
    resize: (width: number, height: number, target?: string) => manager.resize(width, height, target),
    nextPassage: (cfi: string) => { fresh = cfi; visible = true; },
    loseReportedLocation: () => { rendition.location = undefined; },
    display, trace,
    location: () => rendition.location,
  };
}

describe('resize keeps the current upper passage, not the last reported one (#319)', () => {
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
    // A subsequent scroll, then a height-only resize, captures the new passage.
    p.nextPassage('epubcfi(/6/8!/4/2/18:12)');
    p.resize(500, 500);
    expect(p.display).toHaveBeenLastCalledWith('epubcfi(/6/8!/4/2/18:12)');
    expect(p.display).toHaveBeenCalledTimes(2);
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
