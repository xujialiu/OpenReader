import { SynthesisError } from '../core/providers/errors';
import type { DownloadTask, NarrationPlan } from './model';

export interface SchedulerDeps {
  tasks(): DownloadTask[];
  plan(document: string): NarrationPlan | null;
  changed(): void;
  connected(): boolean;
  allowed(): boolean;
  exists(task: DownloadTask, text: string): boolean;
  fetch(task: DownloadTask, text: string): Promise<void>;
  wait(ms: number): Promise<void>;
}

/** One worker, with durable progress owned by stored clips. Every await is a
 * cancellation boundary; removing a task never resurrects it on completion. */
export function createScheduler(deps: SchedulerDeps) {
  let running = false;
  const active = (task: DownloadTask) => deps.tasks().includes(task) && task.state === 'downloading';
  async function run() {
    if (running || !deps.allowed()) return;
    running = true;
    try {
      for (;;) {
        if (!deps.allowed()) break;
        const task = deps.tasks().find((t) => t.state === 'queued');
        if (!task) break;
        if (!deps.connected()) { task.state = 'waiting'; deps.changed(); continue; }
        const plan = deps.plan(task.document);
        if (!plan) { task.state = 'blocked'; task.error = 'Reopen Download to prepare the chapter list.'; deps.changed(); continue; }
        task.state = 'downloading'; task.error = null; deps.changed();
        for (const chapterId of [...task.chapters]) {
          if (!active(task)) break;
          const chapter = plan.chapters.find((c) => c.id === chapterId);
          if (!chapter) continue;
          try {
            for (const text of chapter.texts) {
              if (!active(task) || !deps.allowed()) break;
              if (!deps.connected()) { task.state = 'waiting'; task.error = 'No network connection, waiting to reconnect'; break; }
              if (deps.exists(task, text)) continue;
              for (let attempt = 0; ; attempt++) {
                try { await deps.fetch(task, text); break; }
                catch (error) {
                  if (!active(task) || !deps.connected() || !(error instanceof SynthesisError) || !error.retriable || attempt >= 2) throw error;
                  await deps.wait(1000 * (attempt + 1));
                  if (!active(task) || !deps.allowed()) break;
                }
              }
              deps.changed();
            }
          } catch (error) {
            if (!active(task)) break;
            task.error = error instanceof Error ? error.message : String(error);
            if (!deps.connected()) { task.state = 'waiting'; task.error = 'No network connection, waiting to reconnect'; }
            else if (!(error instanceof SynthesisError) || ['auth', 'no-key', 'quota'].includes(error.kind)) task.state = 'blocked';
            else if (!task.failed.includes(chapterId)) task.failed.push(chapterId);
            deps.changed();
          }
        }
        if (active(task)) task.state = deps.allowed() ? 'done' : 'interrupted';
        deps.changed();
      }
    } finally { running = false; }
  }
  return { run };
}
