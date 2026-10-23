/** Foreground-only, yielding work with no speech/synthesis capability (#321).
 * The caller arbitrates the shared renderer with Download preparation. */
export interface RecheckSection { document: string; section: number }
export interface RecheckDeps {
  allowed(): boolean;
  sections(): Promise<RecheckSection[]>;
  order(): readonly string[];
  current(): RecheckSection | null;
  prepare(section: RecheckSection): Promise<void>;
  failed(section: RecheckSection, error: unknown): void;
  finished?(section: RecheckSection, remaining: readonly RecheckSection[]): void;
}
export function orderedRechecks(sections: readonly RecheckSection[], order: readonly string[], current: RecheckSection | null) {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...sections].sort((a, b) => {
    if (a.document !== b.document) {
      if (a.document === current?.document) return -1;
      if (b.document === current?.document) return 1;
      return (rank.get(a.document) ?? order.length) - (rank.get(b.document) ?? order.length);
    }
    // The current section forward, then the beginning of that same book.
    if (current?.document === a.document) {
      const side = Number(a.section < current.section) - Number(b.section < current.section);
      if (side) return side;
    }
    return a.section - b.section;
  });
}
export function createRechecks(deps: RecheckDeps) {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: RecheckSection[] | null = null;
  const failed = new Set<string>();
  const key = (s: RecheckSection) => JSON.stringify([s.document, s.section]);
  async function run() {
    if (stopped || running || !deps.allowed()) return;
    running = true;
    try {
      pending ??= await deps.sections();
      if (stopped || !deps.allowed()) return;
      const next = orderedRechecks(pending.filter((s) => !failed.has(key(s))), deps.order(), deps.current())[0];
      if (!next) return;
      try {
        await deps.prepare(next);
        // Foreground/library changes may invalidate the list while rendering.
        if (pending) {
          pending = pending.filter((s) => key(s) !== key(next));
          deps.finished?.(next, pending);
        }
      } catch (error) {
        // Foreground interruption/preemption is retried on the next wake.
        // Actual failures are bounded to once per foreground visit.
        if (!(error instanceof RecheckInterrupted)) { failed.add(key(next)); deps.failed(next, error); }
      }
    } catch (error) {
      // A failed catalogue read retries on a new foreground visit, not every 25 ms.
      pending = [];
      deps.failed({ document: '', section: -1 }, error);
    } finally {
      running = false;
      if (pending === null || pending.some((s) => !failed.has(key(s)))) wake();
    }
  }
  function wake() {
    if (stopped || timer || running || !deps.allowed()) return;
    // A real timer turn between sections, not a chain of microtasks that owns JS.
    timer = setTimeout(() => { timer = null; void run().catch((error) => {
      deps.failed({ document: '', section: -1 }, error);
    }); }, 25);
  }
  return {
    wake,
    retry() { failed.clear(); pending = null; wake(); },
    start() { stopped = false; wake(); },
    stop() { stopped = true; if (timer) clearTimeout(timer); timer = null; },
    pendingDocument: () => pending ? orderedRechecks(pending.filter((s) => !failed.has(key(s))), deps.order(), deps.current())[0]?.document ?? null : null,
  };
}
export class RecheckInterrupted extends Error {}
