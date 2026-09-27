import type { ChapterProgress } from './catalog';
import { chapterTextCount, type DownloadTask, type NarrationPlan } from './model';
import { GOES_ON } from './pausing';

/**
 * A download away from the screen (ADR 0052, #77).
 *
 * On iOS 26 and later, a download the owner starts or resumes on the screen is
 * submitted as a continued processing task, which lets the app go on running
 * after the owner leaves it, while the phone shows the download's progress in a
 * Live Activity from which the owner can stop it. The phone ends the task under
 * pressure, or when the owner stops it there, and the app cannot tell which.
 * Where there is no such task (an earlier iOS, the simulator, a refusal), the
 * runtime keeps the bounded background time it always asked for.
 *
 * The rules are here, with the native side and the catalogue passed in, so the
 * suite checks them without the runtime around them.
 */

/** What the Live Activity shows for one download, and how far it has got. */
export interface ContinuedShown {
  /** The Document's name, as the Library shows it. */
  title: string;
  /** How many of the download's chapters are saved: `12 of 40 chapters`. */
  subtitle: string;
  completed: number;
  total: number;
}

/** The native module's three calls for the continued processing task. */
export interface ContinuedNative {
  /** Whether the phone runs the task now; false below iOS 26 and on a refusal. */
  submitContinued(title: string, subtitle: string, completed: number, total: number): Promise<boolean>;
  updateContinued(title: string, subtitle: string, completed: number, total: number): Promise<void>;
  finishContinued(success: boolean): Promise<void>;
}

/** Progress units per chapter, so the chapter being written moves the bar with every saved clip. */
const UNITS = 1000;

/**
 * The download's chapters saved for its voice, of the chapters in it, and the
 * share of the chapter being written. Chapters of the Document outside the
 * download are not counted, whatever is saved for them.
 */
export function continuedShown(
  task: DownloadTask,
  title: string,
  progress: readonly ChapterProgress[],
  plan: NarrationPlan | null,
): ContinuedShown {
  const saved = new Map(progress.map((chapter) => [chapter.id, chapter]));
  const total = task.chapters.length;
  const done = task.chapters.filter((id) => saved.get(id)?.complete).length;
  let part = 0;
  const current = task.current ? plan?.chapters.find((chapter) => chapter.id === task.current) : undefined;
  if (current && current.prepared !== false && !saved.get(current.id)?.complete) {
    const texts = chapterTextCount(current);
    if (texts > 0) part = Math.min((saved.get(current.id)?.count ?? 0) / texts, 0.999);
  }
  return {
    title,
    subtitle: `${done} of ${total} ${total === 1 ? 'chapter' : 'chapters'}`,
    completed: Math.floor((done + part) * UNITS),
    total: Math.max(total, 1) * UNITS,
  };
}

export interface ContinuedDeps {
  /** Null where the platform has no such module; nothing is ever submitted then. */
  native: ContinuedNative | null;
  tasks(): readonly DownloadTask[];
  /** What the phone shows for this download now, read from the catalogue. */
  shown(task: DownloadTask): Promise<ContinuedShown>;
}

const goesOn = (task: DownloadTask) => GOES_ON.includes(task.state);

/**
 * One continued processing task at a time, covering every download that goes
 * on by itself; it shows the one being written, or else the first waiting its
 * turn, and follows the scheduler from one Document to the next.
 *
 * - `start` after the owner's own start or resume, on the screen: submits
 *   when no task runs, and otherwise only reports. Apple asks for a submission
 *   to follow a person's action, so nothing else submits.
 * - `follow` after any change: reports progress, or, once nothing goes on by
 *   itself, shows where the download ended and finishes the task. It succeeds
 *   when every download is done without a failed chapter or was paused by the
 *   owner.
 * - `expired` when the phone has ended the task.
 *
 * Every native call waits for the one before it, so a submission never lands
 * between a finishing task's last report and its finish.
 */
export function createContinuedProcessing(deps: ContinuedDeps) {
  let state: 'idle' | 'submitting' | 'running' = 'idle';
  /** A report is waiting its turn; it reads the downloads when it runs, so one is enough. */
  let queued = false;
  /** Something changed while the task was being submitted. */
  let changed = false;
  /** The download shown last, so the finish can show where it ended. */
  let shownLast: DownloadTask | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const turn = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work);
    chain = next.catch(() => {});
    return next;
  };
  const showing = () => {
    const on = deps.tasks().filter(goesOn);
    return on.find((task) => task.state === 'preparing' || task.state === 'downloading') ?? on[0] ?? null;
  };
  const succeeded = () =>
    deps.tasks().every((task) => (task.state === 'done' && !task.failed.length) || task.state === 'paused');

  /** Decided when nothing went on, not when the call goes out: the owner may resume in between. */
  async function finish(native: ContinuedNative, success: boolean) {
    const last = shownLast && deps.tasks().includes(shownLast) ? shownLast : null;
    shownLast = null;
    if (last) {
      try {
        const shown = await deps.shown(last);
        await native.updateContinued(shown.title, shown.subtitle, shown.completed, shown.total);
      } catch {
        // The finish matters more than its last count.
      }
    }
    await native.finishContinued(success);
  }

  function follow(): void {
    const native = deps.native;
    if (state === 'submitting') changed = true;
    if (state !== 'running' || !native || queued) return;
    queued = true;
    void turn(async () => {
      queued = false;
      if (state !== 'running') return;
      const task = showing();
      if (!task) {
        state = 'idle';
        await finish(native, succeeded());
        return;
      }
      shownLast = task;
      const shown = await deps.shown(task);
      if (state !== 'running') return;
      await native.updateContinued(shown.title, shown.subtitle, shown.completed, shown.total);
    }).catch(() => {});
  }

  function start(): Promise<boolean> {
    const native = deps.native;
    if (!native) return Promise.resolve(false);
    if (state !== 'idle') {
      follow();
      return Promise.resolve(true);
    }
    const task = showing();
    if (!task) return Promise.resolve(false);
    state = 'submitting';
    changed = false;
    return turn(async () => {
      shownLast = task;
      const shown = await deps.shown(task);
      return native.submitContinued(shown.title, shown.subtitle, shown.completed, shown.total);
    })
      .catch(() => false)
      .then((running) => {
        if (state !== 'submitting') return running;
        state = running ? 'running' : 'idle';
        if (running && changed) follow();
        return running;
      });
  }

  return {
    start,
    follow,
    expired(): void {
      state = 'idle';
      shownLast = null;
    },
    /** Whether a continued task keeps the app running, or is being submitted to. */
    holding: () => state !== 'idle',
  };
}
