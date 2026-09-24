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
  wait(ms: number): Promise<void>;
}

/** One worker, with durable progress owned by stored clips. Every await is a
 * cancellation boundary; removing a task never resurrects it on completion.
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
          let whole = true;
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
            texts: for (const text of chapter.texts) {
              if (!here() || !deps.allowed()) { whole = false; break; }
              if (!deps.connected()) { task.state = 'waiting'; task.error = 'No network connection, waiting to reconnect'; whole = false; break; }
              if (await deps.exists(task, text)) continue;
              if (!here() || !deps.allowed()) { whole = false; break; }
              for (let attempt = 0; ; attempt++) {
                try { await deps.fetch(task, text, chapterId); break; }
                catch (error) {
                  if (!active(task) || !deps.connected() || !(error instanceof SynthesisError) || !error.retriable || attempt >= 2) throw error;
                  await deps.wait(1000 * (attempt + 1));
                  if (!here() || !deps.allowed()) { whole = false; break texts; }
                }
              }
              await deps.changed();
            }
            if (whole) finished.add(chapterId);
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
