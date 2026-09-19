/**
 * Reject a promise that takes too long. Every request to a provider or to the
 * sync folder goes through here, because a request that never settles shows up
 * as a spinner that never stops — the owner cannot tell a slow server from a
 * dead one. Philosophy rule 1: network calls time out and report; they do not
 * hang. `onTimeout` lets the caller abort the underlying request so it does not
 * keep running in the background.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, makeError: () => Error, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {
        // Aborting is best-effort; the rejection below is what matters
      }
      reject(makeError());
    }, ms);
  });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}
