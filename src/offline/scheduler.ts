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
 * cancellation boundary; removing a task never resurrects it on completion. */
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
        const plan = await deps.plan(task.document);
        if (!deps.tasks().includes(task) || task.state !== 'queued') continue;
        if (!deps.allowed()) break;
        if (!plan) { task.state = 'blocked'; task.error = 'Reopen Download to prepare the chapter list.'; await deps.changed(); continue; }
        // A restored task still names the chapter it was on; nothing is being written until one is chosen below.
        task.state = 'downloading'; task.error = null; task.current = null; await deps.changed();
        const completed = (await deps.completed?.(task)) ?? new Set<string>();
        for (const chapterId of [...task.chapters]) {
          if (!active(task)) break;
          if (!task.chapters.includes(chapterId) || completed.has(chapterId)) continue;
          let chapter = (await deps.plan(task.document))?.chapters.find((c) => c.id === chapterId);
          if (!active(task)) break;
          if (!chapter) continue;
          task.current = chapterId;
          try {
            if (chapter.prepared === false) {
              if (!deps.prepare) throw new Error('Chapter text is not prepared.');
              task.state = 'preparing'; await deps.changed();
              chapter = await deps.prepare(task, chapter);
              if (!active(task)) break;
              task.state = 'downloading'; await deps.changed();
              if (!task.chapters.includes(chapterId)) continue;
            }
            if (deps.load) chapter = await deps.load(task, chapter);
            if (!active(task) || !task.chapters.includes(chapterId)) break;
            for (const text of chapter.texts) {
              if (!active(task) || !task.chapters.includes(chapterId) || !deps.allowed()) break;
              if (!deps.connected()) { task.state = 'waiting'; task.error = 'No network connection, waiting to reconnect'; break; }
              if (await deps.exists(task, text)) continue;
              if (!active(task) || !task.chapters.includes(chapterId) || !deps.allowed()) break;
              for (let attempt = 0; ; attempt++) {
                try { await deps.fetch(task, text, chapterId); break; }
                catch (error) {
                  if (!active(task) || !deps.connected() || !(error instanceof SynthesisError) || !error.retriable || attempt >= 2) throw error;
                  await deps.wait(1000 * (attempt + 1));
                  if (!active(task) || !task.chapters.includes(chapterId) || !deps.allowed()) break;
                }
              }
              await deps.changed();
            }
          } catch (error) {
            if (!active(task)) break;
            task.error = error instanceof Error ? error.message : String(error);
            if (!deps.connected()) { task.state = 'waiting'; task.error = 'No network connection, waiting to reconnect'; }
            else if (!(error instanceof SynthesisError) || ['auth', 'no-key', 'quota'].includes(error.kind)) task.state = 'blocked';
            else if (!task.failed.includes(chapterId)) task.failed.push(chapterId);
            await deps.changed();
          }
        }
        task.current = null;
        if (active(task)) task.state = deps.allowed() ? 'done' : 'interrupted';
        await deps.changed();
      }
    } finally { running = false; }
  }
  return { run };
}
