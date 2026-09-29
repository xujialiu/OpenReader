import type { ChapterProgress } from './catalog';
import { chapterTextCount, type DownloadTask, type NarrationPlan } from './model';
import { GOES_ON } from './pausing';

/**
 * A download away from the screen (ADR 0053, #77).
 *
 * On iOS 26 and later, a download the owner starts or resumes on the screen, or
 * one that goes on by itself when the owner opens the app, is submitted as a
 * continued processing task, which lets the app go on running
 * after the owner leaves it, while the phone shows the progress of every
 * download going on, together, in a Live Activity from which the owner can
 * stop it. The phone ends the task under
 * pressure, or when the owner stops it there, and the app cannot tell which:
 * both pause the downloads it covered, as Pause all does (#77, 2026-09-28).
 * Where there is no such task (an earlier iOS, the simulator, a refusal), the
 * runtime keeps the bounded background time it always asked for.
 *
 * The rules are here, with the native side and the catalogue passed in, so the
 * suite checks them without the runtime around them.
 */

/** What the Live Activity shows for the downloads of the task's batch, and how far they have got. */
export interface ContinuedShown {
  /** How many books the batch is downloading: `Downloading 2 books` (#93). */
  title: string;
  /** How many of the batch's chapters are saved: `120 of 200 chapters` (#92). */
  subtitle: string;
  completed: number;
  total: number;
  /** The Documents the title counts, each once, for the Debug Log: the title names none. */
  documents: readonly string[];
}

/** The native module's three calls for the continued processing task. */
export interface ContinuedNative {
  /** Whether the phone runs the task now; false below iOS 26 and on a refusal. */
  submitContinued(shown: ContinuedShown): Promise<boolean>;
  updateContinued(shown: ContinuedShown): Promise<void>;
  finishContinued(success: boolean): Promise<void>;
}

/** One download of the batch, with what the catalogue holds of its Document in its voice. */
export interface ContinuedDownload {
  task: DownloadTask;
  progress: readonly ChapterProgress[];
  plan: NarrationPlan | null;
}

/** Progress units per chapter, so the chapter being written moves the bar with every saved clip. */
const UNITS = 1000;

const goesOn = (task: DownloadTask) => GOES_ON.includes(task.state);

/**
 * The batch's chapters saved for their voices, of the chapters in its
 * downloads, and the share of each chapter being written (#92). Chapters of a
 * Document outside its download are not counted, whatever is saved for them.
 *
 * While any download of the batch goes on by itself, a chapter the owner
 * paused is counted only once it is complete, in every download of the batch
 * whatever its state: the count is of what the batch is writing (one download
 * read `49 of 188 chapters` with 140 paused, #77), and a download the owner
 * paused as a whole while another goes on counts only what it saved. Failed
 * chapters stay counted. Once nothing of the batch goes on by itself, every
 * chapter of every download is counted, so the last report before the finish
 * shows where it stopped rather than a full `49 of 49`.
 *
 * The title counts the distinct Documents that put a chapter in the total:
 * two voices of one Document are one book, and a download paused before it
 * saved anything is none (#93).
 */
export function continuedShown(batch: readonly ContinuedDownload[]): ContinuedShown {
  const batchGoesOn = batch.some(({ task }) => goesOn(task));
  const documents: string[] = [];
  let total = 0;
  let done = 0;
  let part = 0;
  for (const { task, progress, plan } of batch) {
    const saved = new Map(progress.map((chapter) => [chapter.id, chapter]));
    const complete = (id: string) => !!saved.get(id)?.complete;
    const paused = new Set(batchGoesOn ? task.paused : []);
    const counted = task.chapters.filter((id) => complete(id) || !paused.has(id));
    if (!counted.length) continue;
    if (!documents.includes(task.document)) documents.push(task.document);
    total += counted.length;
    done += counted.filter(complete).length;
    const current = task.current && counted.includes(task.current) ? plan?.chapters.find((chapter) => chapter.id === task.current) : undefined;
    if (current && current.prepared !== false && !complete(current.id)) {
      const texts = chapterTextCount(current);
      if (texts > 0) part += Math.min((saved.get(current.id)?.count ?? 0) / texts, 0.999);
    }
  }
  return {
    title: `Downloading ${documents.length} ${documents.length === 1 ? 'book' : 'books'}`,
    subtitle: `${done} of ${total} ${total === 1 ? 'chapter' : 'chapters'}`,
    completed: Math.floor((done + part) * UNITS),
    total: Math.max(total, 1) * UNITS,
    documents,
  };
}

export interface ContinuedDeps {
  /** Null where the platform has no such module; nothing is ever submitted then. */
  native: ContinuedNative | null;
  tasks(): readonly DownloadTask[];
  /** What the phone shows for the batch's downloads now, read from the catalogue. */
  shown(batch: readonly DownloadTask[]): Promise<ContinuedShown>;
  /** Whether the app is in the foreground, the only place a task is submitted from. */
  foreground(): boolean;
}

/**
 * One continued processing task at a time, covering every download that goes
 * on by itself, and showing them together (#92).
 *
 * - `start` after the owner's own start or resume, on the screen, and when the
 *   owner opens the app: submits when no task runs, and otherwise only reports.
 *   Apple asks for a submission to follow a person's action, so nothing else
 *   submits. What the phone will show is read from the catalogue first, and
 *   the app may leave meanwhile, so the foreground is checked again right
 *   before the native call: on the simulator at 8aa75f6 a submission went out
 *   0.85-0.96 s after the app reached the background.
 * - `follow` after any change: reports progress, or, once nothing goes on by
 *   itself, shows where the batch ended and finishes the task. It succeeds
 *   when every download it covered is done without a failed chapter or was
 *   paused by the owner; a download elsewhere that stopped by itself before
 *   (on the owner's iPhone, an old `blocked` one) does not count.
 * - `expired` when the phone has ended the task: names the downloads it
 *   covered that still go on by themselves, which the owner's stop pauses.
 *
 * Its batch is every download that goes on by itself from its submission to
 * its end, including one that starts going on while it runs, and is still
 * there: a finished download stays in it, so the count never goes back, and a
 * deleted one leaves it. The next task starts a new batch. At the submission
 * it is the downloads going on then.
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
  /** The submission out while `state` is 'submitting': whether the phone runs the task. */
  let submission: Promise<boolean> = Promise.resolve(false);
  /** Every download that went on by itself while the task was being submitted or ran. */
  let covering = new Set<DownloadTask>();
  const cover = () => deps.tasks().filter(goesOn).forEach((task) => covering.add(task));
  /** The downloads the task covers that are still there: what it shows, and what its success is judged by. */
  const batch = () => deps.tasks().filter((task) => covering.has(task));
  let chain: Promise<unknown> = Promise.resolve();
  const turn = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work);
    chain = next.catch(() => {});
    return next;
  };
  const succeeded = (covered: readonly DownloadTask[]) =>
    covered.every((task) => (task.state === 'done' && !task.failed.length) || task.state === 'paused');

  /** Decided when nothing went on, not when the call goes out: the owner may resume in between. */
  async function finish(native: ContinuedNative, last: readonly DownloadTask[], success: boolean) {
    if (last.length) {
      try {
        await native.updateContinued(await deps.shown(last));
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
      if (!deps.tasks().some(goesOn)) {
        state = 'idle';
        const last = batch();
        covering = new Set();
        await finish(native, last, succeeded(last));
        return;
      }
      cover();
      const shown = await deps.shown(batch());
      if (state !== 'running') return;
      await native.updateContinued(shown);
    }).catch(() => {});
  }

  function start(): Promise<boolean> {
    const native = deps.native;
    if (!native) return Promise.resolve(false);
    if (state !== 'idle') {
      follow();
      return state === 'running' ? Promise.resolve(true) : submission;
    }
    if (!deps.tasks().some(goesOn)) return Promise.resolve(false);
    state = 'submitting';
    changed = false;
    covering = new Set();
    cover();
    const first = batch();
    submission = turn(async () => {
      const shown = await deps.shown(first);
      if (!deps.foreground()) return false;
      return native.submitContinued(shown);
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
      const covered = batch().filter(goesOn);
      state = 'idle';
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
