import type { DownloadTask, TaskState } from './model';

/**
 * Who stops a download, and what a tap starts again (#56, design 0027).
 *
 * A ring pauses and resumes its own chapter; Pause all and Resume all act on
 * every chapter of the download. The task's state stays what the scheduler and
 * the drawer read: `paused` means every chapter left is one the owner paused,
 * and `blocked` or `interrupted` mean the whole download stopped by itself.
 * Pure, so the suite checks the rules without the runtime around them.
 */

/** States in which the download goes on by itself. */
export const GOES_ON: readonly TaskState[] = ['queued', 'preparing', 'downloading', 'waiting'];
/** States in which the whole download stopped by itself and waits for the owner. */
const STOPPED: readonly TaskState[] = ['blocked', 'interrupted'];

export const isPaused = (task: DownloadTask, chapter: string) => !!task.paused?.includes(chapter);

/** The chapters still to be written: in the download, not failed, not already complete. */
function left(task: DownloadTask, complete: ReadonlySet<string>): string[] {
  const failed = new Set(task.failed);
  return task.chapters.filter((id) => !failed.has(id) && !complete.has(id));
}

/** Whether some chapter of the download would go on by itself, so Pause all is offered rather than Resume all. */
export function goesOn(task: DownloadTask, complete: ReadonlySet<string>): boolean {
  if (!GOES_ON.includes(task.state)) return false;
  const paused = new Set(task.paused);
  return left(task, complete).some((id) => !paused.has(id));
}

/**
 * A tap on one chapter's ring. While the download goes on, it pauses or
 * resumes that chapter alone, and pausing the last chapter going on pauses the
 * download. A paused download resumes with that one chapter. A download that
 * stopped by itself continues whole, as every tap did before chapters could be
 * paused one by one, and the tapped chapter goes on with it.
 */
export function tapChapter(task: DownloadTask, chapter: string, complete: ReadonlySet<string>): void {
  if (task.state === 'done') return;
  if (STOPPED.includes(task.state)) {
    task.paused = (task.paused ?? []).filter((id) => id !== chapter);
    task.state = 'queued'; task.error = null; task.failed = [];
    return;
  }
  if (task.state === 'paused') {
    // Every chapter left is paused, whichever way it got there; this one goes on.
    task.paused = left(task, complete).filter((id) => id !== chapter);
    task.state = 'queued'; task.error = null;
    return;
  }
  const paused = new Set(task.paused);
  if (!paused.delete(chapter)) paused.add(chapter);
  task.paused = [...paused];
  const rest = left(task, complete);
  if (rest.length && rest.every((id) => paused.has(id))) { task.state = 'paused'; task.error = null; }
}

/** Pause all: every chapter of the download is paused, and the download with them. */
export function pauseAll(task: DownloadTask): void {
  const failed = new Set(task.failed);
  task.paused = task.chapters.filter((id) => !failed.has(id));
  task.state = 'paused'; task.error = null;
}

/** Resume all, and Retry failed: every chapter goes on, failed ones included, and whatever stopped the download is cleared. */
export function resumeAll(task: DownloadTask): void {
  task.paused = [];
  task.state = 'queued'; task.error = null; task.failed = [];
}
