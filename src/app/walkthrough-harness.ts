// WALKTHROUGH-HARNESS — temporary. Deleted before the gates are run.
//
// The fifth harness of this shape (notes 02:50, 03:50, 08:45): a JSON file in
// the app's own documents directory, polled four times a second, calling the
// app's own handlers. Answers go to the Metro log as `HX …` lines, and to the
// Debug Log.
//
// Only in Debug Mode (#82, ADR 0054): the file can run JavaScript in the
// reader, change settings and navigate, so a build without Debug Mode never
// polls it, and never so much as looks for it.
import { useEffect, useRef } from 'react';
import { File, Paths } from 'expo-file-system';

import { debugLog } from '../debug/debug-log';
import { DEBUG_MODE } from '../debug/mode';
import { PROBE_MESSAGE } from '../renderer/messages';

import type { ReadingStatus } from './use-reading';

export type HarnessCommand = Record<string, unknown>;

export function hlog(line: string): void {
  console.log(`HX ${line}`);
  debugLog('hx', line);
}

/**
 * The reader's status line, written every 500 ms when it changes and every 5 s
 * when it does not. `app=` is AppState's `active`, `inactive` or `background`
 * (#113), right after `playing=` so that the line still starts `playing=`, which
 * the kit's scripts look for, and so that "the reading entered section N while
 * in the background" is one line and not a join of two.
 */
export function statusLine(
  status: Pick<ReadingStatus, 'playing' | 'utterance' | 'known' | 'section' | 'rendered' | 'level' | 'seeking' | 'resume' | 'note'>,
  app: string,
): string {
  return (
    `playing=${status.playing} app=${app} utterance=${status.utterance} known=${status.known} ` +
    `section=${status.section} rendered=${status.rendered?.index ?? null}/${status.rendered?.spine ?? null} ` +
    `level=${status.level} seeking=${status.seeking} resume=${status.resume ? JSON.stringify(status.resume.slice(0, 60)) : null} ` +
    `note=${status.note ? JSON.stringify(status.note.slice(0, 500)) : null}`
  );
}

/**
 * The `js` command's script: run the probe's code in the reader's page and post
 * what it returns, or what it threw, as a `PROBE_MESSAGE` (#113). The bridge
 * writes each one as a `[probe]` line, and `HX PROBE …` to the console. Never
 * the player's note, which it used to replace, and where an answer a few
 * milliseconds behind another was lost (#112, 01:59:13).
 */
export function probeScript(code: string): string {
  return (
    '(function(){var answer;try{answer=String((function(){' + code + '\n})());}catch(e){answer=\'threw \'+e;}' +
    'window.ReactNativeWebView.postMessage(JSON.stringify({type:' + JSON.stringify(PROBE_MESSAGE) + ',answer:answer}));})();true;'
  );
}

export function useHarnessCommands(run: (command: HarnessCommand) => void): void {
  const runRef = useRef(run);
  // Keep the poll below calling the latest handler, not the first render's.
  useEffect(() => {
    runRef.current = run;
  });
  const seenRef = useRef(-1);
  useEffect(() => {
    if (!DEBUG_MODE) return;
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
