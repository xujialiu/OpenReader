import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

import { EPUB_GUARDS_SOURCE, FRAMELESS_MS, REMOVED_BEFORE_DISPLAYED } from '../../src/renderer/epub-guards';
import { highlighterSource } from '../../src/renderer/highlighter';
import { pin } from '../structural';

/**
 * #112: a reading that crossed into a section with the app away from the screen
 * waited for the next section for good. The simulator reproduced it (the issue's
 * comments): away from the screen epub.js's queues wait for frames that never
 * come; back on the screen, the rendition's queued `display()` cleared the
 * manager's views while the manager's queue was displaying the next section, and
 * a view removed before its iframe loads never settles its display, so the
 * queue waited on it for ever.
 *
 * The stand-ins are epub.js 0.3 as `@epubjs-react-native/core` 1.4.8 bundles it
 * (`lib/commonjs/epubjs.js`): the `Queue` method for method, `Views`' `append`,
 * `remove`, `destroy` and `clear`, and an `IframeView` whose `display()` settles
 * only when its iframe loads (`load()` here), and whose `destroy()` does nothing
 * to a view that is still displaying — the view's iframe is gone with its element,
 * so it never loads.
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

class Queue {
  _q: { task?: (...args: unknown[]) => unknown; args: unknown[]; deferred?: Deferred; promise: Promise<unknown> }[] = [];
  running: unknown = false;
  paused = false;
  defered: Deferred | null = null;
  constructor(
    public context: unknown,
    public tick: (callback: () => void) => void,
  ) {}
  enqueue(task: (...args: unknown[]) => unknown, ...args: unknown[]): Promise<unknown> {
    const deferred = defer();
    const entry = { task, args, deferred, promise: deferred.promise };
    this._q.push(entry);
    if (!this.paused && !this.running) void this.run();
    return entry.promise;
  }
  dequeue(): Promise<unknown> {
    if (!this._q.length || this.paused) return Promise.resolve();
    const entry = this._q.shift()!;
    const result = entry.task!.apply(this.context, entry.args) as Promise<unknown> | undefined;
    if (result && typeof result.then === 'function') {
      return result.then(
        (value) => entry.deferred!.resolve(value),
        (reason) => entry.deferred!.reject(reason),
      );
    }
    entry.deferred!.resolve(result);
    return entry.promise;
  }
  run(): Promise<unknown> {
    if (!this.running) {
      this.running = true;
      this.defered = defer();
    }
    this.tick.call(null, () => {
      if (this._q.length) void this.dequeue().then(() => this.run());
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

/** A fresh `IframeView` class per page, because the guard adapts its prototype. */
function viewClass() {
  return class View {
    displayed = false;
    private loading: Deferred | null = null;
    constructor(public section: Section) {}
    display(): Promise<unknown> {
      if (this.displayed) return Promise.resolve(this);
      if (!this.loading) this.loading = defer();
      return this.loading.promise;
    }
    /** The iframe loaded: what the real view does when its `onload` fires. */
    load(): void {
      this.displayed = true;
      this.loading?.resolve(this);
    }
    destroy(): void {
      if (!this.displayed) return;
      this.displayed = false;
    }
  };
}
type View = InstanceType<ReturnType<typeof viewClass>>;

class Views {
  _views: View[] = [];
  length = 0;
  last() { return this._views[this._views.length - 1]; }
  append(view: View) { this._views.push(view); this.length++; return view; }
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

/** A page with section 33 displayed, frames and timers the test hands out, and the guards installed on its manager and queues. */
function page({ guarded = true } = {}) {
  const frames: (() => void)[] = [];
  const timers: { at: number; run: () => void }[] = [];
  const clock = { t: 0 };
  const window = {
    requestAnimationFrame(run: () => void) { frames.push(run); return frames.length; },
    setTimeout(run: () => void, ms: number) { timers.push({ at: clock.t + ms, run }); return timers.length; },
  };
  const spine: Section[] = [];
  for (let index = 0; index < 253; index++) spine.push({ index, next: () => spine[index + 1] });
  const View = viewClass();
  const views = new Views();
  const manager = {
    View,
    views,
    q: null as unknown as Queue,
    request: () => {},
    append(section: Section) {
      const view = new this.View(section);
      this.views.append(view);
      return view;
    },
  };
  // epub.js's own tick: a frame.
  manager.q = new Queue(manager, (run) => window.requestAnimationFrame(run));
  const rendition = { manager, q: new Queue({}, (run) => window.requestAnimationFrame(run)) };
  const shown = manager.append(spine[33]);
  void shown.display();
  shown.load();

  if (guarded) {
    const context = vm.createContext({ window });
    const guards = vm.runInContext(EPUB_GUARDS_SOURCE + '\n({ settleRemovedViews: settleRemovedViews, tickWithoutFrames: tickWithoutFrames });', context) as {
      settleRemovedViews(manager: object): void;
      tickWithoutFrames(queue: object): void;
    };
    guards.settleRemovedViews(manager);
    guards.tickWithoutFrames(manager.q);
    guards.tickWithoutFrames(rendition.q);
  }
  return {
    manager,
    rendition,
    views,
    spine,
    /** Every frame asked for, and those they ask for in turn. */
    async frames() {
      await settled();
      for (let i = 0; i < 50 && frames.length; i++) {
        frames.splice(0).forEach((run) => run());
        await settled();
      }
    },
    /** `ms` pass with no frame drawn, as away from the screen. */
    async noFrames(ms: number) {
      for (let passed = 0; passed < ms; passed += 10) {
        clock.t += 10;
        for (const timer of timers.filter((one) => one.at <= clock.t)) {
          timers.splice(timers.indexOf(timer), 1);
          timer.run();
        }
        await settled();
      }
    },
  };
}

const settled = () => new Promise((resolve) => setImmediate(resolve));

/** The program's own `renderAhead`, cut out of the program the app installs. */
function realRenderAhead(rendition: object, bySection: Map<number, unknown>, asked: Set<number>, sweep: () => void, report: (detail: string) => void) {
  const program = highlighterSource();
  const start = program.indexOf('function renderAhead(section) {');
  let depth = 0;
  let end = program.indexOf('{', start);
  for (; end < program.length; end++) {
    if (program[end] === '{') depth++;
    else if (program[end] === '}' && --depth === 0) break;
  }
  const make = vm.runInNewContext(`(function (rendition, bySection, asked, sweep, report) { ${program.slice(start, end + 1)}\n return renderAhead; })`);
  return make(rendition, bySection, asked, sweep, report) as (section: number | null) => void;
}

describe('a view taken off the page before its display finished (#112)', () => {
  it('ends the queue task that was displaying it, so the next task runs', async () => {
    const world = page();
    const ended = vi.fn();
    const next = vi.fn();
    void world.manager.q.enqueue(() => world.manager.append(world.spine[34]).display()).then(
      () => ended('displayed'),
      (error: Error) => ended(error.message),
    );
    void world.manager.q.enqueue(next);
    await world.frames();
    expect(world.views.last().section.index).toBe(34);

    // What manager.display()'s clear() did at 02:55:43.443: every view, the displaying one too.
    world.views.clear();
    await world.frames();

    expect(ended).toHaveBeenCalledWith(REMOVED_BEFORE_DISPLAYED);
    expect(next).toHaveBeenCalledTimes(1);
    expect(world.manager.q.running).toBeUndefined();
  });

  it('waits for ever without the guard: the stand-in is the defect', async () => {
    const world = page({ guarded: false });
    const next = vi.fn();
    void world.manager.q.enqueue(() => world.manager.append(world.spine[34]).display());
    void world.manager.q.enqueue(next);
    await world.frames();
    world.views.clear();
    await world.frames();
    expect(next).not.toHaveBeenCalled();
    expect(world.manager.q.running).toBe(true);
  });

  it('leaves a display that finishes, and the removal of a displayed view, as they were', async () => {
    const world = page();
    const view = world.manager.append(world.spine[34]);
    const shown = view.display();
    view.load();
    await expect(shown).resolves.toBe(view);
    world.views.remove(view);
    expect(view.displayed).toBe(false);
    await expect(world.views.last().display()).resolves.toBe(world.views.last());
  });

  it("makes renderAhead forget the section and ask again at the next cue, and says nothing to the owner", async () => {
    const world = page();
    const asked = new Set<number>();
    const bySection = new Map<number, unknown>([[33, []]]);
    const report = vi.fn();
    const renderAhead = realRenderAhead(world.rendition, bySection, asked, () => {}, report);

    renderAhead(33);
    expect(asked.has(34)).toBe(true);
    await world.frames();
    world.views.clear();
    await world.frames();
    expect(asked.has(34)).toBe(false);
    expect(report).not.toHaveBeenCalled();

    // manager.display() put section 33 back; the next cue asks for 34 again, and this time it arrives.
    const again = world.manager.append(world.spine[33]);
    void again.display();
    again.load();
    renderAhead(33);
    expect(asked.has(34)).toBe(true);
    await world.frames();
    expect(world.views.last().section.index).toBe(34);
  });
});

describe("epub.js's queues away from the screen (#112)", () => {
  it('run their tasks when no frame comes', async () => {
    const world = page();
    const task = vi.fn();
    void world.manager.q.enqueue(task);
    void world.rendition.q.enqueue(task);
    await world.noFrames(FRAMELESS_MS * 2);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('wait for ever without the guard', async () => {
    const world = page({ guarded: false });
    const task = vi.fn();
    void world.manager.q.enqueue(task);
    await world.noFrames(FRAMELESS_MS * 20);
    expect(task).not.toHaveBeenCalled();
  });

  it('run a task once when both its frame and the timer come', async () => {
    const world = page();
    const task = vi.fn();
    void world.manager.q.enqueue(task);
    await world.frames();
    await world.noFrames(FRAMELESS_MS * 2);
    expect(task).toHaveBeenCalledTimes(1);
  });
});

describe('the program installs both guards (#112)', () => {
  it('on the manager, its queue and the rendition’s queue, beside holdStill', () => {
    const program = highlighterSource();
    pin(program, 'function settleRemovedViews(manager) {', 'the program');
    pin(program, 'function tickWithoutFrames(queue) {', 'the program');
    pin(program, '  settleRemovedViews(rendition.manager);\n  tickWithoutFrames(rendition.manager && rendition.manager.q);\n  tickWithoutFrames(rendition.q);', 'the program, at install');
    expect(() => new vm.Script(program, { filename: 'highlighter.js' })).not.toThrow();
  });
});
