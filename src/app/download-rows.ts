import { rowOfSection } from '../core/document/contents';
import type { ChapterProgress } from '../offline/catalog';
import { chapterTextCount, type Chapter, type DownloadTask, type TaskState } from '../offline/model';
import { isPaused } from '../offline/pausing';

/**
 * What the right-hand column of a chapter row shows, decided here so that the
 * drawer renders it and the suite can check it without rendering (test/README.md).
 *
 * The picture is the App Store's (design 0027, "Choose chapters or the whole
 * document"): a chapter that belongs to a download that has not finished carries
 * a ring whose arc is the chapter's saved clips over its text count, spinning
 * while the text is still being counted; a completed chapter carries a check;
 * anything else carries the selection circle, which behaves as a checkbox.
 *
 * With `manage` set the same rule lists what Manage downloads shows (#37): the
 * ring on the chapter being written, a checkbox on anything with a saved clip,
 * and nothing — `null` — for a chapter that occupies no space, because there is
 * nothing there to delete.
 */
export type Marker =
  | { kind: 'check' }
  | { kind: 'checkbox' }
  | { kind: 'ring'; fraction: number; spinning: boolean; halted: boolean };

/**
 * States in which the whole download waits for the owner: every ring holds a
 * triangle. In the others the download goes on by itself, and a ring holds the
 * square unless the owner paused its own chapter (#56).
 */
export const HALTED: readonly TaskState[] = ['paused', 'blocked', 'interrupted'];
/**
 * States in which the scheduler is writing a chapter and `task.current` names
 * it. Only these read `current`: a task restored after a restart comes back
 * `queued` still naming the chapter it was on, and stays so until a pass on it
 * begins, behind another document's download or while the scheduler is held
 * back (ADR 0027).
 */
export const WRITING: readonly TaskState[] = ['preparing', 'downloading'];

/** The chapter is in a download that has not finished, and has not failed in it. */
export const inTask = (chapter: Chapter, task: DownloadTask | undefined): task is DownloadTask =>
  !!task && task.state !== 'done' && task.chapters.includes(chapter.id) && !task.failed.includes(chapter.id);

export function marker(
  chapter: Chapter,
  progress: ChapterProgress | undefined,
  task: DownloadTask | undefined,
  manage: boolean,
): Marker | null {
  const count = progress?.count ?? 0;
  const total = chapterTextCount(chapter);
  const ring = (halted: boolean): Marker => ({
    kind: 'ring',
    fraction: total > 0 ? Math.min(1, count / total) : 0,
    // Only while the text is being counted is there no fraction to show; the
    // scheduler names that chapter (ADR 0027), so it is never guessed from order.
    spinning: !!task && task.state === 'preparing' && task.current === chapter.id,
    halted,
  });
  if (manage) {
    if (inTask(chapter, task) && WRITING.includes(task.state) && task.current === chapter.id) return ring(false);
    return count > 0 ? { kind: 'checkbox' } : null;
  }
  if (progress?.complete) return { kind: 'check' };
  if (inTask(chapter, task)) return ring(HALTED.includes(task.state) || isPaused(task, chapter.id));
  return { kind: 'checkbox' };
}

/**
 * The shown row the reading is in, marked and opened at as Contents marks and
 * opens at its own (#88), or null when no shown row can contain it.
 *
 * `section` is the spine item the reading is in, as the Contents is given it.
 * The rule is the Contents' own (`rowOfSection`), applied to the rows as shown
 * rather than to every chapter, so what it names is always on screen: a file
 * the drawer hides, a cover or a copyright page with nothing to say, gives the
 * nearest shown row before it; chapters sharing one file give the first of
 * them; a folded volume gives its heading. Nothing before the reading, as for a
 * document not started, gives null, and the list opens at its top.
 */
export function readingChapter(shown: readonly Chapter[], section: number | null): string | null {
  if (section === null) return null;
  const at = rowOfSection(shown.map((c) => c.section ?? null), section);
  return at ? shown[at.row].id : null;
}

/**
 * What Manage downloads lists: every chapter with a marker, and every heading
 * above one, so a volume appears only over chapters it can act on (#37).
 * Headings are walked by `parent`, which the navigation guarantees exists.
 */
export function listedInManage(chapters: readonly Chapter[], markers: ReadonlyMap<string, Marker | null>): Set<string> {
  const listed = new Set<string>();
  const byId = new Map(chapters.map((c) => [c.id, c]));
  for (const c of chapters) if (markers.get(c.id)) for (let at: string | null = c.id; at && !listed.has(at); at = byId.get(at)?.parent ?? null) listed.add(at);
  return listed;
}
