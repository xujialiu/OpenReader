#!/usr/bin/env node
// Validates one run-storekit-ui.sh test log against the requested mode, so the
// wrapper cannot mistake an all-skipped, modeless, or repurchasing run for a
// pass. Exits 0 only when the requested phase's acceptance methods ran and
// passed with zero failures.
//
//   node validate-ui-summary.js <mode: establish|verify> <TEST_LOG_PATH>
//
// establish requires: PROBE_MODE establish marker, test01+test02 passed,
// test03 skipped, a PROBE-TX-LEDGER line, and no verify-only execution.
// verify requires: PROBE_MODE verify marker, test03 passed, test01+test02
// skipped, a nonempty PROBE-KEPT-TX ledger equal to EXPECTED_TX when provided,
// and no buying-test execution (no PROBE-TRANSACTIONS-BEFORE at line start).
const fs = require('node:fs');

function validate(mode, logPath) {
  const problems = [];
  const raw = fs.readFileSync(logPath, 'utf8');
  const line = (re) => raw.split('\n').find((l) => re.test(l)) ?? '';
  const modeMarker = line(/^PROBE-MODE /m);
  const methods = [...raw.matchAll(/^Test Case '?-\[[^\]]+ (\w+)\]'? (passed|failed|skipped) \(/gm)];
  const ran = (name, status) => methods.filter((match) => match[1] === name && match[2] === status).length === 1;
  const failed = methods.filter((match) => match[2] === 'failed').length;
  const summaries = [...raw.matchAll(/^\s*Executed (\d+) tests?, with (?:(\d+) tests? skipped and )?(\d+) failures/gm)];
  const summary = line(/^\s*Executed \d+ tests?.*failures/);
  if (methods.length !== 3 || summaries.length === 0 || summaries.some((match) =>
    Number(match[1]) !== 3 || Number(match[2] ?? 0) !== (mode === 'establish' ? 1 : 2) || Number(match[3]) !== 0)) {
    problems.push('missing or inconsistent zero-failure execution summary');
  }

  if (!/^Test (Suite|Case)/m.test(raw)) problems.push('no test activity in the log');
  if (mode === 'establish') {
    if (!/^PROBE-MODE establish$/m.test(raw)) problems.push(`establish marker missing (saw: ${modeMarker || 'none'})`);
    if (!ran('test01BuyTrialAndSeeDaysLeft', 'passed')) problems.push('test01 did not pass');
    if (!ran('test02BuyUnlockAndSeeUnlocked', 'passed')) problems.push('test02 did not pass');
    if (!/^PROBE-TX-LEDGER \[.+#id\d+/m.test(raw)) problems.push('no PROBE-TX-LEDGER captured');
    if (!ran('test03RetainedPurchasesWithoutANewPurchase', 'skipped')) problems.push('test03 was not skipped in establish mode');
    if (/^PROBE-KEPT-TX /m.test(raw)) problems.push('verify-only marker present in establish run');
  } else if (mode === 'verify') {
    if (!/^PROBE-MODE verify$/m.test(raw)) problems.push(`verify marker missing (saw: ${modeMarker || 'none'})`);
    if (!ran('test01BuyTrialAndSeeDaysLeft', 'skipped') || /^PROBE-(?:TRANSACTIONS-BEFORE|TRANSACTIONS-AFTER|TX-LEDGER) /m.test(raw)) problems.push('a buying test executed in verify mode');
    if (!ran('test02BuyUnlockAndSeeUnlocked', 'skipped')) problems.push('test02 was not skipped in verify mode');
    if (!ran('test03RetainedPurchasesWithoutANewPurchase', 'passed')) problems.push('test03 did not pass');
    const kept = line(/^PROBE-KEPT-TX /m);
    if (!/^PROBE-KEPT-TX (?!0\b)\d+ \[.+#id\d+.+\]$/m.test(kept)) problems.push(`kept-transaction ledger missing/empty (${kept || 'none'})`);
    const expected = process.env.EXPECTED_TX;
    if (expected) {
      if (kept && !kept.includes(`[${expected}]`)) problems.push(`kept ledger differs from EXPECTED_TX (${expected})`);
    } else {
      problems.push('EXPECTED_TX not provided to the validator');
    }
  } else {
    problems.push(`unknown mode ${mode}`);
  }
  if (methods.length > 0 && methods.every((match) => match[2] === 'skipped')) problems.push('every test skipped');
  if (failed > 0) problems.push(`${failed} failing tests recorded`);
  return { ok: problems.length === 0, problems, modeMarker, summary };
}

if (require.main === module) {
  const [mode, logPath] = process.argv.slice(2);
  if (!mode || !logPath || !['establish', 'verify'].includes(mode)) {
    console.error('usage: validate-ui-summary.js establish|verify TEST_LOG_PATH');
    process.exit(2);
  }
  const result = validate(mode, logPath);
  console.log(`VALIDATE ${result.ok ? 'PASS' : 'FAIL'} ${logPath} mode=${mode}`);
  for (const p of result.problems) console.log(`  problem: ${p}`);
  process.exit(result.ok ? 0 : 1);
}
module.exports = { validate };
