import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { LINE_CHARS, setDebugLogWriter, type DebugCategory } from '../../src/debug/debug-log';
import { highlighterSource } from '../../src/renderer/highlighter';
import { PROBE_MESSAGE, PROBLEM_MESSAGE, RENDERER_MESSAGE } from '../../src/renderer/messages';
import {
  LOOK_GAP_MS,
  LINE_WINDOW_MS,
  LINES_PER_WINDOW,
  logFromPage,
  RENDERER_LOG_SOURCE,
  SLOW_DISPLAY_MS,
  STALL_MS,
  WATCH_MS,
} from '../../src/renderer/renderer-log';
import { pin } from '../structural';

/**
 * The `[renderer]` lines (#113): what a Debug Log copied off the phone after a
 * #112-like fault has to say on its own, with no live probe. Run as the page
 * runs them — `RENDERER_LOG_SOURCE` evaluated with `node:vm` — against stand-ins
 * for the parts of epub.js it hooks, each written from the bundled
 * `@epubjs-react-native/core` 1.4.8 `lib/commonjs/epubjs.js`: the `Queue` is
 * that file's, method for method, `Views` too, and a view's `display()` settles
 * only when the test says its iframe has loaded, as an `IframeView`'s does.
 */

interface Deferred {
  promise: Promise<unknown>;
  resolve(value?: unknown): void;
  reject(reason?: unknown): void;
}
function defer(): Deferred {
  const out = {} as Deferred;
  out.promise = new Promise((resolve, reject) => {
    out.resolve = resolve;
    out.reject = reject;
  });
  return out;
}

/** epub.js 0.3's `Queue`, as bundled: a task runs on a frame, and the next waits for the promise it returned. */
class Queue {
  _q: { task?: (...args: unknown[]) => unknown; args?: unknown[]; deferred?: Deferred; promise: Promise<unknown> }[] = [];
  running: unknown = false;
  paused = false;
  defered: Deferred | null = null;
  constructor(
    public context: unknown,
    public tick: (callback: () => void) => void,
  ) {}
  enqueue(task: unknown, ...args: unknown[]): Promise<unknown> {
    if (!task) throw new Error('No Task Provided');
    let entry;
    if (typeof task === 'function') {
      const deferred = defer();
      entry = { task: task as (...args: unknown[]) => unknown, args, deferred, promise: deferred.promise };
    } else entry = { promise: task as Promise<unknown> };
    this._q.push(entry);
    if (!this.paused && !this.running) this.run();
    return entry.promise;
  }
  dequeue(): Promise<unknown> | undefined {
    if (!this._q.length || this.paused) return Promise.resolve();
    const entry = this._q.shift()!;
    const task = entry.task;
    if (task) {
      const result = task.apply(this.context, entry.args ?? []) as Promise<unknown> | undefined;
      if (result && typeof result.then === 'function') {
        return result.then(
          (value) => entry.deferred!.resolve(value),
          (reason) => entry.deferred!.reject(reason),
        );
      }
      entry.deferred!.resolve(result);
      return entry.promise;
    }
    return entry.promise;
  }
  run(): Promise<unknown> {
    if (!this.running) {
      this.running = true;
      this.defered = defer();
    }
    this.tick.call(null, () => {
      if (this._q.length) void this.dequeue()!.then(() => this.run());
      else {
        this.defered!.resolve();
        this.running = undefined;
      }
    });
    return this.defered!.promise;
  }
}

interface Section {
  index: number;
  next(): Section | undefined;
}

/** An `IframeView`: `display()` settles when its iframe loads (`load()` here), and `destroy()` empties only a displayed view. */
class View {
  displayed = false;
  iframe: object | undefined;
  contents: { document: { defaultView: object | null } } | undefined;
  element = { offsetHeight: 0 };
  private loading: Deferred | null = null;
  constructor(public section: Section) {}
  display(): Promise<unknown> {
    if (this.displayed) return Promise.resolve(this);
    if (!this.loading) this.loading = defer();
    this.iframe = {};
    return this.loading.promise;
  }
  load(height = 1000): void {
    this.displayed = true;
    this.contents = { document: { defaultView: {} } };
    this.element.offsetHeight = height;
    this.loading?.resolve(this);
  }
  destroy(): void {
    if (!this.displayed) return;
    this.displayed = false;
    this.iframe = undefined;
    this.contents = undefined;
  }
}

/** epub.js 0.3's `Views`, as bundled. */
class Views {
  _views: View[] = [];
  length = 0;
  all() { return this._views; }
  first() { return this._views[0]; }
  last() { return this._views[this._views.length - 1]; }
  append(view: View) { this._views.push(view); this.length++; return view; }
  prepend(view: View) { this._views.unshift(view); this.length++; return view; }
  remove(view: View) {
    const at = this._views.indexOf(view);
    if (at > -1) this._views.splice(at, 1);
    this.destroy(view);
    this.length--;
  }
  destroy(view: View) { if (view.displayed) view.destroy(); }
  clear() {
    const length = this.length;
    if (!length) return;
    for (let i = 0; i < length; i++) this.destroy(this._views[i]);
    this._views = [];
    this.length = 0;
  }
}

interface Renderer {
  snapshot(why: string): void;
  traceRenderAhead(renderAhead: (section: number | null) => void): (section: number | null) => void;
  watch(): void;
}

/** The page: a spine of 253, section 33 on it, both queues idle, and a clock and timers the test moves. */
function page() {
  const lines: string[] = [];
  const frames: (() => void)[] = [];
  const timers: { at: number; run: () => void }[] = [];
  const clock = { t: Date.UTC(2026, 9, 1, 1, 34, 38) };
  let watchdog: (() => void) | null = null;
  const events = new Map<string, ((...args: unknown[]) => void)[]>();
  const tick = (callback: () => void) => { frames.push(callback); };
  const spine: Section[] = [];
  for (let index = 0; index < 253; index++) spine.push({ index, next: () => spine[index + 1] });

  const views = new Views();
  const manager = {
    q: null as unknown as Queue,
    views,
    request: () => {},
    container: { scrollTop: 9801, clientHeight: 812, scrollHeight: 10613 },
    settings: { offset: 500 },
    _bounds: { height: 812 },
    _stageSize: { width: 402, height: 812 } as { width: number; height: number } | undefined,
    scrollTop: 9801,
    append(section: Section) {
      const view = new View(section);
      this.views.append(view);
      return view;
    },
    resize(width: number, height: number) {
      const size = this._stageSize;
      if (size && size.width === width && size.height === height) return;
      this._stageSize = { width, height };
      this.views.clear();
    },
    trim() { return Promise.resolve(); },
    check() { return Promise.resolve(false); },
  };
  manager.q = new Queue(manager, tick);
  const rendition = {
    q: null as unknown as Queue,
    manager,
    location: { start: { index: 32, cfi: 'epubcfi(/6/66!/4/2/1:0)' }, end: { index: 32 } } as object | undefined,
    displays: [] as unknown[],
    on(type: string, listener: (...args: unknown[]) => void) {
      events.set(type, [...(events.get(type) ?? []), listener]);
    },
    emit(type: string, ...args: unknown[]) {
      for (const listener of events.get(type) ?? []) listener(...args);
    },
    display(target?: unknown) {
      return this.q.enqueue(this._display, target);
    },
    _display(target: unknown) {
      rendition.displays.push(target);
      return new Promise(() => {});
    },
  };
  rendition.q = new Queue(rendition, tick);
  const shown = new View(spine[33]);
  views.append(shown);
  shown.display();
  shown.load(10559);

  const document = {
    visibilityState: 'visible',
    listeners: [] as (() => void)[],
    addEventListener(type: string, listener: () => void) {
      if (type === 'visibilitychange') this.listeners.push(listener);
    },
  };
  const window = {
    setInterval(run: () => void, ms: number) {
      expect(ms).toBe(WATCH_MS);
      watchdog = run;
      return 1;
    },
    setTimeout(run: () => void, ms: number) {
      timers.push({ at: clock.t + ms, run });
      return timers.length;
    },
  };
  const context = vm.createContext({ window, document });
  const install = vm.runInContext(RENDERER_LOG_SOURCE + '\ninstallRendererLog;', context) as (env: object) => Renderer;
  const asked = new Set<number>();
  const bySection = new Map<number, string[]>();
  for (let index = 0; index <= 33; index++) bySection.set(index, []);
  const renderer = install({ rendition, asked, bySection, now: () => clock.t, post: (line: string) => lines.push(line) });

  return {
    lines,
    rendition,
    manager,
    views,
    spine,
    shown,
    asked,
    bySection,
    renderer,
    document,
    clock,
    /** Every frame asked for so far, and those they ask for, until none is left. */
    async frames() {
      for (let i = 0; i < 50 && frames.length; i++) {
        frames.splice(0).forEach((run) => run());
        await settled();
      }
    },
    /** Time passes: `ms` on the clock, one watchdog tick at the end, and every timer that fell due. */
    async pass(ms: number) {
      clock.t += ms;
      for (const timer of timers.filter((one) => one.at <= clock.t)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.run();
      }
      watchdog?.();
      await settled();
    },
    /** `seconds` watchdog ticks, one a second. */
    async ticks(seconds: number) {
      for (let i = 0; i < seconds; i++) await this.pass(WATCH_MS);
    },
    since(mark: number) {
      return lines.slice(mark);
    },
  };
}

const settled = () => new Promise((resolve) => setImmediate(resolve));

/** The program's own `renderAhead`, cut out of the program the app installs, over this page's names. */
function realRenderAhead(world: ReturnType<typeof page>, sweep = () => {}, report: (detail: string) => void = () => {}) {
  const program = highlighterSource();
  const start = program.indexOf('function renderAhead(section) {');
  let depth = 0;
  let end = program.indexOf('{', start);
  for (; end < program.length; end++) {
    if (program[end] === '{') depth++;
    else if (program[end] === '}' && --depth === 0) break;
  }
  const source = program.slice(start, end + 1);
  const make = vm.runInNewContext(`(function (rendition, bySection, asked, sweep, report) { ${source}\n return renderAhead; })`);
  return make(world.rendition, world.bySection, world.asked, sweep, report) as (section: number | null) => void;
}

describe('the program says nothing of this without Debug Mode (#113)', () => {
  it('is spliced in only when the program is built for Debug Mode', () => {
    const plain = highlighterSource(undefined, 'light', null);
    expect(highlighterSource(undefined, 'light', null, false)).toBe(plain);
    for (const absent of ['installRendererLog', RENDERER_MESSAGE, 'rlog', "message.kind === 'snapshot'"]) expect(plain).not.toContain(absent);
    const debug = highlighterSource(undefined, 'light', null, true);
    pin(debug, 'function installRendererLog(env) {', 'the Debug Mode program');
    pin(debug, 'var RENDERER = ' + JSON.stringify(RENDERER_MESSAGE) + ';', 'the Debug Mode program');
    pin(debug, '  renderAhead = rendererLog.traceRenderAhead(renderAhead);', 'the Debug Mode program');
    pin(debug, "    if (message && message.kind === 'speak') rendererLog.watch();", 'the Debug Mode program');
    // Inside the closure and before its entry point, so the binding it wraps is the one dispatch calls.
    expect(debug.indexOf('renderAhead = rendererLog')).toBeLessThan(debug.indexOf('window.__openReaderHighlighter = function'));
    expect(() => new vm.Script(debug, { filename: 'debug-highlighter.js' })).not.toThrow();
  });

  it('is built for Debug Mode by the bridge, which alone writes the lines and asks for a snapshot', () => {
    const bridge = readSource('src/renderer/reader-bridge.ts');
    pin(bridge, "options.bodyTextSize ?? null, DEBUG_MODE),", 'reader-bridge.ts, injectedJavascript');
    pin(bridge, 'if (DEBUG_MODE) logFromPage(message);', 'reader-bridge.ts, onWebViewMessage');
    pin(bridge, "if (DEBUG_MODE) send({ kind: 'snapshot', why });", 'reader-bridge.ts, snapshot');
    pin(readSource('src/app/use-reading.ts'), "bridgeRef.current?.snapshot('the reading ran out of text');", 'use-reading.ts, ranOutOfText');
  });
});

function readSource(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('the section life cycle, event by event', () => {
  it('says what was on the page when it installed', () => {
    const world = page();
    expect(world.lines).toEqual([
      'installed: views [33 displayed 10559px]; manager queue idle, 0 waiting; rendition queue idle, 0 waiting; ' +
        'scroll top 9801 + client 812 of 10613, manager top 9801 bounds 812 offset 500 (check() would append); ' +
        'asked [], reported [0–33]; location 32–32 at "epubcfi(/6/66!/4/2/1:0)"; page visible',
    ]);
  });

  it('writes a view appended, displayed, and removed', async () => {
    const world = page();
    const mark = world.lines.length;
    const view = world.manager.append(world.spine[34]);
    void view.display();
    await world.pass(312);
    view.load();
    await settled();
    world.views.remove(world.shown);
    const said = world.since(mark);
    expect(said[0]).toMatch(/^view 34 appended, views \[33, 34\] \(/);
    expect(said.slice(1)).toEqual(['view 34 displayed in 312 ms', expect.stringMatching(/^view 33 removed \(/)]);
  });

  it('writes a view removed before its display finished, and that display never finishing (#112)', async () => {
    const world = page();
    const view = world.manager.append(world.spine[34]);
    void view.display();
    await world.pass(1200);
    const mark = world.lines.length;
    world.views.remove(view);
    await world.pass(SLOW_DISPLAY_MS - 1200);
    expect(world.since(mark)).toEqual([
      expect.stringMatching(/^view 34 removed before its display finished, 1200 ms after it started \(/),
      'view 34 has not finished displaying 10 s after it started (removed from the page 1.2 s after it started)',
    ]);
  });

  it('writes a view emptied out of reach, and a clear with what each view held and who cleared it', async () => {
    const world = page();
    const view = world.manager.append(world.spine[34]);
    void view.display();
    const mark = world.lines.length;
    world.shown.destroy();
    function display() {
      world.views.clear();
    }
    display();
    expect(world.since(mark)).toEqual([
      expect.stringMatching(/^view 33 unloaded, out of reach \(/),
      expect.stringMatching(/^views cleared: \[33 not displayed 10559px, 34 displaying for 0 s\] \(display ← /),
    ]);
  });

  it('writes a stage resize that clears the views once, with both sizes, and nothing for one that changes nothing', () => {
    const world = page();
    const mark = world.lines.length;
    world.manager.resize(402, 812);
    world.manager.resize(402, 700);
    expect(world.since(mark)).toEqual(['stage resized from 402×812 to 402×700, every view cleared: [33 displayed 10559px]']);
  });

  it('writes every display asked for, its target, who asked and the rendition queue, and hands back what epub.js answered', async () => {
    const world = page();
    const mark = world.lines.length;
    function follow() {
      return world.rendition.display('epubcfi(/6/68!/4/2[chapter-34]/2/1:0)');
    }
    function onResized() {
      return world.rendition.display('about:srcdoc');
    }
    const answer = follow();
    expect(answer).toBeInstanceOf(Promise);
    onResized();
    world.rendition.display(34);
    expect(world.since(mark)).toEqual([
      expect.stringMatching(/^display "epubcfi\(\/6\/68!\/4\/2\[chapter-34\]\/2\/1:0\)" asked by follow ← .*; rendition queue idle, 0 waiting$/),
      expect.stringMatching(/^display "about:srcdoc" \(the library's answer to an iframe's about:srcdoc load\) asked by onResized ← .*; rendition queue running, 1 waiting$/),
      expect.stringMatching(/^display section 34 asked by .*; rendition queue running, 2 waiting$/),
    ]);
    await world.frames();
    expect(world.rendition.displays).toEqual(['epubcfi(/6/68!/4/2[chapter-34]/2/1:0)']);
  });

  it('writes a display finishing, and one epub.js could not make', () => {
    const world = page();
    const mark = world.lines.length;
    world.rendition.emit('displayed', world.spine[34]);
    world.rendition.emit('displayerror', new Error('No Section Found'));
    expect(world.since(mark)).toEqual(['display finished: section 34', 'display failed: "Error: No Section Found"']);
  });
});

describe('renderAhead, as the program runs it', () => {
  it('writes the section it asks for, and when it is done', async () => {
    const world = page();
    const swept = vi.fn();
    const renderAhead = world.renderer.traceRenderAhead(realRenderAhead(world, swept));
    const mark = world.lines.length;
    renderAhead(33);
    expect(world.asked.has(34)).toBe(true);
    expect(world.since(mark)).toEqual(['renderAhead: section 34 asked for, the voice is in section 33, the last view']);
    await world.frames();
    const view = world.views.last();
    expect(view.section.index).toBe(34);
    await world.pass(640);
    view.load();
    await settled();
    expect(swept).toHaveBeenCalled();
    expect(world.since(mark)).toContain('renderAhead: section 34 done in 640 ms, views [33, 34]');
  });

  it('writes why it asked for nothing, once for each section and reason rather than once per Utterance', async () => {
    const world = page();
    const renderAhead = world.renderer.traceRenderAhead(realRenderAhead(world));
    renderAhead(33);
    const mark = world.lines.length;
    for (let utterance = 0; utterance < 5; utterance++) renderAhead(33);
    renderAhead(32);
    renderAhead(null);
    expect(world.since(mark)).toEqual([
      'renderAhead: the voice is in section 33, nothing asked: section 34 was asked for already and has not reported',
      'renderAhead: the voice is in section 32, nothing asked: the last view is section 33, not the voice’s',
      "renderAhead: the voice is in section null, nothing asked: the Utterance's section is not known",
    ]);
  });

  it('writes a section it could not render', async () => {
    const world = page();
    const report = vi.fn();
    // A view whose display rejects. (A task that throws instead never settles
    // at all: epub.js's dequeue() calls it bare inside the frame callback.)
    world.manager.append = () => ({ display: () => Promise.reject(new Error('section 34 would not load')) }) as unknown as View;
    const renderAhead = world.renderer.traceRenderAhead(realRenderAhead(world, () => {}, report));
    const mark = world.lines.length;
    renderAhead(33);
    await world.pass(5);
    await world.frames();
    expect(report).toHaveBeenCalledWith('could not render the section the reading is walking into: Error: section 34 would not load');
    expect(world.since(mark)).toContain('renderAhead: section 34 failed after 5 ms: "Error: section 34 would not load"');
  });
});

describe('the stall watchdog', () => {
  /** #112's state: renderAhead's task in flight on the manager's queue, and its view removed before it displayed. */
  async function stuck() {
    const world = page();
    const renderAhead = world.renderer.traceRenderAhead(realRenderAhead(world));
    renderAhead(33);
    await world.frames();
    const lost = world.views.last();
    world.views.remove(lost);
    for (let i = 0; i < 41; i++) void world.manager.q.enqueue(world.manager.trim.bind(world.manager));
    void world.manager.q.enqueue(() => world.manager.check());
    return { world, lost };
  }

  it('writes one line with a snapshot when a queue has made no progress for STALL_MS, and one when it moves again', async () => {
    const { world, lost } = await stuck();
    const mark = world.lines.length;
    // The first tick finds the queue as it is; each after it counts a second.
    await world.ticks(STALL_MS / 1000);
    expect(world.since(mark).filter((one) => one.includes('stalled'))).toEqual([]);
    await world.ticks(1);
    await world.ticks(40);
    const stalls = world.since(mark).filter((one) => one.includes('queue stalled'));
    expect(stalls).toHaveLength(1);
    expect(stalls[0]).toMatch(/^manager queue stalled: running, and nothing started or finished for 10 s on the clock \(10 s counted\); views \[33 displayed 10559px\]; /);
    expect(stalls[0]).toContain('manager queue running, in flight renderAhead(34) for 11 s, 42 waiting: trim@stuck ×41, () => world.manager.check()@stuck;');
    expect(stalls[0]).toContain('asked [34], reported [0–33]');
    expect(stalls[0].length).toBeLessThanOrEqual(LINE_CHARS);
    // Not a line per tick: the 40 ticks after it wrote nothing more.
    expect(world.since(mark).filter((one) => !one.startsWith('view '))).toHaveLength(1);

    // It moves: the view its task displays loads after all.
    const again = world.lines.length;
    lost.load();
    await settled();
    await world.ticks(1);
    expect(world.since(again).filter((one) => one.includes('moving again'))).toEqual([
      expect.stringMatching(/^manager queue moving again after 51 s on the clock \(50 s counted\); manager queue running, \d+ waiting$/),
    ]);
  });

  it('counts a suspended WebView’s gap as LOOK_GAP_MS at most, and says how long it was on the clock', async () => {
    const { world } = await stuck();
    await world.ticks(1);
    const mark = world.lines.length;
    await world.pass(25 * 60_000);
    expect(world.since(mark).filter((one) => one.includes('stalled'))).toEqual([]);
    await world.ticks((STALL_MS - LOOK_GAP_MS) / 1000);
    const stalls = world.since(mark).filter((one) => one.includes('stalled'));
    expect(stalls).toEqual([expect.stringMatching(/for 1508 s on the clock \(10 s counted\);/)]);
  });

  it('looks again at every Clip cue, which is when iOS lets a background WebView run at all', async () => {
    const { world } = await stuck();
    const mark = world.lines.length;
    // No timer comes round: the WebView runs only as each cue arrives, 4 s apart.
    const cue = () => {
      world.clock.t += 4_000;
      world.renderer.watch();
    };
    for (let i = 0; i < 5; i++) cue();
    expect(world.since(mark).filter((one) => one.includes('stalled'))).toEqual([]);
    cue();
    expect(world.since(mark).filter((one) => one.includes('stalled'))).toEqual([expect.stringMatching(/for 20 s on the clock \(10 s counted\);/)]);
  });

  it('does not call a queue that waits for a frame of a hidden page stalled, and does when the page is shown', async () => {
    const world = page();
    world.document.visibilityState = 'hidden';
    world.document.listeners.forEach((listener) => listener());
    void world.manager.q.enqueue(world.manager.check.bind(world.manager));
    const mark = world.lines.length;
    await world.ticks(60);
    expect(world.since(mark).filter((one) => one.includes('stalled'))).toEqual([]);
    world.document.visibilityState = 'visible';
    world.document.listeners.forEach((listener) => listener());
    await world.ticks(STALL_MS / 1000);
    expect(world.since(mark)).toEqual([
      'page visible; manager queue running, 1 waiting; rendition queue idle, 0 waiting',
      expect.stringMatching(/^manager queue stalled: .* manager queue running, nothing in flight \(waiting for a frame\), 1 waiting: check@/),
    ]);
  });
});

describe('the snapshot when the reading runs out of text', () => {
  it('says what epub.js held, in one line under the Debug Log’s limit', async () => {
    const world = page();
    for (let i = 0; i < 49; i++) void world.rendition.q.enqueue(world.rendition._display, `epubcfi(/6/68!/4/2/${i}/1:0)`);
    await world.frames();
    const mark = world.lines.length;
    world.renderer.snapshot('the reading ran out of text');
    const [said] = world.since(mark);
    expect(said).toMatch(/^snapshot, the reading ran out of text: views \[33 displayed 10559px\]; manager queue idle, 0 waiting; rendition queue running, in flight _display\("epubcfi\(\/6\/68!\/4\/2\/0\/1:0\)"\)@/);
    expect(said).toContain('48 waiting: _display("epubcfi(/6/68!/4/2/1/1:0)")@');
    expect(said).toContain(', … 40 more kinds;');
    expect(said).toMatch(/; scroll top 9801 \+ client 812 of 10613, manager top 9801 bounds 812 offset 500 \(check\(\) would append\); asked \[\], reported \[0–33\]; location 32–32 at "epubcfi\(\/6\/66!\/4\/2\/1:0\)"; page visible$/);
    expect(said.length).toBeLessThanOrEqual(LINE_CHARS);
  });
});

describe('the page’s own limit on lines', () => {
  it('writes LINES_PER_WINDOW lines in LINE_WINDOW_MS, and then how many it dropped', async () => {
    const world = page();
    const mark = world.lines.length;
    for (let i = 0; i < LINES_PER_WINDOW + 50; i++) world.renderer.snapshot('again');
    expect(world.since(mark)).toHaveLength(LINES_PER_WINDOW - 1);
    await world.pass(LINE_WINDOW_MS);
    expect(world.lines.at(-1)).toBe(`51 renderer lines dropped: more than ${LINES_PER_WINDOW} in 10 s`);
  });
});

describe('what the bridge does with a line from the page', () => {
  afterEach(() => setDebugLogWriter(null));

  it('writes each probe answer as a [probe] line of its own, two that arrive together included', () => {
    const written: [DebugCategory, string][] = [];
    setDebugLogWriter({ write: (category, message) => written.push([category, message]), flush: () => {} });
    const console = vi.spyOn(globalThis.console, 'log').mockImplementation(() => {});
    logFromPage({ type: PROBE_MESSAGE, answer: '{"views":["33:d:i:L:10559::"]}' });
    logFromPage({ type: PROBE_MESSAGE, answer: 'raf fired after 4ms vis=visible qlen=43 running=true' });
    logFromPage({ type: RENDERER_MESSAGE, line: 'view 34 appended, views [33, 34] (check)' });
    expect(written).toEqual([
      ['probe', '{"views":["33:d:i:L:10559::"]}'],
      ['probe', 'raf fired after 4ms vis=visible qlen=43 running=true'],
      ['renderer', 'view 34 appended, views [33, 34] (check)'],
    ]);
    expect(console.mock.calls).toEqual([['HX PROBE {"views":["33:d:i:L:10559::"]}'], ['HX PROBE raf fired after 4ms vis=visible qlen=43 running=true']]);
    console.mockRestore();
  });

  it('is never a problem message, which is what the player shows as its note', () => {
    expect(PROBE_MESSAGE).not.toBe(PROBLEM_MESSAGE);
    expect(RENDERER_MESSAGE).not.toBe(PROBLEM_MESSAGE);
  });
});
