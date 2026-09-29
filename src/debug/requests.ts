import { cutAddress, debugLog, describeProblem } from './debug-log';
import { DEBUG_MODE } from './mode';

/**
 * `fetch`, with one Debug Log line per request (ADR 0054): who asked, the
 * method, the address as `cutAddress` gives it (no `user:password@`, no query,
 * no fragment), then the status and how long it took, or what it failed with.
 *
 * A request's headers and body are never read, and that is the guard: a key
 * or a Gateway Header travels in the headers, and nothing here can reach them
 * to write them. Outside Debug Mode it is `fetch` itself.
 */
export function loggedFetch(category: 'provider' | 'lookup', who: string, fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  if (!DEBUG_MODE) return fetch;
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
    const started = Date.now();
    try {
      const response = await fetch(input, init);
      debugLog(category, `${who} ${method} ${cutAddress(url)} -> ${response.status} in ${Date.now() - started} ms`);
      return response;
    } catch (problem) {
      debugLog(category, `${who} ${method} ${cutAddress(url)} failed after ${Date.now() - started} ms: ${describeProblem(problem)}`);
      throw problem;
    }
  };
}
