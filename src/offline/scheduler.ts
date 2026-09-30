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
  /** How many of a chapter's texts may be requested at once; one when absent. Read as each chapter starts. */
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
 * Chapters are written one at a time; inside the one being written, up to
 * `concurrency` of its texts are requested at once (#64).
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
 * passed over until it is resumed, and one resumed above the chapter being
 * written comes straight after it. When only paused chapters are left, the
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
  let ahead: Promise<void> | null = null;
  /** Asked again while the preparation ahead goes on: it starts again from the top of the list. */
  let rewind = false;
  /** A preparation ahead fails this many times before the chapter is left to the writer. */
  const TRIES_AHEAD = 2;
  /**
   * Where, from `from` on, the next chapter to prepare ahead is in the list,
   * or -1: a chapter the writer will take after the one it is on (in the task,
   * not finished, failed or paused), not yet prepared, and not given up on
   * ahead. Sets, because a whole long document can be one download (2,077
   * chapters, notes/NOTES_2026-09-20.md): a step costs one look at the task's
   * lists and at the chapters it passes, never a walk over the task per chapter.
   */
  function nextAhead({ task, finished, prepared, failures }: Pass, plan: NarrationPlan, from: number): number {
    const chosen = new Set(task.chapters);
    const failed = new Set(task.failed);
    const paused = new Set(task.paused);
    for (let at = from; at < plan.chapters.length; at++) {
      const { id, prepared: ready } = plan.chapters[at];
      if (ready === false && chosen.has(id) && id !== task.current && !finished.has(id) && !failed.has(id) && !paused.has(id)
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
   * Started as each chapter is written and when `run` is called during a pass.
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
  /**
   * One chapter's texts, with up to `concurrency` requests out at once (#64);
   * a text the chapter holds twice is asked for once. Before each text every
   * worker checks what the single loop checked: still the chapter's turn, the
   * scheduler allowed, the device online. The first worker to stop or fail
   * stops the others taking more, and this settles only when every request
   * out has settled, so the next chapter never overlaps this one and a failure
   * is met once. Whether every text went through; rejects with the first
   * failure.
   */
  async function write(task: DownloadTask, chapter: string, texts: readonly string[], here: () => boolean): Promise<boolean> {
    const queue = [...new Set(texts)];
    let taken = 0;
    let whole = true;
    /** Failures in the order they came; the first is the chapter's. */
    const failures: unknown[] = [];
    /** Still this chapter's turn, and no worker has stopped. */
    const going = () => {
      if (!here() || !deps.allowed()) whole = false;
      return whole && !failures.length;
    };
    // A worker never rejects: what it throws is recorded, so every worker has
    // returned before the chapter's failure is handled.
    const worker = async () => {
      try {
        while (taken < queue.length && going()) {
          if (!deps.connected()) { task.state = 'waiting'; task.error = 'No network connection, waiting to reconnect'; whole = false; return; }
          const text = queue[taken++];
          if (await deps.exists(task, text)) continue;
          if (!going()) return;
          for (let attempt = 0; ; attempt++) {
            try { await deps.fetch(task, text, chapter); break; }
            catch (error) {
              if (!active(task) || !deps.connected() || !(error instanceof SynthesisError) || !error.retriable || attempt >= 2) throw error;
              await deps.wait(1000 * (attempt + 1));
              if (!going()) return;
            }
          }
          await deps.changed();
        }
      } catch (error) { failures.push(error); }
    };
    const width = Math.max(1, Math.min(queue.length, Math.floor(deps.concurrency?.(task) ?? 1) || 1));
    await Promise.all(Array.from({ length: width }, worker));
    if (failures.length) throw failures[0];
    return whole;
  }
  async function run() {
    // Asked again during a pass, as when the app returns to the foreground or a chapter is resumed: the
    // preparation ahead goes on, from the top of the list.
    if (running) { prepareAhead(); return; }
    if (!deps.allowed()) return;
    running = true;
    try {
      for (;;) {
        if (!deps.allowed()) break;
        const task = deps.tasks().find((t) => t.state === 'queued');
        if (!task) break;
        if (!deps.connected()) { task.state = 'waiting'; await deps.changed(); continue; }
        let plan = await deps.plan(task.document);
        if (!deps.tasks().includes(task) || task.state !== 'queued') continue;
        if (!deps.allowed()) break;
        if (!plan) { task.state = 'blocked'; task.error = 'Reopen Download to prepare the chapter list.'; await deps.changed(); continue; }
        // A restored task still names the chapter it was on; nothing is being written until one is chosen below.
        task.state = 'downloading'; task.error = null; task.current = null; await deps.changed();
        // Complete before this pass, or finished in it: a prepared chapter with no
        // text is finished without ever counting as complete (ADR 0027), so it is
        // remembered here rather than chosen again.
        const finished = new Set(await deps.completed?.(task));
        pass = { task, finished, prepared: new Set(), failures: new Map() };
        /** The chapters still to write, and whether each is one the owner paused; sets, because a whole long book can be one task. */
        const unfinished = () => {
          const failed = new Set(task.failed);
          const paused = new Set(task.paused);
          const left = new Map<string, boolean>();
          for (const id of task.chapters) if (!finished.has(id) && !failed.has(id)) left.set(id, paused.has(id));
          return left;
        };
        for (;;) {
          if (!active(task) || !deps.allowed()) break;
          plan = await deps.plan(task.document);
          if (!active(task) || !deps.allowed()) break;
          const left = unfinished();
          let chapter = plan?.chapters.find((c) => left.get(c.id) === false);
          if (!chapter) break;
          const chapterId = chapter.id;
          /** Still this chapter's turn: the task runs, and the chapter is in it and not paused. */
          const here = () => active(task) && task.chapters.includes(chapterId) && !task.paused?.includes(chapterId);
          task.current = chapterId;
          try {
            if (chapter.prepared === false) {
              if (!deps.prepare) throw new Error('Chapter text is not prepared.');
              if (!foreground()) throw new PreparationInterrupted();
              task.state = 'preparing'; await deps.changed();
              chapter = await prepare(task, chapter);
              if (!active(task)) break;
              task.state = 'downloading'; await deps.changed();
              if (!here()) continue;
            }
            if (deps.load) chapter = await deps.load(task, chapter);
            if (!here()) continue;
            prepareAhead();
            if (await write(task, chapterId, chapter.texts, here)) finished.add(chapterId);
          } catch (error) {
            if (!active(task)) break;
            // Paused or removed while its request was out: that failure is no longer this chapter's to record.
            if (!here()) continue;
            if (error instanceof PreparationInterrupted) {
              // Back already: ask again. Otherwise wait for the app, which queues the task again on its return.
              if (foreground()) continue;
              task.state = 'interrupted'; task.error = null;
              break;
            }
            task.error = error instanceof Error ? error.message : String(error);
            if (!deps.connected()) { task.state = 'waiting'; task.error = 'No network connection, waiting to reconnect'; }
            // A Provider the owner did not allow stops the whole download, as a missing key does (#109): no chapter failed.
            else if (!(error instanceof SynthesisError) || ['auth', 'no-key', 'quota', 'declined'].includes(error.kind)) task.state = 'blocked';
            else if (!task.failed.includes(chapterId)) task.failed.push(chapterId);
            await deps.changed();
          }
        }
        task.current = null;
        if (active(task)) {
          const left = unfinished();
          task.state = !deps.allowed() ? 'interrupted' : plan?.chapters.some((c) => left.get(c.id)) ? 'paused' : 'done';
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
