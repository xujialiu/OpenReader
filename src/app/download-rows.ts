import { rowOfSection, type ContentsRow } from '../core/document/contents';
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
 * The rule is the Contents' own (`rowOfSection`), applied to the rows the
 * download view shows rather than to every chapter, so what it names is on
 * screen there: a file the drawer hides, a cover or a copyright page with
 * nothing to say, gives the nearest shown row before it; chapters sharing one
 * file give the first of them; a folded volume gives its heading. Nothing
 * before the reading, as for a document not started, gives null, and the list
 * opens at its top. Manage downloads, which lists fewer rows, marks the answer
 * only where it lists it, rather than asking again among its own rows and
 * marking a chapter that is not being read.
 */
export function readingChapter(shown: readonly Chapter[], section: number | null): string | null {
  if (section === null) return null;
  const at = rowOfSection(shown.map((c) => c.section ?? null), section);
  return at ? shown[at.row].id : null;
}

/**
 * Every chapter and volume that is **Downloaded** (CONTEXT.md) in the Voice
 * `progress` was read in: each chapter in it with something to speak is
 * complete, and there is at least one. A volume's chapters are its descendants
 * (`descendants`), so a volume heading is Downloaded once every chapter under
 * it is, and a part with nothing to speak never is.
 *
 * The one answer behind the Download drawer's check and Contents' (#134), so
 * the two drawers cannot disagree about a chapter. One pass from the end,
 * because the navigation lists a parent before its children: each chapter's
 * subtree is folded into its parent before the parent is reached. Asking
 * `descendants` per row, as the drawer did, walks the whole plan for every row,
 * which over Contents' 2,076 rows is four million steps on every update.
 */
export function downloadedChapters(
  chapters: readonly Chapter[],
  progress: ReadonlyMap<string, ChapterProgress>,
): Set<string> {
  const spoken = new Map<string, boolean>();
  const complete = new Map<string, boolean>();
  const downloaded = new Set<string>();
  for (let at = chapters.length - 1; at >= 0; at--) {
    const chapter = chapters[at];
    let some = spoken.get(chapter.id) ?? false;
    let every = complete.get(chapter.id) ?? true;
    if (chapter.prepared === false || chapterTextCount(chapter) > 0) {
      some = true;
      every = every && !!progress.get(chapter.id)?.complete;
    }
    if (some && every) downloaded.add(chapter.id);
    if (chapter.parent) {
      spoken.set(chapter.parent, (spoken.get(chapter.parent) ?? false) || some);
      complete.set(chapter.parent, (complete.get(chapter.parent) ?? true) && every);
    }
  }
  return downloaded;
}

/**
 * The Contents rows that carry the Downloaded check (#134), as indexes into
 * `rows`, for the Voice `progress` was read in: a row whose chapter or volume
 * is Downloaded (`downloadedChapters`).
 *
 * A row is matched to the download plan's chapter for the same navigation
 * entry by the place both point to, the spine item and the fragment, and never
 * by position. Contents is the renderer's reading of the navigation and the
 * plan is the app's own (`navigation.ts`), and the two keep different entries:
 * the app keeps an entry with no link that the renderer drops, and adds a part
 * the navigation does not list. Entries pointing to one place, such as a volume
 * heading and its first chapter on the same file, are paired in order, so each
 * row answers for its own chapter. A row that cannot be opened has no place and
 * is never checked; neither is a row that matches no chapter.
 */
export function downloadedRows(
  rows: readonly ContentsRow[],
  chapters: readonly Chapter[],
  progress: ReadonlyMap<string, ChapterProgress>,
): Set<number> {
  const checked = new Set<number>();
  if (!progress.size) return checked;
  const downloaded = downloadedChapters(chapters, progress);
  const byPlace = new Map<string, string[]>();
  for (const chapter of chapters) {
    if (chapter.section === null || chapter.section === undefined) continue;
    const at = place(chapter.section, chapter.fragment ?? '');
    const waiting = byPlace.get(at);
    if (waiting) waiting.push(chapter.id);
    else byPlace.set(at, [chapter.id]);
  }
  rows.forEach((row, index) => {
    if (row.target === null) return;
    const id = byPlace.get(place(row.target, fragmentOf(row.href)))?.shift();
    if (id !== undefined && downloaded.has(id)) checked.add(index);
  });
  return checked;
}
const place = (section: number, fragment: string) => `${section}#${fragment}`;
/** As the plan records a fragment: decoded (`navigation.ts`), and as written when it does not decode. */
function fragmentOf(href: string): string {
  const written = href.split('#')[1] ?? '';
  try {
    return decodeURIComponent(written);
  } catch {
    return written;
  }
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
