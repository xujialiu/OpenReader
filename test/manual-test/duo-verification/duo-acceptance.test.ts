import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import vm from 'node:vm';
import { describe, expect, it, onTestFinished } from 'vitest';

const require = createRequire(import.meta.url);
const { lookupReceipt } = require('./duo-lookup-receipt.cjs');
const source = (name: string) => readFileSync(join(__dirname, name), 'utf8');

// Explicit host doubles: these tests validate evidence plumbing, not Safari,
// native painting/handles, audio output, or an application defect.
const parsedControl = () => ({
  observedAt: 1600, selection: { text: 'hope', selecting: false, mode: 'dictionary', attempt: 0 },
  loading: false, error: null, result: { text: 'noun\nA confident expectation of a future outcome.', source: 'Free Dictionary API' },
  traffic: null,
  gate: { installed: true, count: 1, waiting: false, aborted: false,
    requests: [{ url: 'https://api.dictionaryapi.dev/api/v2/entries/en/hope', state: 'released', startedAt: 1000, heldAt: 1100, releasedAt: 1500, abortedAt: null }] },
});

describe('duo-lookup-receipt evidence gate', () => {
  it('creates only a PARSED native-test input, with an actual definition line', () => {
    const receipt = lookupReceipt(parsedControl(), 'run-351');
    expect(receipt).toMatchObject({ query: 'hope', releaseMs: 500, parsedObservedMs: 600,
      definitionExcerpt: 'A confident expectation of a future outcome.' });
    expect(receipt.limit).toContain('Parsed state only');
  });
  it('rejects the old transport-only report shape, a spinner and a missing definition', () => {
    expect(() => lookupReceipt({ status: 'response-delivered-across-window-change' }, 'old')).toThrow('held gate');
    const pending = parsedControl(); pending.loading = true;
    expect(() => lookupReceipt(pending, 'pending')).toThrow('loading');
    const empty = parsedControl(); empty.result.text = 'noun\nhope';
    expect(() => lookupReceipt(empty, 'empty')).toThrow('substantial definition');
  });
  it('rejects a duplicate, abort, changed query, restored gate and a late parsed observation', () => {
    for (const change of [
      (s: ReturnType<typeof parsedControl>) => { s.gate.count = 2; },
      (s: ReturnType<typeof parsedControl>) => { s.gate.aborted = true; },
      (s: ReturnType<typeof parsedControl>) => { s.selection.text = 'chapter'; },
      (s: ReturnType<typeof parsedControl>) => { s.gate.installed = false; },
      (s: ReturnType<typeof parsedControl>) => { s.observedAt = 16000; },
      (s: ReturnType<typeof parsedControl>) => { s.gate.requests[0].releasedAt = 900; },
    ]) {
      const snapshot = parsedControl(); change(snapshot);
      expect(() => lookupReceipt(snapshot, 'invalid')).toThrow();
    }
  });
});

describe('DuoAcceptanceLookupTraffic passthrough', () => {
  it('forwards every real call exactly once without reading headers/body; restores the same fetch', async () => {
    const calls: unknown[][] = [];
    const response = { status: 200 };
    const original = (...args: unknown[]) => { calls.push(args); return Promise.resolve(response); };
    const context = vm.createContext({ fetch: original, URL, Date });
    vm.runInContext(source('DuoAcceptanceLookupTraffic.js'), context);
    const init = { headers: { Authorization: 'SECRET-HOST-TEST' }, body: 'SECRET-HOST-TEST' };
    expect(await context.fetch('https://aidemo.youdao.com/trans', init)).toBe(response);
    expect(await context.fetch('https://example.invalid/unrelated', init)).toBe(response);
    expect(calls).toEqual([
      ['https://aidemo.youdao.com/trans', init], ['https://example.invalid/unrelated', init],
    ]);
    expect(context.__duoAcceptanceLookupTraffic.requests).toHaveLength(1);
    expect(JSON.stringify(context.__duoAcceptanceLookupTraffic.requests)).not.toContain('SECRET');
    context.__duoAcceptanceLookupTraffic.restore();
    expect(context.fetch).toBe(original);
    expect(context.__duoAcceptanceLookupTraffic).toBeUndefined();
  });
  it('does not mask rejections/aborts and refuses stacking over the held gate', async () => {
    let reject!: (error: Error) => void;
    const context = vm.createContext({ fetch: () => new Promise((_resolve, fail) => { reject = fail; }), URL, Date });
    vm.runInContext(source('DuoAcceptanceLookupTraffic.js'), context);
    const abort = new AbortController();
    const result = context.fetch('https://api.dictionaryapi.dev/api/v2/entries/en/hope', { signal: abort.signal });
    abort.abort();
    const error = new Error('aborted'); reject(error);
    await expect(result).rejects.toBe(error);
    expect(context.__duoAcceptanceLookupTraffic.requests[0].abortedAt).toEqual(expect.any(Number));
    expect(context.__duoAcceptanceLookupTraffic.requests[0].failedAt).toEqual(expect.any(Number));
    context.__duoAcceptanceLookupTraffic.restore();
    context.__hopeGate = {};
    expect(() => vm.runInContext(source('DuoAcceptanceLookupTraffic.js'), context)).toThrow('existing lookup observer');
  });
});

describe('duo-pending-lookup coordinator with a host-only fake CDP peer', () => {
  for (const scenario of ['complete', 'duplicate', 'missing-native-log']) {
    const duplicateAfterNative = scenario === 'duplicate';
    it(`host scenario ${scenario}: requires action provenance and retains visual review as a gate`, async () => {
      const directory = mkdtempSync(join(tmpdir(), 'duo-pending-host-'));
      onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
      let installed = false, released = false, restored = false, parsedReads = 0, windowReads = 0;
      const start = Date.now();
      const request = { url: 'https://api.dictionaryapi.dev/api/v2/entries/en/hope', state: 'held',
        startedAt: start, heldAt: start + 1, releasedAt: null as number | null, abortedAt: null };
      const gate = () => ({ now: Date.now(), installed, count: duplicateAfterNative && parsedReads >= 2 ? 2 : 1,
        waiting: !released, aborted: false, requests: [request] });
      const server = createServer((_request, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify([{ appId: 'top.xujialiu.openreader', deviceName: 'HOST-ONLY-DUO',
          webSocketDebuggerUrl: `ws://127.0.0.1:${port}` }]));
      });
      const { Server: WebSocketServer } = require('ws');
      const sockets = new WebSocketServer({ server });
      sockets.on('connection', (socket: { on: (event: string, callback: (bytes: Buffer) => void) => void; send: (data: string) => void }) => {
        socket.on('message', bytes => {
          const message = JSON.parse(bytes.toString());
          const expression = message.params.expression as string;
          let value: unknown;
          if (expression.includes('const found = []')) {
            if (!installed) value = { selection: null, gate: null, traffic: null };
            else {
              parsedReads++;
              value = { ...parsedControl(), observedAt: Date.now(), gate: gate() };
            }
          } else if (expression.includes('dimensions.get')) {
            value = { width: windowReads++ ? 951 : 466, height: 678 };
          } else if (expression.includes('runtime.__hopeGate = gate')) {
            installed = true; value = 'installed';
          } else if (expression.includes('const released = g.release()')) {
            released = true; request.state = 'released'; request.releasedAt = Date.now();
            value = { ...gate(), released: 1 };
          } else if (expression.includes('g.restore()')) {
            restored = true; installed = false; value = 'restored';
          } else value = gate();
          socket.send(JSON.stringify({ id: message.id, result: { result: { type: typeof value, value } } }));
        });
      });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Host fixture did not listen');
      const port = address.port;
      const fold = join(directory, 'fold.sh'), native = join(directory, 'native.sh');
      writeFileSync(fold, 'set -eu\nprintf "HOST ONLY: no native input\\n"\n');
      writeFileSync(native, scenario === 'missing-native-log'
        ? 'set -eu\ntest -f "$1"\nprintf "HOST ONLY: empty successful helper\\n"\n'
        : `set -eu\n${JSON.stringify(process.execPath)} - "$1" <<'JS'\nconst r=require(process.argv[2]);\nconsole.log('HOST ONLY: simulated log markers, no XCTest/native visibility');\nconsole.log('DuoAcceptanceLookup-v1 runID='+r.runID+' config=host-fixture');\nconsole.log('DuoAcceptanceLookup native-definition-observedAt='+Date.now()/1000+' runID='+r.runID+' query=host-fixture');\nconsole.log('Executed 1 test, with 0 failures');\nJS\n`);
      const output = join(directory, 'attempt');
      try {
        let exit = 0;
        try {
          await promisify(execFile)(process.execPath, [join(__dirname, 'duo-pending-lookup.cjs'), 'HOST-ONLY-DUO',
            `http://127.0.0.1:${port}`, fold, native, output], { timeout: 15000 });
        } catch (error) { exit = Number((error as { code: number }).code); }
        const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
        expect(restored).toBe(true);
        expect(report.cleanup).toBe('restored');
        expect(readFileSync(join(output, 'native-result.json'), 'utf8')).toContain('definitionExcerpt');
        if (scenario !== 'complete') {
          expect(exit).toBe(1);
          expect(report.status).toBe('CONTROL_INCOMPLETE');
          expect(report.error).toContain(duplicateAfterNative ? 'count changed' : 'executed definition markers');
        } else {
          expect(exit).toBe(0);
          expect(report.status).toBe('TRANSPORT_PARSED_NATIVE_ASSERTION_COMPLETE_VISUAL_REVIEW_PENDING');
          expect(report.events.map((event: { action: string }) => event.action)).toEqual([
            'actual-fold-start', 'actual-fold-complete', 'native-visible-definition-start', 'native-visible-definition-complete',
          ]);
        }
      } finally {
        for (const socket of sockets.clients) socket.terminate();
        await new Promise<void>(resolve => sockets.close(() => resolve()));
        await new Promise<void>(resolve => server.close(() => resolve()));
        rmSync(directory, { recursive: true, force: true });
      }
    }, 20000);
  }
});

describe('DuoAcceptanceWordTrace bounded observation lifecycle', () => {
  it('records real-shaped messages and visible word ranges, forwards unchanged, auto-restores and exports raw data', () => {
    const callbacks: ((at: number) => void)[] = [];
    const timers: (() => void)[] = [];
    const delivered: unknown[] = [];
    const original = (message: unknown) => { delivered.push(message); return 'original-result'; };
    const rect = { left: 10, top: 20, width: 30, height: 16 };
    const range = { toString: () => 'hope', getClientRects: () => [rect] };
    const window = {
      innerWidth: 382, innerHeight: 678, __openReaderHighlighter: original,
      requestAnimationFrame: (f: (at: number) => void) => { callbacks.push(f); return callbacks.length; },
      cancelAnimationFrame: () => {}, setTimeout: (f: () => void, ms: number) => { expect(ms).toBe(10000); timers.push(f); return 1; },
      clearTimeout: () => {},
    };
    const context = vm.createContext({ window, Date, performance: { now: () => 25, timeOrigin: 1000 },
      rendition: { manager: {
        container: { getBoundingClientRect: () => ({ left: 0, top: 0 }), clientWidth: 382, clientHeight: 678, scrollTop: 5 },
        views: { _views: [{ displayed: true, section: { index: 0 }, iframe: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
          contents: { document: { defaultView: {} }, window: { CSS: { highlights: new Map([['openreader-word', [range]]]) } }, cfiFromRange: () => 'epubcfi(test)' } }] },
      } },
    });
    const armed = JSON.parse(vm.runInContext(source('DuoAcceptanceWordTrace.js') + '\nprobe()', context));
    expect(armed.maximumMs).toBe(10000);
    const cue = { kind: 'speak', utterance: 2, words: [{ atMs: 0, ranges: [] }] };
    expect(window.__openReaderHighlighter(cue)).toBe('original-result');
    expect(delivered).toEqual([cue]);
    callbacks[0](50);
    timers[0]();
    expect(window.__openReaderHighlighter).toBe(original);
    const exported = JSON.parse(vm.runInContext(source('DuoAcceptanceWordTraceRead.js') + '\nprobe()', context));
    expect(exported.marker).toBe('DuoAcceptanceWordTrace-v1');
    expect(exported.messages[0]).toMatchObject(cue);
    expect(exported.frames[0].words[0]).toMatchObject({ text: 'hope', rect: [10, 20, 30, 16] });
    expect(exported.errors).toEqual([]);
    expect(exported.overflow).toBe(false);
    vm.runInContext(source('DuoAcceptanceWordTraceClear.js') + '\nprobe()', context);
    expect(context.window.__duoAcceptanceWordTrace).toBeUndefined();
  });
});
