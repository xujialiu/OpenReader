import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';

import { validate } from '../manual-test/purchase/validate-ui-summary.js';

// Wrapper validation for purchase/run-storekit-ui.sh: an all-skipped, modeless
// or repurchasing run must never validate as a pass, and the specific
// acceptance methods must be present in a pass. Runs against temp log files.
const establish = [
  'Test Suite StoreKitSessionUI.xctest started',
  'Test Case -[StoreKitSessionUI.StoreKitSessionUI test01BuyTrialAndSeeDaysLeft] passed (7.1 seconds).',
  'Test Case -[StoreKitSessionUI.StoreKitSessionUI test02BuyUnlockAndSeeUnlocked] passed (7.6 seconds).',
  'Test Case -[StoreKitSessionUI.StoreKitSessionUI test03RetainedPurchasesWithoutANewPurchase] skipped (0.0 seconds).',
  'PROBE-MODE establish',
  'PROBE-TRANSACTIONS-BEFORE 0',
  'PROBE-TX-LEDGER [top.xujialiu.openreader.trial#id20#orig0,top.xujialiu.openreader.unlock#id21#orig0]',
  '\t Executed 3 tests, with 1 test skipped and 0 failures (0 unexpected) in 14.7 seconds',
].join('\n');
const goodIds = 'top.xujialiu.openreader.trial#id20#orig0,top.xujialiu.openreader.unlock#id21#orig0';
const verify = (ids: string, modeLine = 'PROBE-MODE verify') => [
  'Test Suite StoreKitSessionUI.xctest started',
  'Test Case -[StoreKitSessionUI.StoreKitSessionUI test01BuyTrialAndSeeDaysLeft] skipped (0.0 seconds).',
  'Test Case -[StoreKitSessionUI.StoreKitSessionUI test02BuyUnlockAndSeeUnlocked] skipped (0.0 seconds).',
  'Test Case -[StoreKitSessionUI.StoreKitSessionUI test03RetainedPurchasesWithoutANewPurchase] passed (8.2 seconds).',
  modeLine,
  `PROBE-KEPT-TX 2 [${ids}]`,
  '\t Executed 3 tests, with 2 tests skipped and 0 failures (0 unexpected) in 8.5 seconds',
].join('\n');

function writeTmp(content: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'ui-summary-')), 'test.log');
  writeFileSync(file, content);
  return file;
}

it('establish: a complete buying run validates', () => {
  const result = validate('establish', writeTmp(establish));
  expect(result.problems).toEqual([]);
  expect(result.ok).toBe(true);
});

it('establish: a modeless run (nothing executed) fails', () => {
  const log = establish
    .replace(/^PROBE-MODE establish$/m, '')
    .replace(/test01BuyTrialAndSeeDaysLeft.*passed \(/, 'test01BuyTrialAndSeeDaysLeft] skipped (')
    .replace(/test02BuyUnlockAndSeeUnlocked.*passed \(/, 'test02BuyUnlockAndSeeUnlocked] skipped (');
  const result = validate('establish', writeTmp(log));
  expect(result.ok).toBe(false);
  expect(result.problems.join(' ')).toContain('establish marker missing');
  expect(result.problems.join(' ')).toContain('test01 did not pass');
});

it('establish: a run with no ledger fails', () => {
  const log = establish.replace(/^PROBE-TX-LEDGER .*/m, 'PROBE-TRANSACTIONS-AFTER 1 [x]');
  const result = validate('establish', writeTmp(log));
  expect(result.ok).toBe(false);
  expect(result.problems.join(' ')).toContain('no PROBE-TX-LEDGER');
});

it('verify: retention with matching identities validates', () => {
  process.env.EXPECTED_TX = goodIds;
  const result = validate('verify', writeTmp(verify(goodIds)));
  expect(result.problems).toEqual([]);
  expect(result.ok).toBe(true);
  delete process.env.EXPECTED_TX;
});

it('verify: repurchasing fails (buying test executed)', () => {
  process.env.EXPECTED_TX = goodIds;
  const log = verify(goodIds).replace(
    'test01BuyTrialAndSeeDaysLeft] skipped (0.0 seconds).',
    'test01BuyTrialAndSeeDaysLeft] passed (7.1 seconds).',
  ) + '\nPROBE-TRANSACTIONS-BEFORE 0';
  const result = validate('verify', writeTmp(log));
  expect(result.ok).toBe(false);
  expect(result.problems.join(' ')).toContain('buying test executed');
  delete process.env.EXPECTED_TX;
});

it('verify: missing EXPECTED_TX fails closed', () => {
  delete process.env.EXPECTED_TX;
  const result = validate('verify', writeTmp(verify(goodIds)));
  expect(result.ok).toBe(false);
  expect(result.problems.join(' ')).toContain('EXPECTED_TX');
});

it('verify: changed transaction identities fail', () => {
  process.env.EXPECTED_TX = goodIds;
  const result = validate('verify', writeTmp(verify(goodIds.replace('id20', 'id99'))));
  expect(result.ok).toBe(false);
  expect(result.problems.join(' ')).toContain('differs from EXPECTED_TX');
  delete process.env.EXPECTED_TX;
});

it('verify: all-skipped modeless run fails', () => {
  const log = [
    'Test Suite StoreKitSessionUI.xctest started',
    'Test Case -[StoreKitSessionUI.StoreKitSessionUI test01BuyTrialAndSeeDaysLeft] skipped (0.0 seconds).',
    'Test Case -[StoreKitSessionUI.StoreKitSessionUI test02BuyUnlockAndSeeUnlocked] skipped (0.0 seconds).',
    'Test Case -[StoreKitSessionUI.StoreKitSessionUI test03RetainedPurchasesWithoutANewPurchase] skipped (0.0 seconds).',
    '\t Executed 3 tests, with 3 tests skipped and 0 failures (0 unexpected) in 0.1 seconds',
  ].join('\n');
  const result = validate('verify', writeTmp(log));
  expect(result.ok).toBe(false);
  expect(result.problems.join(' ')).toContain('verify marker missing');
});
