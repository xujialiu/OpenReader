import { SynthesisError } from '../core/providers/errors';
import type { Chapter, DownloadTask, NarrationPlan } from './model';

export interface SchedulerDeps {
  tasks(): DownloadTask[];
  plan(document: string): NarrationPlan | null | Promise<NarrationPlan | null>;
  changed(): void | Promise<void>;
  connected(): boolean;
  allowed(): boolean;
  exists(task: DownloadTask, text: string): boolean | Promise<boolean>;
  fetch(task: DownloadTask, text: string, chapter: string): Promise<void>;
  load?(task: DownloadTask, chapter: Chapter): Promise<Chapter>;
  /** One chapter's text, from the hidden rendering, which answers one request at a time; the scheduler never has two out. */
  prepare?(task: DownloadTask, chapter: Chapter): Promise<Chapter>;
  /** Whether the app is in the foreground, the only place `prepare` completes (#76); true when absent. */
  foreground?(): boolean;
  /** Chapters whose every text is already saved for the task's voice, asked once per run so resuming skips them without loading their text. */
  completed?(task: DownloadTask): Promise<ReadonlySet<string>>;
  /** How many texts may be requested at once, across the chapters being written; one when absent. Read each time a place is to be filled (#311). */
  concurrency?(task: DownloadTask): number;
  wait(ms: number): Promise<void>;
}

/**
 * A chapter's text was not prepared because the app is not in the foreground:
 * away from the screen the hidden rendering never answers, and the request only
 * timed out (#76). Thrown for a preparation not asked for, and by the runtime
 * for one abandoned as the app left. The download waits as `interrupted` and
 * goes on when the app returns; it is not a failure.
 */
export class PreparationInterrupted extends Error {
  constructor() {
    super('Chapter preparation waits for the app to return to the foreground.');
    this.name = 'PreparationInterrupted';
  }
}

/** One pass at a time, with durable progress owned by stored clips. Every
 * await is a cancellation boundary; removing a task never resurrects it on
 * completion.
 *
 * Up to `concurrency` texts are requested at once (#64), taken in the order of
 * the chapters and carried past the end of one chapter into the next (#311):
 * when the chapters being written have fewer texts left to send than may be
 * out, the next chapter is begun, so the provider is never asked for fewer
 * than the owner's number while anything of the download is left.
 *
 * While the app is in the foreground and a chapter is written, the text of
 * every chapter it will write is prepared, one after another, so that away from
 * the screen those can be written too (#76; every chapter, not the next ten,
 * by the owner's choice of 2026-09-28). The writer and
 * that preparation share one path with one preparation out at a time, and the
 * writer waits only for the chapter it needs next. Away from the screen nothing
 * is prepared: a chapter that is not prepared makes the task `interrupted`, and
 * the runtime queues it again when the app returns.
 *
 * A document's chapters are written in the order of its list, which is the
 * plan's, whatever order they were chosen in, and the next one is chosen afresh
 * each time (#56): a chapter the owner pauses is left at the next await and
 * passed over until it is resumed, and one resumed above the chapters being
 * written comes straight after them. When only paused chapters are left, the
 * task is `paused` and the next document's download has its turn. */
export function createScheduler(deps: SchedulerDeps) {
  let running = false;
  const active = (task: DownloadTask) => deps.tasks().includes(task) && ['downloading', 'preparing'].includes(task.state);
  const foreground = () => deps.foreground?.() ?? true;
  /** Preparations asked for and not yet settled, one per chapter, whoever asked. */
  const preparations = new Map<string, Promise<Chapter>>();
  /** Settles when the last preparation asked for has; the next starts only then. */
  let latest: Promise<unknown> = Promise.resolve();
  /**
   * The one way a chapter is prepared (#76): the runtime holds a single
   * request, so a second one out would replace the first. A chapter already
   * asked for is waited for rather than asked for again. Checked for the
   * foreground as it starts, so nothing is asked for away from the screen.
   */
  function prepare(task: DownloadTask, chapter: Chapter): Promise<Chapter> {
    const key = JSON.stringify([task.document, chapter.id]);
    const out = preparations.get(key);
    if (out) return out;
    const flight = latest.then(() => {
      if (!foreground()) throw new PreparationInterrupted();
      return deps.prepare!(task, chapter);
    });
    latest = flight.catch(() => {});
    preparations.set(key, flight);
    const settled = () => { if (preparations.get(key) === flight) preparations.delete(key); };
    flight.then(settled, settled);
    return flight;
  }
  /**
   * The task being written, its chapters finished in this pass, and what its
   * preparation ahead did: the chapters it prepared, and how many times each
   * chapter it could not prepare failed. Null between passes.
   */
  interface Pass { task: DownloadTask; finished: Set<string>; prepared: Set<string>; failures: Map<string, number> }
  let pass: Pass | null = null;
  /** Wakes the pass's window to look again: `run` was called during it. Null between passes. */
  let nudge: (() => void) | null = null;
  let ahead: Promise<void> | null = null;
  /** Asked again while the preparation ahead goes on: it starts again from the top of the list. */
  let rewind = false;
  /** A preparation ahead fails this many times before the chapter is left to the writer. */
  const TRIES_AHEAD = 2;
  /**
   * Where, from `from` on, the next chapter to prepare ahead is in the list,
   * or -1: a chapter the writer will take after the ones it is on (in the task,
   * not finished, failed or paused), not yet prepared, and not given up on
   * ahead. Sets, because a whole long document can be one download (2,077
   * chapters, notes/NOTES_2026-09-20.md): a step costs one look at the task's
   * lists and at the chapters it passes, never a walk over the task per chapter.
   */
  function nextAhead({ task, finished, prepared, failures }: Pass, plan: NarrationPlan, from: number): number {
    const chosen = new Set(task.chapters);
    const failed = new Set(task.failed);
    const paused = new Set(task.paused);
    const writing = new Set(task.writing);
    for (let at = from; at < plan.chapters.length; at++) {
      const { id, prepared: ready } = plan.chapters[at];
      if (ready === false && chosen.has(id) && !writing.has(id) && !finished.has(id) && !failed.has(id) && !paused.has(id)
        && !prepared.has(id) && (failures.get(id) ?? 0) < TRIES_AHEAD) return at;
    }
    return -1;
  }
  /**
   * Prepares every chapter the writer will take that is not prepared, one at a
   * time and in the list's order, while the task runs and the app is in the
   * foreground. It goes on down the list from where it was, and starts again
   * from the top whenever it is asked for during it, since a chapter resumed or
   * added may be above it. It stops at a preparation abandoned as the app left,
   * and starts again at the next `run` in the foreground.
   *
   * A preparation that fails is tried once more after the chapter that follows
   * it, or at once when none does, so that one passing failure does not stop a
   * download away from the screen at that chapter. After a second failure the
   * chapter is left to the writer, which asks for it again when it is its turn
   * and records a failure as before. Nothing on the screen shows a failure
   * ahead, so each is logged, by chapter and message: one on the simulator
   * ended after 0.59 s with the app in front and left no trace of why
   * (notes/NOTES_2026-09-28.md, 05:01). A request withdrawn because the task
   * stopped is not a failure to report.
   *
   * Started as each chapter is begun and when `run` is called during a pass.
   */
  function prepareAhead() {
    if (!pass || !deps.prepare) return;
    if (ahead) { rewind = true; return; }
    const walk = pass;
    const { task, prepared, failures } = walk;
    const going = () => active(task) && deps.allowed() && foreground();
    rewind = false;
    ahead = (async () => {
      let from = 0;
      /** Where a chapter that failed once waits to be tried again, after the next preparation. */
      let again: number | null = null;
      while (going()) {
        const plan = await deps.plan(task.document);
        if (!plan || !going()) return;
        if (rewind) { rewind = false; from = 0; }
        const at = nextAhead(walk, plan, from);
        if (at < 0) {
          if (again === null) return;
          from = again; again = null;
          continue;
        }
        const chapter = plan.chapters[at];
        const waiting = again;
        let failedFirst = false;
        try { await prepare(task, chapter); prepared.add(chapter.id); }
        catch (error) {
          if (error instanceof PreparationInterrupted || !active(task)) return;
          const times = (failures.get(chapter.id) ?? 0) + 1;
          failures.set(chapter.id, times);
          failedFirst = times < TRIES_AHEAD;
          console.warn(`Chapter ${chapter.id} was not prepared ahead: ${error instanceof Error ? error.message : String(error)}`);
        }
        from = at + 1;
        if (waiting !== null) { from = Math.min(from, waiting); again = failedFirst ? at : null; }
        else if (failedFirst) again = at;
      }
    })().catch(() => {}).finally(() => { ahead = null; }); // A plan that cannot be read is the writer's to report.
  }
  /** Failures that stop the whole download rather than one chapter: no chapter failed (#109). */
  const STOPS_ALL: readonly string[] = ['auth', 'no-key', 'quota', 'declined'];
  /**
   * What happens to a task when a failure is met: a lost connection makes it
   * wait for the network, a key, quota, refusal or anything that is not a
   * provider's own failure (the store, a preparation) blocks it, and any other
   * provider failure fails the chapter it came from.
   */
  async function record(task: DownloadTask, chapter: string, error: unknown) {
    task.error = error instanceof Error ? error.message : String(error);
    if (!deps.connected()) { task.state = 'waiting'; task.error = 'No network connection, waiting to reconnect'; }
    else if (!(error instanceof SynthesisError) || STOPS_ALL.includes(error.kind)) task.state = 'blocked';
    else if (!task.failed.includes(chapter)) task.failed.push(chapter);
    await deps.changed();
  }
  /** A chapter being written in a pass. */
  interface Begun {
    id: string;
    /** Its texts, each once (a text it holds twice is asked for once); null until its text is prepared and loaded. */
    texts: string[] | null;
    /** How many of `texts` have been taken, and how many of those are out. */
    taken: number;
    out: number;
    /** Takes no more: paused or removed while it was written, failed, or never loaded. */
    stopped: boolean;
    /** The writer is preparing its text: the chapter whose ring spins. */
    preparing: boolean;
    /** Its own first failure, recorded once its requests out have settled. */
    error?: unknown;
  }
  /**
   * Writes the task's chapters through one window of up to `concurrency`
   * requests (#311). A place that is free goes to the next text of the
   * chapters already begun, in the order they were begun; when they have none
   * left to send, the next chapter is begun, which is the first in the list
   * that is in the task and not finished, failed, paused or begun (#56), and
   * which is prepared first if its text is not (#76). One chapter is begun at a
   * time. The number is read each time a place is to be filled, so a lower one
   * lets the requests out finish, and a higher one is used at the next look,
   * which `run` asks for at once.
   *
   * Before each text, what the single loop checked is checked: the chapter is
   * still in the task and not paused, the scheduler is allowed, the device is
   * online. A chapter paused or removed takes no more and keeps what its
   * requests out bring, and its places go to the chapters after it. A
   * provider's failure of one text, once its retries are spent, stops its own
   * chapter, which is recorded as failed once its other requests have settled;
   * the others go on. A failure that is not one chapter's (a key, quota,
   * refusal, the store, a chapter's preparation, the network) stops the whole
   * window, and is recorded once nothing is out. A failure met after its
   * chapter was paused or removed is not that chapter's to record.
   *
   * Away from the screen the window does not begin a chapter whose text is not
   * prepared: the chapters begun are finished, and the pass ends `interrupted`.
   *
   * Settles only once nothing is out and nothing is being begun, so the next
   * pass never overlaps this one. Answers the plan it read last, and whether it
   * stopped because the app was away; rejects only when the plan cannot be read.
   */
  async function write(task: DownloadTask, walk: Pass): Promise<{ plan: NarrationPlan | null; away: boolean }> {
    const { finished } = walk;
    const begun: Begun[] = [];
    let out = 0;
    let plan: NarrationPlan | null = null;
    // Set inside the callbacks below, so declared through `as` rather than narrowed to null here.
    /** The first failure that stops the whole window, and the chapter it came from. */
    let halt = null as { chapter: string; error: unknown } | null;
    /** The plan could not be read: thrown once nothing is out, as the single loop let it through. */
    let unreadable = null as { error: unknown } | null;
    /** No chapter was left to begin when last looked; looked at again when `run` is called or a chapter ends unfinished. */
    let ended = false as boolean;
    /** The next chapter's text is not prepared, and the app is away from the screen. */
    let away = false as boolean;
    let beginning = null as Promise<void> | null;
    let wake = null as (() => void) | null;
    const poke = () => { const resolve = wake; wake = null; resolve?.(); };
    nudge = () => { ended = false; away = false; poke(); };

    /** Still a chapter of this download that may be written: the task runs, and the chapter is in it and not paused. */
    const here = (id: string) => active(task) && task.chapters.includes(id) && !task.paused?.includes(id);
    const going = () => active(task) && deps.allowed() && !halt && !unreadable;
    const width = () => Math.max(1, Math.floor(deps.concurrency?.(task) ?? 1) || 1);
    /** Every chapter being written, for the drawer and the Live Activity; replaced, never changed in place. */
    const publish = () => { task.writing = begun.map((b) => b.id); };

    function fail(b: Begun, error: unknown) {
      b.stopped = true;
      // Paused or removed while its request was out: that failure is no longer this chapter's to record (#56).
      if (!active(task) || !here(b.id)) return;
      if (!deps.connected() || !(error instanceof SynthesisError) || STOPS_ALL.includes(error.kind)) halt ??= { chapter: b.id, error };
      else b.error ??= error;
    }
    function launch(b: Begun, text: string) {
      out++; b.out++;
      void (async () => {
        try {
          if (await deps.exists(task, text)) return;
          // A text not sent leaves its chapter unfinished in this pass.
          if (!here(b.id) || !going() || b.stopped) { b.stopped = true; return; }
          for (let attempt = 0; ; attempt++) {
            try { await deps.fetch(task, text, b.id); break; }
            catch (error) {
              if (!active(task) || !deps.connected() || !(error instanceof SynthesisError) || !error.retriable || attempt >= 2) throw error;
              await deps.wait(1000 * (attempt + 1));
              if (!here(b.id) || !going() || b.stopped) { b.stopped = true; return; }
            }
          }
          await deps.changed();
        } catch (error) { fail(b, error); }
        finally { out--; b.out--; poke(); }
      })();
    }
    /** The next text to send, from the chapters begun in the order they were begun. */
    function take(): { b: Begun; text: string } | null {
      for (const b of begun) {
        // A chapter with every text out is left to finish: paused then, it is finished once they are back.
        if (b.stopped || b.texts === null || b.taken >= b.texts.length) continue;
        if (!here(b.id)) { b.stopped = true; continue; }
        return { b, text: b.texts[b.taken++] };
      }
      return null;
    }
    async function begin() {
      try { plan = await deps.plan(task.document); }
      catch (error) { unreadable = { error }; return; }
      if (!going()) return;
      const failed = new Set(task.failed);
      const paused = new Set(task.paused);
      const chosen = new Set(task.chapters);
      const writing = new Set(begun.map((b) => b.id));
      let chapter = plan?.chapters.find(({ id }) => chosen.has(id) && !finished.has(id) && !failed.has(id) && !paused.has(id) && !writing.has(id));
      if (!chapter) { ended = true; return; }
      const b: Begun = { id: chapter.id, texts: null, taken: 0, out: 0, stopped: false, preparing: false };
      try {
        if (chapter.prepared === false) {
          if (!deps.prepare) throw new Error('Chapter text is not prepared.');
          // Away from the screen nothing is prepared (#76): the window goes no further.
          if (!foreground()) { away = true; return; }
          b.preparing = true; begun.push(b); publish();
          if (out === 0) task.state = 'preparing';
          await deps.changed();
          chapter = await prepare(task, chapter);
          b.preparing = false;
          if (!active(task)) return;
          if (task.state === 'preparing') task.state = 'downloading';
          await deps.changed();
          if (!here(b.id)) return;
        }
        if (deps.load) chapter = await deps.load(task, chapter);
        if (!here(b.id)) return;
        b.texts = [...new Set(chapter.texts)];
        if (!begun.includes(b)) { begun.push(b); publish(); }
        prepareAhead();
      } catch (error) {
        if (!active(task) || !here(b.id)) return;
        if (error instanceof PreparationInterrupted) {
          // Back already: the next look asks again. Otherwise wait for the app, which queues the task again on its return.
          if (!foreground()) away = true;
          return;
        }
        halt ??= { chapter: b.id, error };
      } finally {
        b.preparing = false;
        if (b.texts === null) b.stopped = true;
      }
    }
    /** Ends every chapter with nothing out: finished when every text went through, its failure recorded when it has one. */
    async function settle() {
      for (const b of [...begun]) {
        if (b.out > 0 || b.preparing) continue;
        if (!b.stopped && b.texts !== null && b.taken < b.texts.length) continue;
        if (b.texts === null && !b.stopped) continue;
        begun.splice(begun.indexOf(b), 1);
        if (b.stopped) ended = false;
        else finished.add(b.id);
        if (b.error !== undefined && active(task) && here(b.id)) await record(task, b.id, b.error);
      }
      publish();
    }

    try {
      for (;;) {
        await settle();
        if (out === 0 && !beginning) {
          if (unreadable) throw unreadable.error;
          if (halt) {
            const { chapter, error } = halt;
            halt = null;
            if (!active(task)) break;
            // Paused or removed while it was met: not its to record, and the next chapter meets it again if it lasts.
            if (here(chapter)) await record(task, chapter, error);
            continue;
          }
        }
        if (going() && !beginning) {
          while (out < width()) {
            if (!deps.connected()) { task.state = 'waiting'; task.error = 'No network connection, waiting to reconnect'; break; }
            const next = take();
            if (next) { launch(next.b, next.text); continue; }
            if (!ended && !away) beginning = begin().finally(() => { beginning = null; poke(); });
            break;
          }
        }
        // Preparing only while nothing is out and the download waits for a chapter's text; downloading otherwise.
        if (active(task)) {
          const state = out === 0 && begun.some((b) => b.preparing) ? 'preparing' : 'downloading';
          if (task.state !== state) { task.state = state; await deps.changed(); continue; }
        }
        if (out === 0 && !beginning) {
          if (!going() || ended) break;
          if (away) { if (foreground()) { away = false; continue; } break; }
        }
        await new Promise<void>((resolve) => { wake = resolve; });
      }
    } finally { nudge = null; }
    return { plan, away };
  }
  async function run() {
    // Asked again during a pass, as when the app returns to the foreground, a chapter is resumed or the owner's
    // number changes: the preparation ahead goes on, from the top of the list, and the window looks again.
    if (running) { prepareAhead(); nudge?.(); return; }
    if (!deps.allowed()) return;
    running = true;
    try {
      for (;;) {
        if (!deps.allowed()) break;
        const task = deps.tasks().find((t) => t.state === 'queued');
        if (!task) break;
        if (!deps.connected()) { task.state = 'waiting'; await deps.changed(); continue; }
        const plan = await deps.plan(task.document);
        if (!deps.tasks().includes(task) || task.state !== 'queued') continue;
        if (!deps.allowed()) break;
        if (!plan) { task.state = 'blocked'; task.error = 'Reopen Download to prepare the chapter list.'; await deps.changed(); continue; }
        // A restored task still names the chapters it was on; nothing is being written until one is begun below.
        task.state = 'downloading'; task.error = null; task.writing = []; await deps.changed();
        // Complete before this pass, or finished in it: a prepared chapter with no
        // text is finished without ever counting as complete (ADR 0027), so it is
        // remembered here rather than chosen again.
        const finished = new Set(await deps.completed?.(task));
        pass = { task, finished, prepared: new Set(), failures: new Map() };
        let last: NarrationPlan | null = plan;
        let away = false;
        try { ({ plan: last, away } = await write(task, pass)); }
        finally { task.writing = []; }
        if (active(task)) {
          // Sets, because a whole long book can be one task.
          const chosen = new Set(task.chapters);
          const failed = new Set(task.failed);
          const paused = new Set(task.paused);
          /** A chapter still to write that the owner paused: then the task is paused, not done. */
          const pausedLeft = last?.chapters.some(({ id }) => chosen.has(id) && !finished.has(id) && !failed.has(id) && paused.has(id));
          if (!deps.allowed()) task.state = 'interrupted';
          else if (away) { task.state = 'interrupted'; task.error = null; }
          else task.state = pausedLeft ? 'paused' : 'done';
        }
        await deps.changed();
        // A preparation ahead still out is withdrawn by the runtime once the task no longer runs.
        pass = null;
        await ahead;
      }
    } finally { running = false; pass = null; }
  }
  return { run };
}
