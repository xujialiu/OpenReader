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

/**
 * How many of the chapters the scheduler will write next have their text
 * prepared ahead while one is written (#76). Bounded, because a whole long
 * document can be one download (2,077 chapters, notes/NOTES_2026-09-20.md) and
 * each preparation renders a section and writes the catalogue: after the first
 * few, one chapter is prepared for each chapter written, as before (ADR 0027).
 */
export const PREPARED_AHEAD = 10;

/** One pass at a time, with durable progress owned by stored clips. Every
 * await is a cancellation boundary; removing a task never resurrects it on
 * completion.
 *
 * Chapters are written one at a time; inside the one being written, up to
 * `concurrency` of its texts are requested at once (#64).
 *
 * While the app is in the foreground and a chapter is written, the text of the
 * next `PREPARED_AHEAD` chapters it will write is prepared, one after another,
 * so that away from the screen those can be written too (#76). The writer and
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
  /** The task being written, its chapters finished in this pass, and what its preparation ahead did; null between passes. */
  let pass: { task: DownloadTask; finished: Set<string>; prepared: Set<string>; failed: Set<string> } | null = null;
  let ahead: Promise<void> | null = null;
  /**
   * The chapters the writer will take after the one it is on, in the list's
   * order: in the task and not finished, failed or paused; at most
   * `PREPARED_AHEAD` of them.
   */
  function following(plan: NarrationPlan, task: DownloadTask, finished: ReadonlySet<string>): Chapter[] {
    const chosen = new Set(task.chapters);
    const failed = new Set(task.failed);
    const paused = new Set(task.paused);
    const next: Chapter[] = [];
    for (const chapter of plan.chapters) {
      if (next.length >= PREPARED_AHEAD) break;
      const id = chapter.id;
      if (chosen.has(id) && id !== task.current && !finished.has(id) && !failed.has(id) && !paused.has(id)) next.push(chapter);
    }
    return next;
  }
  /**
   * Prepares the following chapters that are not prepared, one at a time, while
   * the task runs and the app is in the foreground. It stops at the first
   * preparation that does not succeed: an abandoned one is asked for again when
   * the app returns, and a failed one is left to the writer, which asks for it
   * again when it is that chapter's turn and records the failure as before.
   * Started as each chapter is written and when `run` is called during a pass.
   */
  function prepareAhead() {
    if (ahead || !pass || !deps.prepare) return;
    const { task, finished, prepared, failed } = pass;
    const going = () => active(task) && deps.allowed() && foreground();
    ahead = (async () => {
      while (going()) {
        const plan = await deps.plan(task.document);
        if (!plan || !going()) return;
        const next = following(plan, task, finished).find((c) => c.prepared === false && !prepared.has(c.id) && !failed.has(c.id));
        if (!next) return;
        try { await prepare(task, next); prepared.add(next.id); }
        catch (error) { if (!(error instanceof PreparationInterrupted)) failed.add(next.id); return; }
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
    // Asked again during a pass, as when the app returns to the foreground: the preparation ahead goes on.
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
        pass = { task, finished, prepared: new Set(), failed: new Set() };
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
            else if (!(error instanceof SynthesisError) || ['auth', 'no-key', 'quota'].includes(error.kind)) task.state = 'blocked';
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
