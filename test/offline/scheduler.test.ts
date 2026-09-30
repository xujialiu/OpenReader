import { describe, expect, it, vi } from 'vitest';
import { createScheduler, PreparationInterrupted } from '../../src/offline/scheduler';
import { navigationPlan, withPreparedSection, type Chapter, type DownloadTask, type NarrationPlan } from '../../src/offline/model';
import { SynthesisError } from '../../src/core/providers/errors';

function fixture() {
  const plan: NarrationPlan = { version: 2, chapters: [
    { id: 'a', title: 'A', depth: 0, parent: null, texts: ['One.', 'Two.'] },
    { id: 'b', title: 'B', depth: 0, parent: null, texts: ['Three.'] },
  ] };
  const tasks: DownloadTask[] = [{ id: '1', document: 'book', voice: { provider: 'fish', voice: 'A', label: 'A' },
    chapters: ['a', 'b'], state: 'queued', error: null, failed: [] }];
  const stored = new Set<string>();
  const fetch = vi.fn(async (_task: DownloadTask, text: string) => { stored.add(text); });
  const env = { online: true, allowed: true };
  const scheduler = createScheduler({ tasks: () => tasks, plan: () => plan, changed: vi.fn(),
    connected: () => env.online, allowed: () => env.allowed, exists: (_, text) => stored.has(text),
    fetch, wait: async () => {} });
  return { tasks, stored, fetch, env, scheduler };
}
describe('durable download scheduling', () => {
  it('loads only selected chapter text and awaits durable state before requesting audio', async () => {
    const task:DownloadTask={id:'t',document:'book',voice:{provider:'fish',voice:'A',label:'A'},chapters:['late'],state:'queued',error:null,failed:[]};
    const events:string[]=[];
    const scheduler=createScheduler({tasks:()=>[task],plan:async()=>({version:2,chapters:[
      {id:'early',title:'Early',depth:0,parent:null,texts:[],textCount:500,textsLoaded:false},
      {id:'late',title:'Late',depth:0,parent:null,texts:[],textCount:1,textsLoaded:false},
    ]}),connected:()=>true,allowed:()=>true,changed:async()=>{events.push(`saved ${task.state}`);},
    load:async(_,chapter)=>{events.push(`load ${chapter.id}`);return {...chapter,texts:['Late audio'],textsLoaded:true};},
    exists:async()=>false,fetch:async(_,text)=>{events.push(text);},wait:async()=>{},});
    await scheduler.run();
    expect(events).toEqual(['saved downloading','load late','Late audio','saved downloading','saved done']);
  });
  it('reuses completed audio, in order, without overlapping workers', async () => {
    const f = fixture(); f.stored.add('One.');
    await Promise.all([f.scheduler.run(), f.scheduler.run()]);
    expect(f.fetch.mock.calls.map((c) => c[1])).toEqual(['Two.', 'Three.']);
    expect(f.tasks[0].state).toBe('done');
  });
  it('does not undo manual pause after an in-flight request settles', async () => {
    const f = fixture();
    f.fetch.mockImplementationOnce(async () => { f.tasks[0].state = 'paused'; });
    await f.scheduler.run();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.tasks[0].state).toBe('paused');
  });
  it('stops requesting on network loss and preserves the unfinished task', async () => {
    const f = fixture();
    f.fetch.mockImplementationOnce(async () => { f.env.online = false; throw new SynthesisError('network'); });
    await f.scheduler.run();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.tasks[0].state).toBe('waiting');
    expect(f.tasks[0].failed).toEqual([]);
  });
  it('bounds transient retries then continues later chapters without false whole completion', async () => {
    const f = fixture();
    f.fetch.mockImplementation(async (_, text) => { if (text === 'One.') throw new SynthesisError('network'); f.stored.add(text); });
    await f.scheduler.run();
    expect(f.fetch.mock.calls.map((c) => c[1])).toEqual(['One.', 'One.', 'One.', 'Three.']);
    expect(f.tasks[0].failed).toEqual(['a']);
    expect(f.stored.has('Two.')).toBe(false);
  });
  it.each(['auth', 'quota', 'no-key', 'declined'] as const)('pauses all remaining requests on %s', async (kind) => {
    const f = fixture(); f.fetch.mockRejectedValue(new SynthesisError(kind));
    await f.scheduler.run();
    expect(f.tasks[0].state).toBe('blocked'); expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('stops the whole download for a Provider the owner did not allow, says why, and fails no chapter (#109)', async () => {
    const f = fixture();
    f.fetch.mockRejectedValue(new SynthesisError('declined', 'Fish Audio was not allowed to receive this document\'s text.'));
    await f.scheduler.run();
    expect(f.tasks[0]).toMatchObject({ state: 'blocked', error: 'Fish Audio was not allowed to receive this document\'s text.', failed: [] });
  });
  it('does not resurrect a removed task', async () => {
    const f = fixture(); f.fetch.mockImplementationOnce(async () => { f.tasks.splice(0); });
    await f.scheduler.run(); expect(f.tasks).toEqual([]); expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('yields to background expiration and can resume without repeating saved audio', async () => {
    const f = fixture(); f.fetch.mockImplementationOnce(async (_, text) => { f.stored.add(text); f.env.allowed = false; });
    await f.scheduler.run(); expect(f.tasks[0].state).toBe('interrupted');
    f.env.allowed = true; f.tasks[0].state = 'queued'; await f.scheduler.run();
    expect(f.fetch.mock.calls.map((c) => c[1])).toEqual(['One.', 'Two.', 'Three.']);
  });
  it('skips a paused book and proceeds to the next queued book with its own voice', async () => {
    const f = fixture(); const first = f.tasks[0]; first.state = 'paused';
    f.tasks.push({ ...first, id: '2', document: 'second', state: 'queued', voice: { ...first.voice, voice: 'B' } });
    await f.scheduler.run(); expect(first.state).toBe('paused');
    expect(f.fetch.mock.calls.every(([task]) => task.voice.voice === 'B')).toBe(true);
  });
});

it('prepares only selected late chapters, the next one while the one before it is written (#76)', async () => {
  let plan = navigationPlan({ sections: Array.from({ length: 2200 }, (_, i) => ({ href: `${i}.xhtml`, path: `${i}.xhtml` })),
    chapters: Array.from({ length: 2200 }, (_, i) => ({ id: `c${i}`, title: `Chapter ${i}`, parent: null, depth: 0, section: i, fragment: '' })) });
  const task: DownloadTask = { id: 'one', document: 'book', voice: { provider: 'fish', voice: 'A', label: 'A' },
    chapters: ['c2099', 'c2100'], state: 'queued', error: null, failed: [] };
  const events: string[] = [];
  const scheduler = createScheduler({ tasks: () => [task], plan: () => plan, changed: () => {}, connected: () => true, allowed: () => true,
    exists: () => false, wait: async () => {},
    prepare: async (_, chapter) => {
      events.push(`prepare ${chapter.id} ${task.state}`);
      const ready = { ...chapter, prepared: true, texts: [`Audio ${chapter.id}`] };
      plan = withPreparedSection(plan, chapter.section!, [ready]); return ready;
    },
    fetch: async (_, text) => { events.push(text); },
  });
  expect(events).toEqual([]);
  await scheduler.run();
  // The first is counted while nothing else is going on; the second while the first is written.
  expect(events.filter((e) => e.startsWith('prepare'))).toEqual(['prepare c2099 preparing', 'prepare c2100 downloading']);
  expect(events.filter((e) => e.startsWith('Audio'))).toEqual(['Audio c2099', 'Audio c2100']);
  expect(plan.preparedSections).toEqual([2099, 2100]); expect(task.state).toBe('done');
});

it.each(['paused', 'deleted'] as const)('does not synthesize a chapter %s during preparation', async (action) => {
  const f = fixture();
  const plan: NarrationPlan = { version: 2, chapters: [{ id: 'a', title: 'A', parent: null, depth: 0, section: 0, prepared: false, texts: [] }] };
  const task = f.tasks[0]; task.chapters = ['a'];
  const scheduler = createScheduler({ tasks: () => f.tasks, plan: () => plan, changed: () => {}, connected: () => true, allowed: () => true,
    exists: () => false, wait: async () => {}, fetch: f.fetch,
    prepare: async (_, chapter) => {
      if (action === 'paused') task.state = 'paused'; else task.chapters = [];
      return { ...chapter, prepared: true, texts: ['Never send this.'] };
    },
  });
  await scheduler.run(); expect(f.fetch).not.toHaveBeenCalled();
});

it('resumes without loading or re-checking chapters already complete for the voice', async () => {
  const f = fixture();
  const plan: NarrationPlan = { version: 2, chapters: [
    { id: 'a', title: 'A', depth: 0, parent: null, texts: [], textCount: 2, textsLoaded: false },
    { id: 'b', title: 'B', depth: 0, parent: null, texts: [], textCount: 1, textsLoaded: false },
  ] };
  const loaded: string[] = []; const checked: string[] = [];
  const scheduler = createScheduler({ tasks: () => f.tasks, plan: () => plan, changed: () => {}, connected: () => true, allowed: () => true,
    completed: async () => new Set(['a']),
    load: async (_, chapter) => { loaded.push(chapter.id); return { ...chapter, texts: chapter.id === 'a' ? ['One.', 'Two.'] : ['Three.'], textsLoaded: true }; },
    exists: async (_, text) => { checked.push(text); return false; }, fetch: f.fetch, wait: async () => {} });
  await scheduler.run();
  expect(loaded).toEqual(['b']); expect(checked).toEqual(['Three.']);
  expect(f.fetch.mock.calls.map((c) => c[1])).toEqual(['Three.']);
  expect(f.tasks[0].state).toBe('done');
});

it('names the chapter it is on and forgets it when the pass ends', async () => {
  const f = fixture();
  const seen: (string | null | undefined)[] = [];
  f.fetch.mockImplementation(async (task, text) => { seen.push(task.current); f.stored.add(text); });
  await f.scheduler.run();
  expect(seen).toEqual(['a', 'a', 'b']);
  expect(f.tasks[0].current).toBeNull();
});

it('names the chapter while its text is being counted', async () => {
  const task: DownloadTask = { id: 't', document: 'book', voice: { provider: 'fish', voice: 'A', label: 'A' }, chapters: ['x'], state: 'queued', error: null, failed: [] };
  const plan: NarrationPlan = { version: 2, chapters: [{ id: 'x', title: 'X', depth: 0, parent: null, texts: [], prepared: false }] };
  const during: string[] = [];
  const scheduler = createScheduler({ tasks: () => [task], plan: () => plan, changed: () => {}, connected: () => true, allowed: () => true,
    prepare: async (t, chapter) => { during.push(`${t.state} ${t.current}`); return { ...chapter, prepared: true, texts: ['Hi.'] }; },
    exists: () => false, fetch: async () => {}, wait: async () => {} });
  await scheduler.run();
  expect(during).toEqual(['preparing x']);
  expect(task.current).toBeNull();
});

it('forgets a chapter left over from before a restart as soon as the pass starts', async () => {
  const task: DownloadTask = { id: 't', document: 'book', voice: { provider: 'fish', voice: 'A', label: 'A' }, chapters: ['a', 'b'], state: 'queued', error: null, failed: [], current: 'b' };
  const plan: NarrationPlan = { version: 2, chapters: [
    { id: 'a', title: 'A', depth: 0, parent: null, texts: ['One.'] },
    { id: 'b', title: 'B', depth: 0, parent: null, texts: ['Two.'] },
  ] };
  const events: string[] = [];
  const scheduler = createScheduler({ tasks: () => [task], plan: () => plan, changed: () => { events.push(`${task.state} ${task.current}`); },
    connected: () => true, allowed: () => true, exists: () => false, fetch: async () => {}, wait: async () => {} });
  await scheduler.run();
  expect(events).toEqual(['downloading null', 'downloading a', 'downloading b', 'done null']);
});

describe('the order chapters are written in, and chapters paused one by one (#56)', () => {
  const voice = { provider: 'fish' as const, voice: 'A', label: 'A' };
  function book(chapters: string[], extra: Partial<DownloadTask> = {}) {
    const plan: NarrationPlan = { version: 2, chapters: [
      { id: 'a', title: 'A', depth: 0, parent: null, texts: ['A1'] },
      { id: 'b', title: 'B', depth: 0, parent: null, texts: ['B1', 'B2'] },
      { id: 'c', title: 'C', depth: 0, parent: null, texts: ['C1'] },
    ] };
    const task: DownloadTask = { id: 't', document: 'book', voice, chapters, state: 'queued', error: null, failed: [], ...extra };
    const fetched: string[] = [];
    const fetch = vi.fn(async (_task: DownloadTask, text: string) => { fetched.push(text); });
    const scheduler = createScheduler({ tasks: () => [task], plan: () => plan, changed: () => {}, connected: () => true, allowed: () => true,
      exists: (_, text) => fetched.includes(text), fetch, wait: async () => {} });
    return { task, fetched, fetch, scheduler };
  }
  it('writes from the top of the list down, whatever order the chapters were chosen in', async () => {
    const f = book(['c', 'a', 'b']);
    await f.scheduler.run();
    expect(f.fetched).toEqual(['A1', 'B1', 'B2', 'C1']);
    expect(f.task.state).toBe('done');
  });
  it('passes over a paused chapter and leaves the download paused once only paused chapters are left', async () => {
    const f = book(['a', 'b', 'c'], { paused: ['b'] });
    await f.scheduler.run();
    expect(f.fetched).toEqual(['A1', 'C1']);
    expect(f.task.state).toBe('paused');
    expect(f.task.current).toBeNull();
  });
  it('leaves the chapter being written when it is paused, keeps what it saved, and starts the next', async () => {
    const f = book(['a', 'b', 'c']);
    f.fetch.mockImplementation(async (task, text) => { f.fetched.push(text); if (text === 'B1') task.paused = ['b']; });
    await f.scheduler.run();
    expect(f.fetched).toEqual(['A1', 'B1', 'C1']);
    expect(f.task.state).toBe('paused');
  });
  it('lets a chapter resumed above the one being written wait for it, then comes next', async () => {
    const f = book(['a', 'b', 'c'], { paused: ['a'] });
    f.fetch.mockImplementation(async (task, text) => { f.fetched.push(text); if (text === 'B1') task.paused = []; });
    await f.scheduler.run();
    expect(f.fetched).toEqual(['B1', 'B2', 'A1', 'C1']);
    expect(f.task.state).toBe('done');
  });
  it('does not record a failure for a chapter paused while its request was out', async () => {
    const f = book(['a', 'b']);
    f.fetch.mockImplementation(async (task, text) => {
      if (text === 'A1') { task.paused = ['a']; throw new SynthesisError('decode-failed'); }
      f.fetched.push(text);
    });
    await f.scheduler.run();
    expect(f.task.failed).toEqual([]);
    expect(f.fetched).toEqual(['B1', 'B2']);
    expect(f.task.state).toBe('paused');
  });
  it('chooses a prepared chapter with no text once, not again and again', async () => {
    const plan: NarrationPlan = { version: 2, chapters: [
      { id: 'empty', title: 'Empty', depth: 0, parent: null, texts: [], section: 0, prepared: false },
      { id: 'b', title: 'B', depth: 0, parent: null, texts: ['B1'] },
    ] };
    const task: DownloadTask = { id: 't', document: 'book', voice, chapters: ['empty', 'b'], state: 'queued', error: null, failed: [] };
    const prepare = vi.fn(async (_: DownloadTask, chapter: NarrationPlan['chapters'][number]) => ({ ...chapter, prepared: true, texts: [] }));
    const fetch = vi.fn(async (_task: DownloadTask, _text: string) => {});
    const scheduler = createScheduler({ tasks: () => [task], plan: () => plan, changed: () => {}, connected: () => true, allowed: () => true,
      exists: () => false, prepare, fetch, wait: async () => {} });
    await scheduler.run();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.map((c) => c[1])).toEqual(['B1']);
    expect(task.state).toBe('done');
  });
});

describe('several of a chapter\'s sentences at once (#64)', () => {
  const voice = { provider: 'fish' as const, voice: 'A', label: 'A' };
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  /** A request that takes `delay` ticks, then does `effect`, which may throw; every start and end is logged in order. */
  function requests(delay: (text: string) => number, effect?: (task: DownloadTask, text: string) => void) {
    const events: string[] = [];
    let out = 0;
    let most = 0;
    const request = async (task: DownloadTask, text: string) => {
      events.push(`start ${text}`); most = Math.max(most, ++out);
      try { for (let i = 0; i < delay(text); i++) await tick(); effect?.(task, text); }
      finally { out--; events.push(`end ${text}`); }
    };
    return { events, request, most: () => most, starts: () => events.filter((e) => e.startsWith('start')) };
  }
  /** Chapter a holds A1…A`size`, chapter b holds B1; up to `at` requests out at once, asked as each chapter starts. */
  function book(size: number, at: number | (() => number), request: (task: DownloadTask, text: string) => Promise<void>,
    { env = { online: true, allowed: true }, texts, exists }: { env?: { online: boolean; allowed: boolean }; texts?: string[]; exists?: (text: string) => void } = {}) {
    const plan: NarrationPlan = { version: 2, chapters: [
      { id: 'a', title: 'A', depth: 0, parent: null, texts: texts ?? Array.from({ length: size }, (_, i) => `A${i + 1}`) },
      { id: 'b', title: 'B', depth: 0, parent: null, texts: ['B1'] },
    ] };
    const task: DownloadTask = { id: 't', document: 'book', voice, chapters: ['a', 'b'], state: 'queued', error: null, failed: [] };
    const saved = new Set<string>();
    const scheduler = createScheduler({ tasks: () => [task], plan: () => plan, changed: () => {}, connected: () => env.online, allowed: () => env.allowed,
      exists: (_, text) => { exists?.(text); return saved.has(text); }, fetch: async (t, text) => { await request(t, text); saved.add(text); },
      concurrency: () => (typeof at === 'number' ? at : at()), wait: async () => {} });
    return { task, saved, scheduler };
  }

  it('keeps as many of the chapter\'s requests out as it may, and never more', async () => {
    const r = requests((text) => (Number(text.slice(1)) % 3) + 1);
    const f = book(7, 3, r.request);
    await f.scheduler.run();
    expect(r.most()).toBe(3);
    expect([...f.saved].sort()).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'B1']);
    expect(f.task.state).toBe('done');
  });
  it('sends the next chapter\'s first request only once the last of this chapter\'s has settled', async () => {
    const r = requests((text) => (text === 'A1' ? 5 : 1));
    const f = book(4, 3, r.request);
    await f.scheduler.run();
    expect(r.events.indexOf('start B1')).toBeGreaterThan(r.events.indexOf('end A1'));
    expect(f.task.state).toBe('done');
  });
  it('starts none of a paused chapter\'s texts, keeps what its requests out bring, and goes on to the next', async () => {
    const r = requests(() => 1, (task, text) => { if (text === 'A2') { task.paused = ['a']; r.events.push('paused'); } });
    const f = book(6, 3, r.request);
    await f.scheduler.run();
    const started = r.starts().filter((e) => e.startsWith('start A'));
    expect(r.events.slice(r.events.indexOf('paused')).filter((e) => e.startsWith('start A'))).toEqual([]);
    expect([...f.saved].filter((text) => text.startsWith('A'))).toHaveLength(started.length);
    expect(f.saved.has('B1')).toBe(true);
    expect(f.task.state).toBe('paused');
    expect(f.task.failed).toEqual([]);
  });
  it('meets the first failure once, starts nothing after it, and lets the requests out settle', async () => {
    const r = requests((text) => (text === 'A2' ? 1 : 3), (_, text) => { if (text === 'A2') throw new SynthesisError('auth', 'Refused.'); });
    const f = book(6, 3, r.request);
    await f.scheduler.run();
    expect(r.starts()).toEqual(['start A1', 'start A2', 'start A3']);
    expect(r.events.filter((e) => e.startsWith('end'))).toHaveLength(3);
    expect(f.task.state).toBe('blocked');
    expect(f.task.error).toBe('Refused.');
  });
  it('fails the chapter once its retries are spent, and starts the next after its other requests settle', async () => {
    const r = requests((text) => (text === 'A3' ? 4 : 1), (_, text) => { if (text === 'A1') throw new SynthesisError('network'); });
    const f = book(4, 3, r.request);
    await f.scheduler.run();
    expect(r.starts().filter((e) => e === 'start A1')).toHaveLength(3);
    expect(f.task.failed).toEqual(['a']);
    expect(r.events.indexOf('start B1')).toBeGreaterThan(r.events.indexOf('end A3'));
    expect(f.saved.has('B1')).toBe(true);
  });
  it('waits for the network when it goes with several requests out, and records no failure', async () => {
    const env = { online: true, allowed: true };
    const r = requests((text) => (text === 'A1' ? 1 : 2), (_, text) => { if (text === 'A1') { env.online = false; throw new SynthesisError('network'); } });
    const f = book(6, 3, r.request, { env });
    await f.scheduler.run();
    expect(r.starts()).toEqual(['start A1', 'start A2', 'start A3']);
    expect(f.task.state).toBe('waiting');
    expect(f.task.failed).toEqual([]);
  });
  it('yields to background expiration with several requests out, and keeps what they bring', async () => {
    const env = { online: true, allowed: true };
    const r = requests(() => 1, (_, text) => { if (text === 'A1') env.allowed = false; });
    const f = book(6, 3, r.request, { env });
    await f.scheduler.run();
    expect(r.starts()).toEqual(['start A1', 'start A2', 'start A3']);
    expect([...f.saved].sort()).toEqual(['A1', 'A2', 'A3']);
    expect(f.task.state).toBe('interrupted');
  });
  it('leaves the chapter only after its requests out have settled when the store fails', async () => {
    const r = requests(() => 3);
    const f = book(5, 3, r.request, { exists: (text) => { if (text === 'A4') throw new Error('The catalogue is gone.'); } });
    await f.scheduler.run();
    expect(r.starts()).toEqual(['start A1', 'start A2', 'start A3']);
    expect(r.events.filter((e) => e.startsWith('end'))).toEqual(['end A1', 'end A2', 'end A3']);
    expect(f.task.state).toBe('blocked');
    expect(f.task.error).toBe('The catalogue is gone.');
  });
  it('sends nothing for a text whose check was out when its chapter was paused', async () => {
    const r = requests(() => 1);
    const pause: { task?: DownloadTask } = {};
    const f = book(3, 1, r.request, { exists: (text) => { if (text === 'A2') pause.task!.paused = ['a']; } });
    pause.task = f.task;
    await f.scheduler.run();
    expect(r.starts()).toEqual(['start A1', 'start B1']);
  });
  it('asks how many at once as each chapter starts, so a change made during one applies from the next (#64)', async () => {
    let width = 1;
    const asked: number[] = [];
    const r = requests(() => 1, (_, text) => { if (text === 'A2') width = 3; });
    const f = book(6, () => { asked.push(width); return width; }, r.request);
    await f.scheduler.run();
    expect(r.most()).toBe(1);
    expect(asked).toEqual([1, 3]);
    expect(f.task.state).toBe('done');
  });
  it('asks for a text the chapter holds twice once', async () => {
    const r = requests(() => 1);
    const f = book(0, 3, r.request, { texts: ['Same.', 'Other.', 'Same.'] });
    await f.scheduler.run();
    expect(r.starts().sort()).toEqual(['start B1', 'start Other.', 'start Same.']);
  });
});

describe('chapter text prepared ahead in the foreground, and never away from it (#76)', () => {
  const voice = { provider: 'fish' as const, voice: 'A', label: 'A' };
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  /** Ticks until `done` holds; fails rather than hanging when it never does. */
  async function until(done: () => boolean) {
    for (let i = 0; i < 1000 && !done(); i++) await tick();
    expect(done()).toBe(true);
  }
  /**
   * A document of `count` chapters c0…, one per section, none prepared unless
   * listed in `prepared`; chapter ci holds the one text `ci.` once prepared,
   * and is complete once that is saved, as the runtime's `completed` answers.
   * `hooks` act inside a preparation or request before it settles and may throw;
   * every start and end is logged in order, and `most` is the most preparations
   * out at once.
   */
  function book(count: number, { chapters, extra, prepared = [], completed, prepareTicks = () => 1, fetchTicks = () => 1, hooks = {} }: {
    chapters?: string[]; extra?: Partial<DownloadTask>; prepared?: string[]; completed?: string[];
    prepareTicks?: (chapter: string) => number; fetchTicks?: (text: string) => number;
    hooks?: { prepare?: (chapter: string, call: number) => void | Promise<void>; fetch?: (text: string) => void | Promise<void> };
  } = {}) {
    const ids = Array.from({ length: count }, (_, i) => `c${i}`);
    let plan = navigationPlan({ sections: ids.map((id) => ({ href: `${id}.xhtml`, path: `${id}.xhtml` })),
      chapters: ids.map((id, i) => ({ id, title: id, parent: null, depth: 0, section: i, fragment: '' })) });
    const ready = (chapter: Chapter): Chapter => ({ ...chapter, prepared: true, texts: [`${chapter.id}.`] });
    for (const id of prepared) { const chapter = plan.chapters.find((c) => c.id === id)!; plan = withPreparedSection(plan, chapter.section!, [ready(chapter)]); }
    const task: DownloadTask = { id: 't', document: 'book', voice, chapters: chapters ?? ids, state: 'queued', error: null, failed: [], ...extra };
    const env = { foreground: true, allowed: true };
    const events: string[] = [];
    const calls = new Map<string, number>();
    let out = 0;
    let most = 0;
    const prepare = vi.fn(async (_task: DownloadTask, chapter: Chapter) => {
      const call = (calls.get(chapter.id) ?? 0) + 1; calls.set(chapter.id, call);
      events.push(`prepare ${chapter.id} ${task.state}`); most = Math.max(most, ++out);
      try {
        for (let i = 0; i < prepareTicks(chapter.id); i++) await tick();
        await hooks.prepare?.(chapter.id, call);
        const done = ready(chapter);
        plan = withPreparedSection(plan, chapter.section!, [done]);
        return done;
      } finally { out--; events.push(`prepared ${chapter.id}`); }
    });
    const saved = new Set<string>();
    const fetch = vi.fn(async (_task: DownloadTask, text: string) => {
      events.push(`fetch ${text}`);
      for (let i = 0; i < fetchTicks(text); i++) await tick();
      await hooks.fetch?.(text);
      saved.add(text); events.push(`fetched ${text}`);
    });
    const scheduler = createScheduler({ tasks: () => [task], plan: () => plan, changed: () => { events.push(`state ${task.state}`); },
      connected: () => true, allowed: () => env.allowed, foreground: () => env.foreground,
      completed: async () => new Set([...(completed ?? []), ...ids.filter((id) => saved.has(`${id}.`))]), exists: (_, text) => saved.has(text), prepare, fetch, wait: async () => {} });
    const prepares = () => events.filter((e) => e.startsWith('prepare '));
    return { task, env, events, saved, prepare, fetch, scheduler, prepares, most: () => most, plan: () => plan };
  }

  it('prepares the chapters after the one being written, one after another, while it is written', async () => {
    const f = book(5, { fetchTicks: () => 20 });
    await f.scheduler.run();
    expect(f.prepares()).toEqual(['prepare c0 preparing', 'prepare c1 downloading', 'prepare c2 downloading', 'prepare c3 downloading', 'prepare c4 downloading']);
    expect(f.most()).toBe(1);
    // All four were ready before the first chapter's request came back.
    expect(f.events.indexOf('prepared c4')).toBeLessThan(f.events.indexOf('fetched c0.'));
    expect([...f.saved]).toEqual(['c0.', 'c1.', 'c2.', 'c3.', 'c4.']);
    expect(f.task.state).toBe('done');
  });

  it('prepares ahead in the list\'s order, passing over chapters finished, failed, paused or already prepared', async () => {
    const f = book(6, { chapters: ['c5', 'c1', 'c3', 'c0', 'c2', 'c4'], extra: { failed: ['c3'], paused: ['c1'] },
      completed: ['c2'], prepared: ['c4'], fetchTicks: () => 10 });
    await f.scheduler.run();
    expect(f.prepares()).toEqual(['prepare c0 preparing', 'prepare c5 downloading']);
    expect([...f.saved]).toEqual(['c0.', 'c4.', 'c5.']);
    expect(f.task.state).toBe('paused');
  });

  it('prepares every chapter the download will take while the first is written, not only the next ten', async () => {
    const count = 25;
    const f = book(count, { fetchTicks: (text) => (text === 'c0.' ? 4 * count : 1) });
    await f.scheduler.run();
    // The owner's choice of 2026-09-28: every chapter, where it was the next ten (#76).
    expect(f.events.indexOf(`prepared c${count - 1}`)).toBeLessThan(f.events.indexOf('fetched c0.'));
    expect(f.prepares()).toEqual(f.task.chapters.map((id, i) => `prepare ${id} ${i === 0 ? 'preparing' : 'downloading'}`));
    expect(f.most()).toBe(1);
    expect(f.task.state).toBe('done');
  });

  it('goes on down the list from where it was, rather than looking again at every chapter above it for each one', async () => {
    const count = 200;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const f = book(count, { hooks: { fetch: (text) => (text === 'c0.' ? gate : undefined) } });
    /** Chapters of the list looked at, by index, from the scheduler's side. */
    let looked = 0;
    const counted = (plan: NarrationPlan): NarrationPlan => ({ ...plan, chapters: new Proxy(plan.chapters, {
      get(target, key, receiver) { if (typeof key === 'string' && /^\d+$/.test(key)) looked++; return Reflect.get(target, key, receiver); },
    }) });
    const scheduler = createScheduler({ tasks: () => [f.task], plan: () => counted(f.plan()), changed: () => {}, connected: () => true,
      allowed: () => true, foreground: () => true, exists: (_, text) => f.saved.has(text), prepare: f.prepare, fetch: f.fetch, wait: async () => {} });
    const pass = scheduler.run();
    await until(() => f.events.includes(`prepared c${count - 1}`));
    // Once each, give or take the chapter the writer is on: a walk from the top for each chapter would be count² / 2.
    expect(looked).toBeLessThan(3 * count);
    release();
    await pass;
    expect(f.task.state).toBe('done');
  });

  it('prepares a chapter resumed above the ones being prepared ahead next, once the scheduler is asked again', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const f = book(5, { extra: { paused: ['c1'] }, prepareTicks: (chapter) => (chapter === 'c3' ? 10 : 1), hooks: {
      fetch: (text) => (text === 'c0.' ? gate : undefined),
    } });
    const pass = f.scheduler.run();
    await until(() => f.events.includes('prepare c3 downloading'));
    // The ring's resume, which the runtime follows with a run.
    f.task.paused = [];
    await f.scheduler.run();
    await until(() => f.events.includes('prepared c4'));
    release();
    await pass;
    expect(f.prepares()).toEqual(['prepare c0 preparing', 'prepare c2 downloading', 'prepare c3 downloading', 'prepare c1 downloading', 'prepare c4 downloading']);
    expect(f.task.state).toBe('done');
  });

  it('shares one preparation between the chapter being prepared ahead and the writer that needs it, never two at once', async () => {
    const f = book(2, { prepareTicks: (chapter) => (chapter === 'c1' ? 10 : 1) });
    await f.scheduler.run();
    expect(f.prepare.mock.calls.map(([, chapter]) => chapter.id)).toEqual(['c0', 'c1']);
    expect(f.most()).toBe(1);
    // The writer waited for it as the chapter being counted.
    expect(f.events.indexOf('state preparing', f.events.indexOf('fetched c0.'))).toBeLessThan(f.events.indexOf('prepared c1'));
    expect(f.task.state).toBe('done');
  });

  it('asks for a chapter the writer needs only once the preparation out for another has settled', async () => {
    // c1 is paused, so c2 is prepared ahead; c1 is resumed while c2's preparation is out, and the writer needs it next.
    const f = book(3, { extra: { paused: ['c1'] }, prepareTicks: (chapter) => (chapter === 'c2' ? 10 : 1),
      hooks: { fetch: (text) => { if (text === 'c0.') f.task.paused = []; } } });
    await f.scheduler.run();
    expect(f.prepares()).toEqual(['prepare c0 preparing', 'prepare c2 downloading', 'prepare c1 preparing']);
    expect(f.events.indexOf('prepare c1 preparing')).toBeGreaterThan(f.events.indexOf('prepared c2'));
    expect(f.most()).toBe(1);
    expect([...f.saved]).toEqual(['c0.', 'c1.', 'c2.']);
    expect(f.task.state).toBe('done');
  });

  it('writes the chapters prepared ahead while away from the screen, then waits as interrupted, and goes on when the app returns', async () => {
    // The app leaves once c1 is prepared ahead, while c0 is still being written.
    const f = book(4, { fetchTicks: () => 5, hooks: { prepare: (chapter) => { if (chapter === 'c1') f.env.foreground = false; } } });
    await f.scheduler.run();
    expect(f.prepares()).toEqual(['prepare c0 preparing', 'prepare c1 downloading']);
    expect([...f.saved]).toEqual(['c0.', 'c1.']);
    expect(f.task).toMatchObject({ state: 'interrupted', error: null, failed: [], current: null });

    // Back in the foreground, the runtime queues an interrupted download again.
    f.env.foreground = true; f.task.state = 'queued';
    await f.scheduler.run();
    expect(f.prepares().slice(2)).toEqual(['prepare c2 preparing', 'prepare c3 downloading']);
    expect([...f.saved]).toEqual(['c0.', 'c1.', 'c2.', 'c3.']);
    expect(f.task.state).toBe('done');
  });

  it('asks for nothing away from the screen: a chapter that is not prepared makes the download wait, not fail', async () => {
    const f = book(3, { prepared: ['c0'] });
    f.env.foreground = false;
    await f.scheduler.run();
    expect(f.prepare).not.toHaveBeenCalled();
    expect([...f.saved]).toEqual(['c0.']);
    expect(f.task).toMatchObject({ state: 'interrupted', error: null, failed: [] });
  });

  it('meets a preparation abandoned as the app left as an interruption, and asks for it again on return', async () => {
    const f = book(2, { hooks: { prepare: (chapter, call) => { if (chapter === 'c0' && call === 1) { f.env.foreground = false; throw new PreparationInterrupted(); } } } });
    await f.scheduler.run();
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.task).toMatchObject({ state: 'interrupted', error: null, failed: [] });

    f.env.foreground = true; f.task.state = 'queued';
    await f.scheduler.run();
    expect(f.prepare.mock.calls.map(([, chapter]) => chapter.id)).toEqual(['c0', 'c0', 'c1']);
    expect([...f.saved]).toEqual(['c0.', 'c1.']);
    expect(f.task.state).toBe('done');
  });

  it('keeps writing when a preparation ahead is abandoned, and prepares ahead again when the app returns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const f = book(3, { hooks: {
      prepare: (chapter, call) => { if (chapter === 'c1' && call === 1) { f.env.foreground = false; throw new PreparationInterrupted(); } },
      fetch: (text) => (text === 'c0.' ? gate : undefined),
    } });
    const pass = f.scheduler.run();
    await until(() => f.events.includes('prepared c1'));
    await tick();
    expect(f.task.state).toBe('downloading');
    // The runtime runs the scheduler again when the app returns; during a pass that wakes the preparation ahead.
    f.env.foreground = true;
    await f.scheduler.run();
    await until(() => f.events.filter((e) => e === 'prepared c2').length === 1);
    expect(f.events).not.toContain('fetched c0.');
    release();
    await pass;
    expect(f.prepares()).toEqual(['prepare c0 preparing', 'prepare c1 downloading', 'prepare c1 downloading', 'prepare c2 downloading']);
    expect(f.task.state).toBe('done');
    expect(f.events).not.toContain('state interrupted');
    // Abandoned is not failed: nothing to report.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('still stops the download when a preparation fails in the foreground', async () => {
    const f = book(2, { hooks: { prepare: () => { throw new Error('Chapter preparation timed out. Continue to try again.'); } } });
    await f.scheduler.run();
    expect(f.task).toMatchObject({ state: 'blocked', error: 'Chapter preparation timed out. Continue to try again.' });
  });

  it('tries a chapter whose preparation ahead failed once more, after the chapter that follows it, before the writer needs it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = book(4, { fetchTicks: () => 20, hooks: { prepare: (chapter, call) => { if (chapter === 'c1' && call === 1) throw new Error('Chapter 2 did not render.'); } } });
    await f.scheduler.run();
    expect(f.prepares()).toEqual(['prepare c0 preparing', 'prepare c1 downloading', 'prepare c2 downloading', 'prepare c1 downloading', 'prepare c3 downloading']);
    // Ready before the first chapter's request came back, so a download away from the screen would have gone past it.
    expect(f.events.indexOf('prepared c3')).toBeLessThan(f.events.indexOf('fetched c0.'));
    expect([...f.saved]).toEqual(['c0.', 'c1.', 'c2.', 'c3.']);
    expect(f.task).toMatchObject({ state: 'done', error: null });
    // The download shows nothing for it, so the log names the chapter and why (#76): one such
    // failure on the simulator left no trace of its cause.
    expect(warn.mock.calls).toEqual([['Chapter c1 was not prepared ahead: Chapter 2 did not render.']]);
    warn.mockRestore();
  });

  it('tries a failed chapter once more at once when no chapter follows it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = book(2, { fetchTicks: () => 10, hooks: { prepare: (chapter, call) => { if (chapter === 'c1' && call === 1) throw new Error('Chapter 2 did not render.'); } } });
    await f.scheduler.run();
    expect(f.prepares()).toEqual(['prepare c0 preparing', 'prepare c1 downloading', 'prepare c1 downloading']);
    expect(f.task.state).toBe('done');
    warn.mockRestore();
  });

  it('leaves a chapter whose preparation ahead failed twice to the writer, which asks for it once more when its turn comes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = book(4, { fetchTicks: () => 20, hooks: { prepare: (chapter, call) => { if (chapter === 'c1' && call <= 2) throw new Error(`Attempt ${call} did not render.`); } } });
    await f.scheduler.run();
    expect(f.prepares()).toEqual(['prepare c0 preparing', 'prepare c1 downloading', 'prepare c2 downloading', 'prepare c1 downloading',
      'prepare c3 downloading', 'prepare c1 preparing']);
    expect([...f.saved]).toEqual(['c0.', 'c1.', 'c2.', 'c3.']);
    expect(f.task).toMatchObject({ state: 'done', error: null, failed: [] });
    expect(warn.mock.calls).toEqual([
      ['Chapter c1 was not prepared ahead: Attempt 1 did not render.'],
      ['Chapter c1 was not prepared ahead: Attempt 2 did not render.'],
    ]);
    warn.mockRestore();
  });

  it('stops the download as before when the writer\'s own try fails too', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = book(3, { fetchTicks: () => 20, hooks: { prepare: (chapter) => { if (chapter === 'c1') throw new Error('Chapter 2 did not render.'); } } });
    await f.scheduler.run();
    expect(f.prepare.mock.calls.map(([, chapter]) => chapter.id)).toEqual(['c0', 'c1', 'c2', 'c1', 'c1']);
    expect([...f.saved]).toEqual(['c0.']);
    expect(f.task).toMatchObject({ state: 'blocked', error: 'Chapter 2 did not render.' });
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('reports nothing for a preparation ahead withdrawn because the download stopped', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // What the runtime's cancelInactivePreparation does when Pause all is tapped with a preparation out.
    const f = book(3, { fetchTicks: () => 5, hooks: { prepare: (chapter) => {
      if (chapter === 'c1') { f.task.state = 'paused'; throw new Error('Chapter preparation was stopped.'); }
    } } });
    await f.scheduler.run();
    expect(f.prepares()).toEqual(['prepare c0 preparing', 'prepare c1 downloading']);
    expect(f.task.state).toBe('paused');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it.each(['paused', 'deleted'] as const)('never writes a chapter %s while it is prepared ahead', async (action) => {
    const f = book(3, { fetchTicks: () => 5, hooks: { prepare: (chapter) => {
      if (chapter !== 'c1') return;
      if (action === 'paused') f.task.paused = ['c1']; else f.task.chapters = ['c0', 'c2'];
    } } });
    await f.scheduler.run();
    expect(f.prepares()).toContain('prepare c1 downloading');
    expect([...f.saved]).toEqual(['c0.', 'c2.']);
    expect(f.task.failed).toEqual([]);
    expect(f.task.state).toBe(action === 'paused' ? 'paused' : 'done');
  });

  it('stops preparing ahead when the download is removed', async () => {
    const tasks: DownloadTask[] = [];
    const f = book(4, { fetchTicks: () => 5, hooks: { prepare: (chapter) => { if (chapter === 'c1') tasks.splice(0); } } });
    tasks.push(f.task);
    const scheduler = createScheduler({ tasks: () => tasks, plan: () => f.plan(), changed: () => {}, connected: () => true, allowed: () => true,
      foreground: () => true, exists: () => false, prepare: f.prepare, fetch: f.fetch, wait: async () => {} });
    await scheduler.run();
    expect(f.prepares()).toEqual(['prepare c0 preparing', 'prepare c1 downloading']);
    expect(f.fetch.mock.calls.map(([, text]) => text)).toEqual(['c0.']);
    expect(tasks).toEqual([]);
  });
});
