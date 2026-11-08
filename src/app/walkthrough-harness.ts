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
import { LookupResponseGate, type LookupGateAction, type LookupGateStatus } from './walkthrough-lookup-gate';

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
    harnessPollers += 1;
    const timer = setInterval(() => {
      try {
        const file = new File(Paths.document, 'harness.json');
        if (!file.exists) return;
        const body = JSON.parse(file.textSync()) as HarnessCommand & { seq?: number };
        const seq = Number(body.seq ?? -1);
        if (seq === seenRef.current) return;
        seenRef.current = seq;
        if (body.do === 'lookupgate') {
          // Shell, ReaderScreen and ReadingView poll the same file. This app-
          // runtime command is consumed once, not once per mounted reader.
          if (Number.isSafeInteger(seq) && seq > seenLookupGateSeq) {
            seenLookupGateSeq = seq;
            runLookupGateCommand(body, seq);
          }
          return;
        }
        runRef.current(body);
      } catch (problem) {
        hlog(`harness threw: ${String(problem)}`);
      }
    }, 250);
    return () => {
      clearInterval(timer);
      harnessPollers -= 1;
      if (harnessPollers === 0) lookupGate?.restore('unmounted');
    };
  }, []);
}

let harnessPollers = 0;
let seenLookupGateSeq = -1;
let lookupGate: LookupResponseGate | null = null;
let gateCommand: LookupGateStatus['command'];

/** Fixed, bounded test fields only. Write on each transition, not through the
 * Debug Log's two-second batch: M7 must release inside the real 15s lookup.
 * Readers retry a missing/partial JSON write and require the acknowledged seq.
 */
function writeLookupGateStatus(): void {
  if (!DEBUG_MODE) return;
  try {
    const status: LookupGateStatus = { version: 1, observedAt: Date.now(), command: gateCommand, gate: lookupGate?.snapshot() ?? null };
    new File(Paths.document, 'lookup-gate-status.json').write(JSON.stringify(status));
  } catch {
    lookupGate?.restore('status-write-failed');
    hlog('lookup gate status unavailable; control cancelled');
  }
}
function runLookupGateCommand(command: HarnessCommand, seq: number): void {
  if (!DEBUG_MODE) return;
  const action = (['hold', 'state', 'release', 'restore'] as unknown[]).includes(command.action) ? command.action as LookupGateAction : null;
  const run = typeof command.run === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(command.run) ? command.run : null;
  gateCommand = { seq, action, run, ok: false, error: null, released: 0 };
  const refuse = (error: string) => { gateCommand.error = error; writeLookupGateStatus(); };
  if (!action || !run || !Number.isSafeInteger(command.seq) ||
      Object.keys(command).some(key => !['seq', 'do', 'action', 'run', 'service'].includes(key))) return refuse('invalid-command');
  if (action === 'hold') {
    if (command.service !== 'free-dictionary') return refuse('unsupported-service');
    if (lookupGate?.snapshot().installed || globalThis.fetch !== realFetch) return refuse('fetch-observer-present');
    lookupGate = new LookupResponseGate(run, realFetch, writeLookupGateStatus);
  } else {
    if (command.service !== undefined) return refuse('invalid-command');
    if (!lookupGate || lookupGate.run !== run) return refuse('gate-run-mismatch');
    if (action === 'release') {
      if (!lookupGate.snapshot().installed) return refuse('gate-not-installed');
      gateCommand.released = lookupGate.release();
      if (!gateCommand.released) return refuse('no-held-response');
    }
    if (action === 'restore') lookupGate.restore('restore');
  }
  gateCommand.ok = true;
  writeLookupGateStatus();
}

/**
 * A `fetch` that refuses for one host from the nth request onwards, with the
 * same `TypeError` iOS raises when the network goes. Installed and removed by
 * command, so a failure can be made to happen at a chosen moment.
 */
const realFetch = globalThis.fetch;
export function breakFetch(host: string, from: number): void {
  if (!DEBUG_MODE) return;
  if (lookupGate?.snapshot().installed) return hlog('fetch hook refused: lookup gate installed');
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
  if (!DEBUG_MODE) return;
  lookupGate?.restore('unbreakfetch');
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
  if (!DEBUG_MODE) return;
  if (lookupGate?.snapshot().installed) return hlog('fetch hook refused: lookup gate installed');
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url.includes(host)) hlog(`fetch ${init?.method ?? 'GET'} ${url}${typeof init?.body === 'string' ? ` ${init.body.slice(0, 400)}` : ''}`);
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
  hlog(`fetch watched for ${host}`);
}
