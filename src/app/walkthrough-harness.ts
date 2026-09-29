// WALKTHROUGH-HARNESS — temporary. Deleted before the gates are run.
//
// The fifth harness of this shape (notes 02:50, 03:50, 08:45): a JSON file in
// the app's own documents directory, polled four times a second, calling the
// app's own handlers. Answers go to the Metro log as `HX …` lines.
import { useEffect, useRef } from 'react';
import { File, Paths } from 'expo-file-system';

export type HarnessCommand = Record<string, unknown>;

export function hlog(line: string): void {
  console.log(`HX ${line}`);
}

export function useHarnessCommands(run: (command: HarnessCommand) => void): void {
  const runRef = useRef(run);
  // Keep the poll below calling the latest handler, not the first render's.
  useEffect(() => {
    runRef.current = run;
  });
  const seenRef = useRef(-1);
  useEffect(() => {
    const timer = setInterval(() => {
      try {
        const file = new File(Paths.document, 'harness.json');
        if (!file.exists) return;
        const body = JSON.parse(file.textSync()) as HarnessCommand & { seq?: number };
        const seq = Number(body.seq ?? -1);
        if (seq === seenRef.current) return;
        seenRef.current = seq;
        runRef.current(body);
      } catch (problem) {
        hlog(`harness threw: ${String(problem)}`);
      }
    }, 250);
    return () => clearInterval(timer);
  }, []);
}

/**
 * A `fetch` that refuses for one host from the nth request onwards, with the
 * same `TypeError` iOS raises when the network goes. Installed and removed by
 * command, so a failure can be made to happen at a chosen moment.
 */
const realFetch = globalThis.fetch;
export function breakFetch(host: string, from: number): void {
  let seen = 0;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url.includes(host)) {
      seen += 1;
      if (seen >= from) {
        hlog(`fetch refused (${seen}) ${url}`);
        return Promise.reject(
          new TypeError(
            'fetch failed: UnexpectedException: The network connection was lost. (at ExpoModulesCore/Promise.swift:56)',
          ),
        );
      }
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
  hlog(`fetch broken for ${host} from request ${from}`);
}
export function unbreakFetch(): void {
  globalThis.fetch = realFetch;
  hlog('fetch restored');
}

/**
 * A `fetch` that logs every request to one host — its method, its URL and a
 * string body — before passing it on, so a run can read what was actually sent
 * without a proxy: the Speech Text and a Language Hint (#23, #25). Headers are
 * never logged, and they are where a key travels. `unbreakfetch` removes it.
 */
export function watchFetch(host: string): void {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url.includes(host)) hlog(`fetch ${init?.method ?? 'GET'} ${url}${typeof init?.body === 'string' ? ` ${init.body.slice(0, 400)}` : ''}`);
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
  hlog(`fetch watched for ${host}`);
}
