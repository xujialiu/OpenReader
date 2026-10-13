import vm from 'node:vm';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, type AppSettings } from '../../../src/app/settings';
import { useReading, type Reading } from '../../../src/app/use-reading';

/**
 * A Contents row pressed while the Reading plays (Browsing, #107), and the
 * voice left to read on with the page still there.
 *
 * Real: `useReading`, `useReaderBridge`, `createPlaybackEngine`, the segmenter,
 * and the whole program `highlighterSource()` installs in the page, evaluated
 * in `node:vm` the way the library evaluates it (`injectJavascript` and
 * `goToLocation` are both strings run in the page).
 *
 * Stand-ins:
 * - epub.js 0.3 as `@epubjs-react-native/core` 1.4.8 bundles it
 *   (`lib/commonjs/epubjs.js`): a rendition and a continuous manager with a view
 *   list, both queues and the content hook. `display()` keeps the views when
 *   the section is on the page; otherwise it clears them and lays the section
 *   out with the one before it and the one after it (`display` 2536-2586,
 *   `find` 2361-2365, `clear` 2817-2820, continuous `display`/`fill` 6408-6425,
 *   `check` 6541-6590).
 * - a section document: two paragraphs and no layout, so the program measures
 *   nothing in it and the page never scrolls by itself.
 * - the native audio graph: a queue whose front buffer ends when the test says
 *   a sentence has been heard.
 * - the Provider: answers every sentence with silence.
 */

const world = vi.hoisted(() => ({
  toPage: null as null | ((code: string) => void),
  graph: {
    handlers: null as null | { onBufferEnded(id: string): void },
    queue: [] as string[],
    serial: 0,
    clears: 0,
  },
}));

vi.mock('react-native', () => ({ useColorScheme: () => 'light' }));
vi.mock('@epubjs-react-native/core', () => {
  // The library's context.js, 395-396 and 691-692: each is a string evaluated in the page.
  const reader = {
    injectJavascript: (code: string) => world.toPage?.(code),
    goToLocation: (target: string) => world.toPage?.(`rendition.display('${target}'); true`),
    theme: null,
    changeTheme() {},
  };
  return { useReader: () => reader };
});
vi.mock('../../../src/playback/audio-graph', () => ({
  createAudioGraph: async (_first: unknown, handlers: { onBufferEnded(id: string): void }) => {
    world.graph.handlers = handlers;
    return {
      sampleRate: 24000,
      prepare: async (clip: unknown) => ({ clip, samples: new Float32Array(2400), duration: 0.1 }),
      enqueue: (audio: { duration: number }, gap: number, from = 0, to = audio.duration) => {
        const id = `b${world.graph.serial++}`;
        world.graph.queue.push(id);
        return [{ bufferId: id, speech: to - from, gap, offset: from, duration: audio.duration }];
      },
      remove() {},
      setRate() {},
      resume() {},
      pause() {},
      clear() { world.graph.queue.length = 0; world.graph.clears++; },
      dispose: async () => {},
    };
  },
}));
vi.mock('../../../src/offline/runtime', () => ({
  hasSavedVoice: () => false,
  inventoryReady: () => true,
  offlineProvider: () => ({
    id: 'local',
    capabilities: { wordTimestamps: false },
    listVoices: async () => [],
    synthesize: async () => ({ audio: 'pcm' as const, samples: new Uint8Array(4800), sampleRate: 24000 }),
  }),
}));
vi.mock('../../../src/now-playing', () => ({ lockScreenPosition: () => {}, restateNowPlaying: () => {} }));
// A Document opened before: its body text size is known, so the page counts nothing.
vi.mock('../../../src/app/body-text-sizes', () => ({ readBodyTextSize: () => 16, writeBodyTextSize: () => {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const DOCUMENT = 'sha256:' + 'b'.repeat(64);
const SPINE = 60;
const READY: AppSettings = { ...DEFAULT_SETTINGS, provider: 'local', enabledProviders: ['local'], voice: 'af_bella' };

/** Every chapter of the stand-in Document is a heading and one sentence, named by its spine index. */
const begins = (chapter: number) => `Chapter ${chapter} begins.`;
const ends = (chapter: number) => `Chapter ${chapter} ends.`;

interface Section { index: number; href: string; next(): Section | undefined; prev(): Section | undefined }

/** epub.js's Queue: one task per tick, the next held until the promise a task returns settles. */
class Queue {
  private tasks: { task(): unknown; resolve(value: unknown): void; reject(reason: unknown): void }[] = [];
  running: unknown = false;
  constructor(public context: unknown, public tick: (run: () => void) => void) {}
  enqueue(task: () => unknown): Promise<unknown> {
    const promise = new Promise((resolve, reject) => this.tasks.push({ task, resolve, reject }));
    if (!this.running) this.run();
    return promise;
  }
  private dequeue(): Promise<unknown> {
    const entry = this.tasks.shift()!;
    const result = entry.task.call(this.context) as Promise<unknown> | undefined;
    if (result && typeof result.then === 'function') return result.then(entry.resolve, entry.reject);
    entry.resolve(result);
    return Promise.resolve();
  }
  private run(): void {
    this.running = true;
    this.tick.call(null, () => {
      if (this.tasks.length) void this.dequeue().then(() => this.run());
      else this.running = undefined;
    });
  }
}

/** The page: epub.js's stand-in, and the globals the program runs against. */
function createPage(toApp: (message: unknown) => void, stalled: ReadonlySet<number>, cleanupFailures: Set<number>) {
  const hooks: ((contents: unknown) => void)[] = [];
  const listeners = new Map<string, (() => void)[]>();
  const record = { displays: [] as string[], laidOutAhead: [] as number[], hosts: 0 };

  const spine: Section[] = [];
  for (let index = 0; index < SPINE; index++) {
    spine.push({ index, href: `chapter-${index}.xhtml`, next: () => spine[index + 1], prev: () => spine[index - 1] });
  }
  /** `Spine.get`: a CFI, or a spine index in its decimal spelling. */
  const spineGet = (target: unknown): Section | undefined => {
    const cfi = /^epubcfi\(\/6\/(\d+)/.exec(String(target));
    return spine[cfi ? Number(cfi[1]) / 2 - 1 : Number(target ?? 0)];
  };

  /** A section's document: a `<p>` per sentence. It has no frame element, so the program measures nothing in it. */
  function contentsOf(section: Section) {
    const doc: Record<string, unknown> = {};
    const element = (tagName: string, parentNode: unknown) => {
      const made = {
        nodeType: 1, tagName, parentNode, ownerDocument: doc, childNodes: [] as unknown[], id: '', textContent: '',
        setAttribute() {},
        appendChild(child: unknown) { made.childNodes.push(child); return child; },
        getElementsByTagName: () => made.childNodes,
      };
      return made;
    };
    const html = element('HTML', null);
    const head = element('HEAD', html);
    const body = element('BODY', html);
    for (const text of [begins(section.index), ends(section.index)]) {
      const paragraph = element('P', body);
      paragraph.childNodes.push({ nodeType: 3, data: text, parentElement: paragraph, ownerDocument: doc });
      body.childNodes.push(paragraph);
    }
    class Highlight extends Set<unknown> { priority = 0; }
    const frame = {
      document: doc,
      frameElement: null,
      getComputedStyle: () => ({ display: 'block', textAlign: 'start', fontSize: '16px', getPropertyValue: () => '' }),
      Highlight,
      CSS: { highlights: new Map() },
    };
    Object.assign(doc, {
      documentElement: html, head, body, defaultView: frame,
      getElementById: (id: string) => (head.childNodes as { id: string }[]).find((child) => child.id === id) ?? null,
      createElement: (tag: string) => element(tag.toUpperCase(), null),
      addEventListener() {},
      createRange: () => {
        const range = {
          startContainer: null as unknown,
          setStart(node: unknown) { range.startContainer = node; },
          setEnd() {},
          selectNode() {},
          getClientRects: () => [],
          getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
        };
        return range;
      },
    });
    return {
      document: doc, window: frame, sectionIndex: section.index,
      cfiFromNode: (node: unknown) => `epubcfi(/6/${2 * (section.index + 1)}!/4/${2 * (body.childNodes.indexOf(node) + 1)})`,
    };
  }

  const views = {
    _views: [] as View[],
    length: 0,
    all() { return this._views; },
    first() { return this._views[0]; },
    last() { return this._views[this._views.length - 1]; },
    append(view: View) { this._views.push(view); this.length++; return view; },
    prepend(view: View) { this._views.unshift(view); this.length++; return view; },
    /** Only a displayed view is found. */
    find(section: Section) { return this._views.find((view) => view.displayed && view.section.index === section.index); },
    destroy(view: View) {
      if (view.displayed) view.destroy();
      // epub.js Views.destroy removes from the visible container, not from
      // an arbitrary parent. A preparation host belongs to another parent.
      if (view.element.attached) throw new Error('NotFoundError: the view is not a child of the visible container');
    },
    clear() {
      for (const view of this._views) this.destroy(view);
      this._views = [];
      this.length = 0;
    },
  };

  class View {
    displayed = false;
    element = { attached: false };
    contents: ReturnType<typeof contentsOf> | null = null;
    constructor(public section: Section) {}
    display(): Promise<unknown> {
      if (this.displayed) return Promise.resolve(this);
      return Promise.resolve().then(() => {
        // A view taken off the page before its iframe loads never loads (#112).
        if (!views._views.includes(this) && !this.element.attached) return new Promise(() => {});
        if (this.element.attached && stalled.has(this.section.index)) return new Promise(() => {});
        this.contents = contentsOf(this.section);
        this.displayed = true;
        // Rendition.afterDisplayed: the content hook chain, at every display.
        if (views._views.includes(this)) for (const hook of hooks) hook(this.contents);
        return this;
      });
    }
    offset() { return { top: 0, left: 0 }; }
    destroy() {
      if (this.element.attached && cleanupFailures.delete(this.section.index)) throw new Error('view cleanup failed');
      if (this.contents) this.contents.document.defaultView = null;
      this.contents = null;
      this.displayed = false;
    }
  }

  const stage = { scrollTop: 0, clientHeight: 800, addEventListener() {}, getBoundingClientRect: () => ({ top: 0 }) };
  const sandbox: Record<string, unknown> = {
    console,
    setTimeout: (run: () => void, ms?: number) => setTimeout(run, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    requestAnimationFrame: (run: (now: number) => void) => setTimeout(() => run(Date.now()), 16),
    cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    performance: { now: () => Date.now() },
    document: {
      getElementById: () => null,
      createElement: () => {
        let child: { attached: boolean } | null = null;
        return {
          style: {}, setAttribute() {},
          appendChild(element: { attached: boolean }) { child = element; child.attached = true; },
          remove() { if (child) child.attached = false; record.hosts--; },
        };
      },
      head: { appendChild() {} }, body: { appendChild() { record.hosts++; } },
    },
    // The library's View.js, 130-135: it parses the string and hands the object to onWebViewMessage.
    ReactNativeWebView: { postMessage: (data: string) => { const message = JSON.parse(data) as unknown; setTimeout(() => toApp(message), 0); } },
  };
  sandbox.window = sandbox;
  const frameTick = (run: () => void) => { (sandbox.requestAnimationFrame as (run: () => void) => void)(run); };

  const manager = {
    View,
    views,
    q: null as unknown as Queue,
    settings: { offset: 500 },
    container: stage,
    stage: { getContainer: () => stage, overflow() {}, settings: { overflow: 'scroll' } },
    request: () => {},
    scrollTop: 0,
    scrollBy() {},
    trim: () => Promise.resolve(),
    check: () => Promise.resolve(false),
    /** What the program's renderAhead calls, inside the manager's queue. */
    append(section: Section) {
      record.laidOutAhead.push(section.index);
      return views.append(new manager.View(section));
    },
    /**
     * A section on the page is scrolled to, and the views stay. Any other
     * clears every view and lays the section out; the page is then at its top,
     * so check() lays out the section before it, and the one after it.
     */
    display(section: Section): Promise<unknown> {
      if (views.find(section)) return Promise.resolve();
      views.clear();
      return views.append(new manager.View(section)).display().then(() => {
        const around: Promise<unknown>[] = [];
        const before = section.prev();
        const after = section.next();
        if (before) around.push(views.prepend(new manager.View(before)).display());
        if (after) around.push(views.append(new manager.View(after)).display());
        return Promise.all(around);
      });
    },
  };
  manager.q = new Queue(manager, frameTick);

  const rendition = {
    manager,
    q: null as unknown as Queue,
    hooks: { content: { register: (hook: (contents: unknown) => void) => { hooks.push(hook); } } },
    on(event: string, listener: () => void) { listeners.set(event, [...(listeners.get(event) ?? []), listener]); },
    location: { start: { cfi: 'epubcfi(/6/2!/4/2)' } },
    getContents: () => views.all().map((view) => view.contents).filter((contents) => contents !== null),
    display(target?: unknown): Promise<unknown> {
      record.displays.push(String(target));
      return rendition.q.enqueue(() => {
        const section = spineGet(target);
        if (!section) return Promise.reject(new Error('No Section Found'));
        return manager.display(section).then(() => { for (const listener of listeners.get('relocated') ?? []) listener(); });
      });
    },
  };
  rendition.q = new Queue(rendition, frameTick);

  sandbox.rendition = rendition;
  sandbox.book = { spine: { length: SPINE, get: spineGet }, package: { metadata: { language: 'en' } } };
  const context = vm.createContext(sandbox);

  return {
    record,
    views: () => views.all().map((view) => view.section.index),
    /** The library's injectJavaScript. */
    evaluate(code: string) { setTimeout(() => vm.runInContext(code, context), 0); },
    /** The library's template: display first, and the program from onReady, once that display has resolved. */
    open(at: number, program: string) {
      void rendition.display(at).then(() => vm.runInContext(program, context));
    },
  };
}

async function openDocument(at: number, stalled: ReadonlySet<number> = new Set(), cleanupFailures = new Set<number>()) {
  world.graph.handlers = null;
  world.graph.queue.length = 0;
  world.graph.serial = 0;

  let reading!: Reading;
  function Probe() {
    reading = useReading(READY, { hasKey: false, writtenAt: 0 }, null, DOCUMENT);
    return null;
  }
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Probe)); });

  /** Every sentence the app told the page is beginning, in order; the sections the page reported; what it said could not be drawn. */
  const spoken: string[] = [];
  const reported: number[] = [];
  const problems: string[] = [];
  const page = createPage((message) => {
    const from = message as { sectionIndex?: number; detail?: string };
    if (typeof from.sectionIndex === 'number') reported.push(from.sectionIndex);
    if (typeof from.detail === 'string') problems.push(from.detail);
    reading.bridge.readerProps.onWebViewMessage(message);
  }, stalled, cleanupFailures);
  world.toPage = (code) => {
    const found = /\((\{.*\})\); true;$/s.exec(code);
    const message = found ? (JSON.parse(found[1]) as { kind?: string; utteranceRanges?: { text: string }[] }) : null;
    if (message?.kind === 'speak') {
      const text = (message.utteranceRanges ?? []).map((range) => range.text).join('');
      if (spoken[spoken.length - 1] !== text) spoken.push(text);
    }
    page.evaluate(code);
  };

  const run = async (ms: number, action: () => void = () => {}) => {
    await act(async () => {
      action();
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  page.open(at, reading.bridge.readerProps.injectedJavascript);
  await run(500);

  /** The native queue finishes its front buffer: a sentence has been heard. */
  const hear = async () => {
    // The engine holds a new section's first Clip until the queue is empty, and 100 ms more.
    if (world.graph.queue.length === 0) await run(200);
    const front = world.graph.queue.shift();
    if (!front) return false;
    await run(400, () => world.graph.handlers!.onBufferEnded(front));
    return true;
  };

  return {
    page,
    spoken,
    reported,
    problems,
    get reading() { return reading; },
    wait: (ms: number) => run(ms),
    play: () => run(500, () => reading.play()),
    /** A Contents row: `contents-sheet.tsx`'s `onGo`, which `reading-view.tsx` wires to `reading.goToSection`. */
    contentsRow: (section: number) => run(500, () => reading.goToSection(section)),
    /** Listen until `sentence` has been heard to its end, and a moment longer. */
    async listenThrough(sentence: string) {
      for (let turn = 0; turn < 20; turn++) {
        const last = spoken[spoken.length - 1];
        if (!(await hear())) return;
        if (last === sentence) return;
      }
    },
    async close() {
      await act(async () => { tree.unmount(); });
      world.toPage = null;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-11T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the voice reads on while the page is Browsing', () => {
  it('control: with the page following, the chapter after the voice is laid out and read next', async () => {
    const book = await openDocument(0);
    expect(book.page.views()).toEqual([0, 1]);
    await book.play();
    await book.listenThrough(ends(2));

    expect(book.spoken).toEqual([begins(0), ends(0), begins(1), ends(1), begins(2), ends(2), begins(3)]);
    expect(book.page.record.laidOutAhead).toEqual([2, 3, 4]);
    expect(book.problems).toEqual([]);
    await book.close();
  });

  it('a later chapter looked at through Contents: the voice goes on with the next chapter, not with the one looked at', async () => {
    const book = await openDocument(0);
    await book.play();
    expect(book.spoken).toEqual([begins(0)]);

    const clears = world.graph.clears;
    await book.contentsRow(40);
    expect(book.reading.status.following).toBe(false);
    expect(book.page.views()).toEqual([39, 40, 41]);

    await book.listenThrough(ends(1));

    expect(book.problems).toEqual([]);
    expect(book.spoken).toEqual([begins(0), ends(0), begins(1), ends(1), begins(2)]);
    expect(world.graph.clears).toBe(clears);
    expect(book.page.record.hosts).toBe(0);
    await book.listenThrough(ends(3));
    expect(book.spoken).toEqual([begins(0), ends(0), begins(1), ends(1), begins(2), ends(2), begins(3), ends(3), begins(4)]);
    expect(book.page.record.hosts).toBe(0);
    expect(book.page.views()).toEqual([39, 40, 41]);
    await book.close();
  });

  it('a missing section blocks distant cached text, times out, and leaves Browsing where the owner put it', async () => {
    const stalled = new Set([2]);
    const book = await openDocument(0, stalled);
    await book.play();
    await book.contentsRow(40);
    await book.listenThrough(ends(1));
    expect(book.spoken).toEqual([begins(0), ends(0), begins(1), ends(1)]);
    expect(book.reading.readingPosition()?.anchor.exact).toBe(ends(1));
    await book.wait(16_000);
    expect(book.reading.status).toMatchObject({ playing: false, buffering: false });
    expect(book.reading.status.note).toContain('timed out');
    expect(book.page.record.hosts).toBe(0);
    expect(book.page.views()).toEqual([39, 40, 41]);
    stalled.clear();
    await book.play();
    await book.wait(500);
    expect(book.spoken).toContain(begins(2));
    expect(book.spoken).not.toContain(begins(39));
    expect(book.reading.status.playing).toBe(true);
    expect(book.page.record.hosts).toBe(0);
    await book.close();
  });

  it('a cleanup error cannot leave the host behind or strand the next preparation', async () => {
    const book = await openDocument(0, new Set(), new Set([2]));
    await book.play();
    await book.contentsRow(40);
    await book.listenThrough(ends(3));
    expect(book.spoken).toContain(begins(4));
    expect(book.spoken).not.toContain(begins(39));
    expect(book.page.record.hosts).toBe(0);
    expect(book.page.views()).toEqual([39, 40, 41]);
    await book.close();
  });

  it('an earlier chapter looked at through Contents: the voice goes on with the next chapter instead of falling silent', async () => {
    const book = await openDocument(10);
    expect(book.page.views()).toEqual([9, 10, 11]);
    await book.play();
    expect(book.spoken).toEqual([begins(9)]);

    await book.contentsRow(2);
    expect(book.reading.status.following).toBe(false);
    expect(book.page.views()).toEqual([1, 2, 3]);

    await book.listenThrough(ends(11));

    expect(book.problems).toEqual([]);
    expect(book.spoken).toEqual([begins(9), ends(9), begins(10), ends(10), begins(11), ends(11), begins(12)]);
    await book.close();
  });
});
