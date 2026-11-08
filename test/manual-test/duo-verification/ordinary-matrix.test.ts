import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, onTestFinished } from 'vitest';

const exec = promisify(execFile);
const source = (name: string) => readFileSync(join(__dirname, name), 'utf8');
const root = (name: string) => readFileSync(join(__dirname, '../../..', name), 'utf8');

// HOST qualification of the ordinary regression matrix's own plumbing
// (test/manual-test/duo-verification/ordinary-matrix.md): the tools it names
// exist, the probes print the markers its evidence rules require, the resize
// driver's contract matches its documentation, and the fixture generators
// build real EPUBs. None of this runs a simulator, builds native code or
// asserts application behavior; native execution stays behind the parent's
// ordinary-device admission gate.

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
