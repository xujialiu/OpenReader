// The walkthrough's Debug-only English–English lookup control, not a network
// recorder. Never record headers/bodies or consume/clone a Response.
export type LookupGateAction = 'hold' | 'state' | 'release' | 'restore';
export type LookupGateStop = 'restore' | 'unbreakfetch' | 'unmounted' | 'aborted' | 'deadline' | 'expired' | 'failed' | 'overflow' | 'status-write-failed' | 'observer-changed';
type RequestState = 'requested' | 'held' | 'released' | 'aborted' | 'deadline' | 'cancelled' | 'failed';
interface LookupGateRequest {
  id: number; query: string | null; state: RequestState;
  startedAt: number; deadlineAt: number; heldAt: number | null; releasedAt: number | null; abortedAt: number | null;
}
export interface LookupGateSnapshot {
  run: string; service: 'free-dictionary'; installed: boolean; installedAt: number; expiresAt: number;
  count: number; pending: number; held: number; overflow: boolean; stoppedBy: LookupGateStop | null;
  requests: LookupGateRequest[];
}
export interface LookupGateStatus {
  version: 1; observedAt: number;
  command: { seq: number; action: LookupGateAction | null; run: string | null; ok: boolean; error: string | null; released: number };
  gate: LookupGateSnapshot | null;
}
interface PendingLookup { release(): boolean; cancel(state: RequestState, error?: unknown): void }

/** Match the actual credential-free service route, never a substring host. */
function lookupQuery(input: RequestInfo | URL, init?: RequestInit): { query: string | null } | null {
  const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
  if (method.toUpperCase() !== 'GET') return null;
  try {
    const address = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(address);
    if (url.origin !== 'https://api.dictionaryapi.dev' || url.username || url.password || url.search || url.hash) return null;
    const match = /^\/api\/v2\/entries\/en\/([^/]+)$/.exec(url.pathname);
    if (!match) return null;
    // Count every query, but retain only a bounded ordinary English word.
    let query: string | null = null;
    try {
      const decoded = decodeURIComponent(match[1]!);
      if (decoded.length <= 80 && /^[a-z]+(?:['’\u002d][a-z]+)*$/i.test(decoded)) query = decoded;
    } catch { /* Malformed encoding is counted without retaining its value. */ }
    return { query };
  } catch { return null; }
}
function aborted(): Error { const error = new Error('Aborted'); error.name = 'AbortError'; return error; }

/** The harness owns installation/role/observer guards. This owns only the
 * original response wait and its cancellation. A release keeps counting until
 * restore/expiry, so a layout-only duplicate cannot disappear from the receipt.
 */
export class LookupResponseGate {
  private installed = true;
  private readonly installedAt = Date.now();
  private readonly expiresAt = this.installedAt + 120_000;
  private readonly requests: LookupGateRequest[] = [];
  private readonly pending = new Set<PendingLookup>();
  private count = 0;
  private stoppedBy: LookupGateStop | null = null;
  private readonly wrapper: typeof fetch;
  private readonly expiry: ReturnType<typeof setTimeout>;

  constructor(readonly run: string, private readonly original: typeof fetch, private readonly changed: () => void) {
    this.wrapper = (input, init) => {
      if (!this.installed) return this.original(input, init);
      const match = lookupQuery(input, init);
      if (!match) return this.original(input, init);
      this.count += 1;
      if (this.requests.length === 64) {
        this.restore('overflow');
        return Promise.reject(aborted());
      }
      const record: LookupGateRequest = {
        id: this.count, query: match.query, state: 'requested', startedAt: Date.now(), deadlineAt: Date.now() + 12_000,
        heldAt: null, releasedAt: null, abortedAt: null,
      };
      this.requests.push(record);
      return new Promise<Response>((resolve, reject) => {
        // The installed whatwg-fetch inherits Request.signal for undefined/null.
        const parent = init?.signal || (typeof input === 'object' && 'signal' in input ? input.signal : undefined);
        const controller = new AbortController();
        let response: Response | undefined;
        let settled = false;
        const timer = setTimeout(() => this.restore('deadline'), 12_000);
        const cleanup = () => { clearTimeout(timer); parent?.removeEventListener('abort', cancel); this.pending.delete(entry); };
        const cancel = () => this.restore('aborted');
        const entry: PendingLookup = {
          cancel: (state, error = aborted()) => {
            if (settled) return;
            settled = true; cleanup(); response = undefined;
            record.state = state; record.abortedAt = state === 'failed' ? null : Date.now();
            controller.abort(); reject(error);
          },
          release: () => {
            if (settled || !response) return false;
            if (Date.now() >= record.deadlineAt) { this.restore('deadline'); return false; }
            settled = true; cleanup();
            // The original Response may still be streaming after fetch resolves.
            // Preserve caller-owned body cancellation without wrapping its readers
            // or retaining this gate in the released response's abort listener.
            const forward = () => controller.abort();
            parent?.addEventListener('abort', forward, { once: true });
            if (parent?.aborted) forward();
            record.state = 'released'; record.releasedAt = Date.now();
            resolve(response); response = undefined;
            return true;
          },
        };
        this.pending.add(entry);
        if (parent?.aborted) { cancel(); return; }
        parent?.addEventListener('abort', cancel, { once: true });
        this.changed();
        if (!this.installed) return; // A failed status write cancels the control.
        try {
          void this.original(input, { ...init, signal: controller.signal }).then(answer => {
            if (settled) return;
            if (Date.now() >= record.deadlineAt) { this.restore('deadline'); return; }
            response = answer; record.state = 'held'; record.heldAt = Date.now();
            this.changed();
          }, error => {
            if (settled) return;
            entry.cancel('failed', error);
            this.restore('failed');
          });
        } catch (error) {
          entry.cancel('failed', error);
          this.restore('failed');
        }
      });
    };
    globalThis.fetch = this.wrapper;
    this.expiry = setTimeout(() => this.restore('expired'), 120_000);
  }

  snapshot(): LookupGateSnapshot {
    if (this.installed && globalThis.fetch !== this.wrapper) this.restore('observer-changed');
    return {
      run: this.run, service: 'free-dictionary', installed: this.installed, installedAt: this.installedAt, expiresAt: this.expiresAt,
      count: this.count, pending: this.pending.size, held: this.requests.filter(request => request.state === 'held').length,
      overflow: this.count > 64, stoppedBy: this.stoppedBy, requests: this.requests.map(request => ({ ...request })),
    };
  }
  release(): number {
    let released = 0;
    for (const entry of this.pending) if (entry.release()) released += 1;
    return released;
  }
  restore(reason: LookupGateStop): void {
    if (!this.installed) return;
    this.installed = false; this.stoppedBy = reason;
    clearTimeout(this.expiry);
    if (globalThis.fetch === this.wrapper) globalThis.fetch = this.original;
    for (const entry of this.pending) entry.cancel(reason === 'aborted' ? 'aborted' : reason === 'deadline' ? 'deadline' : 'cancelled');
    this.changed();
  }
}
