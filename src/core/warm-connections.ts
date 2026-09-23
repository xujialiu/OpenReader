/**
 * A Provider's connection, warmed before a request that cannot be retried goes
 * over it after a quiet spell (#26, ADR 0040).
 *
 * Measured on 2026-09-22 (notes/NOTES_2026-09-22.md, 02:29): Fish Audio's API
 * is on Cloudflare and advertises HTTP/3, so iOS and macOS reach it over QUIC,
 * which is UDP. A proxy on the way — the owner's Mac runs one — drops a UDP
 * mapping about 60 s after its last packet, and a request reusing that
 * connection then stalls for about seven seconds and fails with
 * `NSURLErrorDomain -1005 "The network connection was lost."`. CFNetwork retries
 * a **GET** on a fresh connection when that happens; it never retries a
 * **POST**, and every synthesis is a POST. The reading stopped there: first
 * after a paused minute, then — the commonest case — at every chapter that was
 * not downloaded after one that was, because saved audio sends no request at
 * all (notes/NOTES_2026-09-23.md, 12:57 and 13:48).
 *
 * So two things, both through the one `fetch` every Provider is given:
 *
 * - **Warm before sending.** A request that is not a GET, to an origin that has
 *   been reached before and has been quiet for `QUIET_MS` since, first sends a
 *   GET to that origin's root and waits for it — at most `WARM_UP_TIMEOUT_MS`,
 *   and whatever it answers. If the connection was dead, that GET is what
 *   CFNetwork retries on a fresh one, and the request goes over that. Requests
 *   sent together share one warm-up.
 * - **Keep warm.** `keepWarm` sends the same GET without waiting for it, at most
 *   once per `KEEP_WARM_MS` of quiet, for the caller that knows a connection is
 *   idling on purpose: saved audio being read (`src/offline/runtime.ts`).
 *
 * The GET carries nothing: no key, no Gateway Headers, no body, no cookies, and
 * it follows no redirect. It spends nothing and tells the origin nothing it did
 * not already know (philosophy rules 3 and 4). A synthesis is never sent twice,
 * because whether a refused POST reached the Provider cannot be known, and a
 * paid Provider would charge for both.
 *
 * An origin never reached is never warmed: there is no idle connection to it to
 * go wrong. "Reached" is a request that settled, either way — an answer, or a
 * failure that still went over the connection — and quiet is counted from then.
 *
 * Platform-free (`src/core/README.md`): the `fetch` and the clock are injected.
 */

import { withTimeout } from './timeout';

/** Quiet after which a request that is not a GET is warmed first. Half the 60 s the measured proxy keeps an idle mapping. */
export const QUIET_MS = 30_000;

/** Quiet after which `keepWarm` sends a GET. Below `QUIET_MS`, so a reading from saved audio never needs the wait at all. */
export const KEEP_WARM_MS = 20_000;

/** The longest a request waits for its warm-up. A dead connection's GET took 7.1–7.2 s to be retried and answered. */
export const WARM_UP_TIMEOUT_MS = 15_000;

export interface WarmConnectionsDeps {
  /** The platform's own `fetch`. */
  fetch: typeof fetch;
  /** Wall-clock milliseconds. */
  now(): number;
}

export interface WarmConnections {
  /** `fetch`, with a warm-up in front of a request that is not a GET and follows a quiet spell. */
  fetch: typeof fetch;
  /**
   * A warm-up nobody waits for, when the origin has been quiet for
   * `KEEP_WARM_MS`. Takes the origin or any address on it; does nothing for one
   * never reached.
   */
  keepWarm(origin: string): void;
}

/** Scheme, then an optional user name and password, then the host and port. */
const ADDRESS = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/?#]*@)?([^/?#]+)/i;
const DEFAULT_PORT: Readonly<Record<string, string>> = { http: '80', https: '443' };

/**
 * The origin a request goes to — `https://api.fish.audio` — or null for anything
 * that is not an http or https address.
 *
 * Read from the text of the address rather than asked of a `URL`: React Native's
 * `URL` is not the browser's, and what it answers for `origin` is not something
 * this layer can assume. A user name and password in the address are left out,
 * so they never travel with a warm-up; the scheme's own port is left out, as the
 * URL standard's origin leaves it out.
 */
export function originOf(input: string | URL | { readonly url: string }): string | null {
  const address = typeof input === 'string' ? input : 'url' in input ? input.url : input.href;
  const match = ADDRESS.exec(address.trim());
  if (!match) return null;
  const scheme = match[1].toLowerCase();
  if (!(scheme in DEFAULT_PORT)) return null;
  let host = match[2].toLowerCase();
  const port = /:(\d+)$/.exec(host);
  if (port && port[1] === DEFAULT_PORT[scheme]) host = host.slice(0, -port[0].length);
  return `${scheme}://${host}`;
}

/** The method a request is sent with: the one it was given, the Request's own, or GET. */
function methodOf(input: string | URL | { readonly url: string; readonly method?: string }, init?: RequestInit): string {
  const own = typeof input === 'object' && 'method' in input ? input.method : undefined;
  return (init?.method ?? own ?? 'GET').toUpperCase();
}

export function createWarmConnections(deps: WarmConnectionsDeps): WarmConnections {
  /** When a request to each origin last settled, either way. */
  const settled = new Map<string, number>();
  /** The warm-up in flight for each origin, which every request waiting on that origin shares. */
  const warming = new Map<string, Promise<void>>();

  const contact = (origin: string) => {
    settled.set(origin, deps.now());
  };

  /** Reached before, and quiet for at least `ms` since. */
  const quiet = (origin: string, ms: number): boolean => {
    const at = settled.get(origin);
    return at !== undefined && deps.now() - at >= ms;
  };

  function warmUp(origin: string): Promise<void> {
    const running = warming.get(origin);
    if (running) return running;
    const controller = new AbortController();
    // Inside an async function, so a `fetch` that throws rather than rejects is
    // still one failure among others and never the caller's.
    const request = (async () =>
      deps.fetch(`${origin}/`, { method: 'GET', credentials: 'omit', redirect: 'manual', signal: controller.signal }))();
    request.then(
      () => contact(origin),
      () => contact(origin),
    );
    const flight = withTimeout(
      request,
      WARM_UP_TIMEOUT_MS,
      () => new Error(`${origin}: no answer to a warm-up within ${WARM_UP_TIMEOUT_MS / 1000} s`),
      () => controller.abort(),
    )
      // Whatever it answered, or that it did not: the request it was for goes on.
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => warming.delete(origin));
    warming.set(origin, flight);
    return flight;
  }

  const warmFetch: typeof fetch = async (input, init) => {
    const origin = originOf(input);
    if (origin !== null && methodOf(input, init) !== 'GET' && quiet(origin, QUIET_MS)) await warmUp(origin);
    try {
      return await deps.fetch(input, init);
    } finally {
      if (origin !== null) contact(origin);
    }
  };

  return {
    fetch: warmFetch,
    keepWarm(address) {
      const origin = originOf(address);
      if (origin !== null && quiet(origin, KEEP_WARM_MS)) void warmUp(origin);
    },
  };
}
