import type { ChapterProgress } from './catalog';
import { chapterTextCount, type DownloadTask, type NarrationPlan } from './model';
import { GOES_ON } from './pausing';

/**
 * A download away from the screen (ADR 0052, #77).
 *
 * On iOS 26 and later, a download the owner starts or resumes on the screen, or
 * one that goes on by itself when the owner opens the app, is submitted as a
 * continued processing task, which lets the app go on running
 * after the owner leaves it, while the phone shows the download's progress in a
 * Live Activity from which the owner can stop it. The phone ends the task under
 * pressure, or when the owner stops it there, and the app cannot tell which:
 * both pause the downloads it covered, as Pause all does (#77, 2026-09-28).
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

const goesOn = (task: DownloadTask) => GOES_ON.includes(task.state);

/**
 * The download's chapters saved for its voice, of the chapters in it, and the
 * share of the chapter being written. Chapters of the Document outside the
 * download are not counted, whatever is saved for them.
 *
 * While the download goes on by itself, a chapter the owner paused is counted
 * only once it is complete: the count is of what this download is writing (it
 * read `49 of 188 chapters` with 140 paused, #77). Failed chapters stay
 * counted. Once nothing goes on by itself, as when the download is paused as a
 * whole by Pause all or by the ring that paused the last chapter going on,
 * every chapter is counted again, so the last report before the finish shows
 * where it stopped rather than a full `49 of 49`.
 */
export function continuedShown(
  task: DownloadTask,
  title: string,
  progress: readonly ChapterProgress[],
  plan: NarrationPlan | null,
): ContinuedShown {
  const saved = new Map(progress.map((chapter) => [chapter.id, chapter]));
  const complete = (id: string) => !!saved.get(id)?.complete;
  const paused = new Set(goesOn(task) ? task.paused : []);
  const counted = task.chapters.filter((id) => complete(id) || !paused.has(id));
  const total = counted.length;
  const done = counted.filter(complete).length;
  let part = 0;
  const current = task.current && !paused.has(task.current) ? plan?.chapters.find((chapter) => chapter.id === task.current) : undefined;
  if (current && current.prepared !== false && !complete(current.id)) {
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
  /** Whether the app is in the foreground, the only place a task is submitted from. */
  foreground(): boolean;
}

/**
 * One continued processing task at a time, covering every download that goes
 * on by itself; it shows the one being written, or else the first waiting its
 * turn, and follows the scheduler from one Document to the next.
 *
 * - `start` after the owner's own start or resume, on the screen, and when the
 *   owner opens the app: submits when no task runs, and otherwise only reports.
 *   Apple asks for a submission to follow a person's action, so nothing else
 *   submits. What the phone will show is read from the catalogue first, and
 *   the app may leave meanwhile, so the foreground is checked again right
 *   before the native call: on the simulator at 8aa75f6 a submission went out
 *   0.85-0.96 s after the app reached the background.
 * - `follow` after any change: reports progress, or, once nothing goes on by
 *   itself, shows where the download ended and finishes the task. It succeeds
 *   when every download it covered is done without a failed chapter or was
 *   paused by the owner; a download elsewhere that stopped by itself before
 *   (on the owner's iPhone, an old `blocked` one) does not count.
 * - `expired` when the phone has ended the task: names the downloads it
 *   covered that still go on by themselves, which the owner's stop pauses.
 *
 * It covers every download that goes on by itself from its submission to its
 * end, including one that starts going on while it runs.
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
  /** The submission out while `state` is 'submitting': whether the phone runs the task. */
  let submission: Promise<boolean> = Promise.resolve(false);
  /** Every download that went on by itself while the task was being submitted or ran. */
  let covering = new Set<DownloadTask>();
  const cover = () => deps.tasks().filter(goesOn).forEach((task) => covering.add(task));
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
    deps.tasks()
      .filter((task) => covering.has(task))
      .every((task) => (task.state === 'done' && !task.failed.length) || task.state === 'paused');

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
    if (state !== 'idle') cover();
    if (state !== 'running' || !native || queued) return;
    queued = true;
    void turn(async () => {
      queued = false;
      if (state !== 'running') return;
      const task = showing();
      if (!task) {
        state = 'idle';
        const success = succeeded();
        covering = new Set();
        await finish(native, success);
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
      return state === 'running' ? Promise.resolve(true) : submission;
    }
    const task = showing();
    if (!task) return Promise.resolve(false);
    state = 'submitting';
    changed = false;
    covering = new Set();
    cover();
    submission = turn(async () => {
      shownLast = task;
      const shown = await deps.shown(task);
      if (!deps.foreground()) return false;
      return native.submitContinued(shown.title, shown.subtitle, shown.completed, shown.total);
    })
      .catch(() => false)
      .then((running) => {
        if (state !== 'submitting') return running;
        state = running ? 'running' : 'idle';
        if (!running) covering = new Set();
        if (running && changed) follow();
        return running;
      });
    return submission;
  }

  return {
    start,
    follow,
    expired(): DownloadTask[] {
      const covered = deps.tasks().filter((task) => covering.has(task) && goesOn(task));
      state = 'idle';
      shownLast = null;
      covering = new Set();
      return covered;
    },
    /**
     * Whether a continued task the phone accepted keeps the app running. Not
     * while one is being submitted: until the phone answers, the app has only
     * the bounded background time.
     */
    running: () => state === 'running',
  };
}
