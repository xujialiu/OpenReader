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
  prepare?(task: DownloadTask, chapter: Chapter): Promise<Chapter>;
  /** Chapters whose every text is already saved for the task's voice, asked once per run so resuming skips them without loading their text. */
  completed?(task: DownloadTask): Promise<ReadonlySet<string>>;
  /** How many of a chapter's texts may be requested at once; one when absent. Read as each chapter starts. */
  concurrency?(task: DownloadTask): number;
  wait(ms: number): Promise<void>;
}

/** One pass at a time, with durable progress owned by stored clips. Every
 * await is a cancellation boundary; removing a task never resurrects it on
 * completion.
 *
 * Chapters are written one at a time; inside the one being written, up to
 * `concurrency` of its texts are requested at once (#64).
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
    if (running || !deps.allowed()) return;
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
              task.state = 'preparing'; await deps.changed();
              chapter = await deps.prepare(task, chapter);
              if (!active(task)) break;
              task.state = 'downloading'; await deps.changed();
              if (!here()) continue;
            }
            if (deps.load) chapter = await deps.load(task, chapter);
            if (!here()) continue;
            if (await write(task, chapterId, chapter.texts, here)) finished.add(chapterId);
          } catch (error) {
            if (!active(task)) break;
            // Paused or removed while its request was out: that failure is no longer this chapter's to record.
            if (!here()) continue;
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
      }
    } finally { running = false; }
  }
  return { run };
}
