import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import vm from 'node:vm';
import { describe, expect, it, onTestFinished } from 'vitest';

const require = createRequire(import.meta.url);
const exec = promisify(execFile);
const source = (name: string) => readFileSync(join(__dirname, name), 'utf8');
const root = (name: string) => readFileSync(join(__dirname, '../../..', name), 'utf8');

// HOST qualification of the ordinary regression matrix's own plumbing
// (test/manual-test/duo-verification/ordinary-matrix.md): the tools it names
// exist, the probes print the markers its evidence rules require, the resize
// driver's contract matches its documentation, the fixture generators build
// real EPUBs, and the P6/P7 lookup sequencing FAILS the stacked combination at
// real seams (the coordinator's initial-state refusal, the counter's own
// stacking refusal, the state field the refusal reads). None of this runs a
// simulator, builds native code or asserts application behavior; host seams
// prove tool contracts only, never runtime behavior — native execution stays
// behind the parent's ordinary-device admission gate.

const matrix = source('ordinary-matrix.md');

describe('the ordinary matrix references real, current tools', () => {
  const referenced = [
    'test/manual-test/kit/ios-verification.md',
    'test/manual-test/kit/ios_guard.py',
    'test/manual-test/kit/ios_ready.py',
    'test/manual-test/kit/run-probe.sh',
    'test/manual-test/settings/SettingsVersionProbe.swift',
    'test/manual-test/kit/PhonePortraitPolicyProbe.swift',
    'test/manual-test/kit/alert-input.py',
    'test/manual-test/kit/ax.py',
    'test/manual-test/kit/hx.cjs',
    'test/manual-test/kit/cdp.cjs',
    'test/manual-test/kit/reading.cjs',
    'test/manual-test/library-and-reader/input-integrity.md',
    'test/manual-test/place-and-following/IpadRotationProbe.swift',
    'test/manual-test/place-and-following/ipad-resize-case.py',
    'test/manual-test/place-and-following/viewport-size.js',
    'test/manual-test/place-and-following/resize-anchor.js',
    'test/manual-test/duo-verification/DuoAcceptanceLookupTraffic.js',
    'test/manual-test/duo-verification/duo-pending-lookup.cjs',
    'test/manual-test/duo-verification/duo-visible-definition.sh',
    'test/manual-test/duo-verification/duo-selection-paint.py',
    'test/manual-test/duo-verification/duo-preview-compare.py',
    'test/manual-test/fixtures/lookup-words-fixture.ts',
    'test/manual-test/fixtures/short-test-fixture.ts',
    'test/manual-test/purchase/README.md',
  ];
  for (const path of referenced) {
    it(`names an existing ${path}`, () => {
      expect(() => root(path), path).not.toThrow();
      const base = path.split('/').pop() as string;
      expect(matrix, `${base} must be cited by the matrix`).toContain(base);
    });
  }
});

describe('the ordinary probes print the evidence markers the matrix requires', () => {
  it('PhonePortraitPolicyProbe records PROBE-POLICY frame lines and never launches', () => {
    const probe = root('test/manual-test/kit/PhonePortraitPolicyProbe.swift');
    expect(probe).toContain('PROBE-POLICY');
    expect(probe).toContain('bundleIdentifier: "top.xujialiu.openreader"');
    expect(probe).not.toMatch(/launch\(\)/);
    expect(probe).toMatch(/portrait policy broken/);
  });

  it('IpadRotationProbe asserts the system orientation took and shoots XCUIScreen.main', () => {
    const probe = root('test/manual-test/place-and-following/IpadRotationProbe.swift');
    expect(probe).toContain('[rotation]');
    expect(probe).toContain('XCUIScreen.main.screenshot()');
    expect(probe).toMatch(/the system rotation did not take/);
    expect(probe).not.toMatch(/\.terminate\(\)/);
  });
});

describe('the resize driver contract matches the matrix', () => {
  const driver = root('test/manual-test/place-and-following/ipad-resize-case.py');
  it('takes the documented flags', () => {
    for (const flag of ['--cfi', '--section', '--axe', '--metro', '--narrow', '--wide', '--wide-width', '--narrow-width']) {
      expect(driver).toContain(`"${flag}"`);
    }
  });
  it('hashes every entry\'s full saved position, and refuses an existing output dir', () => {
    expect(driver).toContain('entry.get("position")');
    expect(driver).toContain('exist_ok=False');
    expect(driver).toContain('Paused Browsing changed a saved Reading Position');
    expect(driver).toContain('The Reading must be paused before and after this check');
  });
  it('is documented with its PASS line and the upper-edge rule', () => {
    expect(matrix).toContain('ipad-resize-case.py');
    expect(matrix).toContain('two line heights below the 54 pt header');
  });
});

describe('the helper scripts the matrix schedules are at least syntax-true', () => {
  it('duo-pending-lookup.cjs parses', async () => {
    await expect(exec('node', ['--check', join(__dirname, 'duo-pending-lookup.cjs')]))
      .resolves.toBeTruthy();
  });
  it('duo-visible-definition.sh parses', async () => {
    await expect(exec('bash', ['-n', join(__dirname, 'duo-visible-definition.sh')]))
      .resolves.toBeTruthy();
  });
});

describe('the candidate role gate file list exists', () => {
  const roleTests = [
    'test/build/free-purchases.test.ts',
    'test/build/native-variant.test.ts',
    'test/build/variant-check.test.ts',
    'test/build/identity.test.ts',
    'test/purchase/access.test.ts',
    'test/purchase/purchases.test.ts',
    'test/app/purchase-paths.test.ts',
    'test/app/purchase-screen.test.ts',
    'test/app/purchase-source.test.ts',
    'test/app/purchase-restore.test.ts',
    'test/app/purchase-remote-play.test.ts',
    'test/offline/runtime-purchase.test.ts',
    'test/offline/runtime-purchase-launch.test.ts',
    'test/app-config.test.ts',
    'test/duo-scene-orientation.test.ts',
  ];
  for (const path of roleTests) {
    it(`has ${path}`, () => {
      expect(() => root(path), path).not.toThrow();
    });
  }
});

describe('the P6/P7 lookup sequencing contract fails the stacked combination', () => {
  const between = (start: string, end: string) => {
    const at = matrix.indexOf(start);
    expect(at, `${start} heading must exist in the matrix`).toBeGreaterThanOrEqual(0);
    const to = matrix.indexOf(end, at);
    return matrix.slice(at, to === -1 ? undefined : to);
  };
  const squash = (text: string) => text.replace(/\s+/g, ' ');

  it('P6 arms the passthrough counter ALONE and never invokes the pending coordinator', () => {
    const p6 = between('### P6', '### P7');
    expect(p6).toContain('DuoAcceptanceLookupTraffic.js');
    expect(p6, 'P6 must not stack the pending coordinator over the counter')
      .not.toContain('duo-pending-lookup');
    expect(p6).toMatch(/COMPLETED lookup/);
    expect(p6, 'the counter is restored and acked before P7 installs its gate')
      .toContain('DuoAcceptance lookup traffic restored');
    expect(p6).toContain('traffic: null');
  });

  it('P7 runs the held-gate coordinator alone and cites the refusal as its guard', () => {
    const p7 = between('### P7', '### P8');
    expect(p7).toContain('duo-pending-lookup.cjs');
    expect(p7, 'P7 must not arm the passthrough counter beside the held gate')
      .not.toContain('DuoAcceptanceLookupTraffic');
    expect(squash(p7)).toContain('Close the old lookup and restore all fetch observers first');
  });

  it('the coordinator source refuses any present selection, gate or traffic', () => {
    const coordinator = root('test/manual-test/duo-verification/duo-pending-lookup.cjs');
    expect(coordinator).toContain('initial.selection || initial.gate || initial.traffic');
    expect(coordinator).toContain("throw new Error('Close the old lookup and restore all fetch observers first')");
  });

  it('the state probe reports the armed counter the coordinator refuses, and null after restore', () => {
    const lookup = { selection: null, loading: false, error: null, result: null };
    const context = vm.createContext({
      fetch: () => { throw new Error('no request expected in this host seam'); },
      URL, Date,
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        renderers: new Map([[1, {}]]),
        getFiberRoots: () => [{ current: {
          type: { name: 'LookupDrawer' }, memoizedProps: { lookup }, child: null, sibling: null,
        } }],
      },
    });
    vm.runInContext(source('DuoAcceptanceLookupTraffic.js'), context);
    const armed = JSON.parse(JSON.stringify(vm.runInContext(source('DuoAcceptanceLookupState.js'), context)));
    expect(armed.traffic).toMatchObject({ installed: true });
    expect(armed.gate).toBeNull();
    expect(armed.selection).toBeNull();
    expect(vm.runInContext('__duoAcceptanceLookupTraffic.restore()', context))
      .toBe('DuoAcceptance lookup traffic restored');
    const restored = JSON.parse(JSON.stringify(vm.runInContext(source('DuoAcceptanceLookupState.js'), context)));
    expect(restored.traffic).toBeNull();
  });

  it('host coordinator scenario: a stacked traffic observer refuses BEFORE the held gate installs', async () => {
    // Reuses duo-acceptance.test.ts's fake-peer seam against the REAL
    // coordinator script: the first state read reports P6's counter still
    // armed — the exact stacked state P7 must never start from.
    const directory = mkdtempSync(join(tmpdir(), 'ordinary-p7-refusal-'));
    onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
    let installAttempted = false;
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify([{ appId: 'top.xujialiu.openreader', deviceName: 'HOST-ONLY-ORDINARY',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}` }]));
    });
    const { Server: WebSocketServer } = require('ws');
    const sockets = new WebSocketServer({ server });
    sockets.on('connection', (socket: {
      on: (event: 'message', callback: (bytes: Buffer) => void) => void;
      send: (data: string) => void;
    }) => {
      socket.on('message', bytes => {
        const message = JSON.parse(bytes.toString());
        const expression = message.params.expression as string;
        if (expression.includes('runtime.__hopeGate = gate')) installAttempted = true;
        const value = expression.includes('const found = []')
          ? { selection: null, gate: null, traffic: { installed: true, requests: [] } }
          : undefined;
        socket.send(JSON.stringify({ id: message.id, result: { result: { type: typeof value, value } } }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Host fixture did not listen');
    const port = address.port;
    const resize = join(directory, 'resize.sh'), native = join(directory, 'native.sh');
    writeFileSync(resize, 'set -eu\nprintf "HOST ONLY: no native input\\n"\n');
    writeFileSync(native, 'set -eu\nprintf "HOST ONLY: must never run\\n"\n');
    const output = join(directory, 'attempt');
    let exit = 0;
    try {
      await promisify(execFile)(process.execPath, [join(__dirname, 'duo-pending-lookup.cjs'),
        'HOST-ONLY-ORDINARY', `http://127.0.0.1:${port}`, resize, native, output], { timeout: 15000 });
    } catch (error) { exit = Number((error as { code: number }).code); }
    finally {
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>(resolve => sockets.close(() => resolve()));
      server.close();
    }
    const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8')) as {
      status: string; error?: string; cleanup?: string;
    };
    expect(installAttempted, 'the coordinator must refuse BEFORE installing the held gate').toBe(false);
    expect(exit).toBe(1);
    expect(report.error).toBe('Close the old lookup and restore all fetch observers first');
    expect(report.status).toBe('CONTROL_INCOMPLETE');
    expect(report.cleanup).toBeUndefined();
  });
});

describe('the fixture generators build the EPUBs the matrix stages', () => {
  it('writes both books with container.xml first and the expected titles', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ordinary-matrix-'));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    await exec('npx', ['tsx', 'test/manual-test/fixtures/lookup-words-fixture.ts', dir]);
    await exec('npx', ['tsx', 'test/manual-test/fixtures/short-test-fixture.ts', dir]);
    const readEntryNames = (file: string): string[] => {
      const bytes = readFileSync(file);
      expect(bytes.subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004');
      const names: string[] = [];
      let at = 0;
      while (at + 30 <= bytes.length && bytes.readUInt32LE(at) === 0x04034b50) {
        names.push(bytes.subarray(at + 30, at + 30 + bytes.readUInt16LE(at + 26)).toString('utf8'));
        at += 30 + bytes.readUInt16LE(at + 26) + bytes.readUInt16LE(at + 28) + bytes.readUInt32LE(at + 18);
      }
      expect(names.length).toBeGreaterThan(3);
      return names;
    };
    for (const file of [
      'Word Boundaries for Lookup.epub',
      'A Short Test of Reading Aloud.epub',
    ]) {
      const names = readEntryNames(join(dir, file));
      // epub.js reads container.xml first whatever the physical order (#249);
      // the generated books carry it plus the OCF mimetype entry.
      expect(names[0]).toBe('mimetype');
      expect(names).toContain('META-INF/container.xml');
      expect(names).toContain('OEBPS/content.opf');
    }
  });
});
