import { describe, expect, it, vi } from 'vitest';
import { createScheduler } from '../../src/offline/scheduler';
import { navigationPlan, withPreparedSection, type DownloadTask, type NarrationPlan } from '../../src/offline/model';
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
  it.each(['auth', 'quota', 'no-key'] as const)('pauses all remaining requests on %s', async (kind) => {
    const f = fixture(); f.fetch.mockRejectedValue(new SynthesisError(kind));
    await f.scheduler.run();
    expect(f.tasks[0].state).toBe('blocked'); expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('does not resurrect a removed task', async () => {
    const f = fixture(); f.fetch.mockImplementationOnce(async () => { f.tasks.splice(0); });
    await f.scheduler.run(); expect(f.tasks).toEqual([]); expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('yields to playback/background expiration and can resume without repeating saved audio', async () => {
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

it('prepares only selected late chapters and synthesizes each before preparing the next', async () => {
  let plan = navigationPlan({ sections: Array.from({ length: 2200 }, (_, i) => ({ href: `${i}.xhtml`, path: `${i}.xhtml` })),
    chapters: Array.from({ length: 2200 }, (_, i) => ({ id: `c${i}`, title: `Chapter ${i}`, parent: null, depth: 0, section: i, fragment: '' })) });
  const task: DownloadTask = { id: 'one', document: 'book', voice: { provider: 'fish', voice: 'A', label: 'A' },
    chapters: ['c2099', 'c2100'], state: 'queued', error: null, failed: [] };
  const events: string[] = [];
  const scheduler = createScheduler({ tasks: () => [task], plan: () => plan, changed: () => {}, connected: () => true, allowed: () => true,
    exists: () => false, wait: async () => {},
    prepare: async (_, chapter) => {
      expect(task.state).toBe('preparing'); events.push(`prepare ${chapter.id}`);
      const ready = { ...chapter, prepared: true, texts: [`Audio ${chapter.id}`] };
      plan = withPreparedSection(plan, chapter.section!, [ready]); return ready;
    },
    fetch: async (_, text) => { events.push(text); },
  });
  expect(events).toEqual([]);
  await scheduler.run();
  expect(events).toEqual(['prepare c2099', 'Audio c2099', 'prepare c2100', 'Audio c2100']);
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
