import { type DownloadTask, type NarrationPlan, speaks } from './model';

/** Not yet inspected is not empty. Missing plan entries remain unknown too. */
export function emptyChapters(plan: NarrationPlan | null): ReadonlySet<string> {
  return new Set(plan?.chapters.filter((chapter) => !speaks(chapter)).map((chapter) => chapter.id));
}

/** Actual saved coverage, not permission to fetch missing audio. Empty parts
 * finish work but never acquire a Downloaded check. Recheck holds are not
 * treated as saved: they forbid requests, not evidence of completeness. */
export function selectionComplete(task: DownloadTask, plan: NarrationPlan | null, complete: ReadonlySet<string>): boolean {
  const empty = emptyChapters(plan);
  return task.chapters.every((id) => complete.has(id) || empty.has(id));
}

/** Called only after outstanding work has settled, or for a stopped task.
 * This cannot queue work or change the saved audio/ownership. */
export function finishSelection(task: DownloadTask): void {
  task.state = 'done';
  task.error = null;
  task.failed = [];
  task.paused = [];
}
