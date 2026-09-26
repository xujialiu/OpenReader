/** Owns only the temporary interruption, never the document's position or a speech key. */
export function createPronunciationController(deps: {
  playing(): boolean;
  pause(): void;
  resume(): void;
  audio(url: string, signal: AbortSignal): Promise<void>;
  changed(active: boolean): void;
  failed(message: string): void;
}) {
  let active: AbortController | null = null;
  let resumeOwed = false;
  let generation = 0;
  return {
    async play(url: string) {
      const ticket = ++generation;
      active?.abort();
      resumeOwed = resumeOwed || deps.playing();
      if (deps.playing()) deps.pause();
      const abort = new AbortController();
      active = abort;
      deps.changed(true);
      try { await deps.audio(url, abort.signal); }
      catch { if (!abort.signal.aborted && ticket === generation) deps.failed('Pronunciation could not be played. Try again.'); }
      finally {
        if (ticket === generation) {
          active = null;
          const resume = resumeOwed;
          resumeOwed = false;
          deps.changed(false);
          if (resume) deps.resume();
        }
      }
    },
    /** A transport intent or leaving the reader revokes the automatic resume. */
    stop(resume = true) {
      generation++;
      active?.abort(); active = null;
      const owed = resumeOwed;
      resumeOwed = false;
      deps.changed(false);
      if (owed && resume) deps.resume();
    },
  };
}
