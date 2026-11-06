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
  const skipped = (raw.match(/skipped \(/g) ?? []).length;
  const failed = (raw.match(/ failed \(/g) ?? []).length;
  const executed = line(/^\s*Executed .* test/);
  const summary = line(/Executed \d+ tests?.*failures/);

  if (!/^Test (Suite|Case)/m.test(raw)) problems.push('no test activity in the log');
  if (mode === 'establish') {
    if (!/^PROBE-MODE establish$/m.test(raw)) problems.push(`establish marker missing (saw: ${modeMarker || 'none'})`);
    if (!/test01BuyTrialAndSeeDaysLeft.*passed \(/.test(raw)) problems.push('test01 did not pass');
    if (!/test02BuyUnlockAndSeeUnlocked.*passed \(/.test(raw)) problems.push('test02 did not pass');
    if (!/^PROBE-TX-LEDGER \[.+#id\d+/m.test(raw)) problems.push('no PROBE-TX-LEDGER captured');
    if (/test03RetainedPurchasesWithoutANewPurchase\).*passed \(/.test(raw)) problems.push('test03 ran in establish mode');
    if (/^PROBE-KEPT-TX /m.test(raw)) problems.push('verify-only marker present in establish run');
  } else if (mode === 'verify') {
    if (!/^PROBE-MODE verify$/m.test(raw)) problems.push(`verify marker missing (saw: ${modeMarker || 'none'})`);
    if (/test01BuyTrialAndSeeDaysLeft.*passed \(/.test(raw) || /^PROBE-TRANSACTIONS-BEFORE /m.test(raw)) problems.push('a buying test executed in verify mode');
    if (/test02BuyUnlockAndSeeUnlocked.*passed \(/.test(raw)) problems.push('test02 executed in verify mode');
    if (!/test03RetainedPurchasesWithoutANewPurchase.*passed \(/.test(raw)) problems.push('test03 did not pass');
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
  if (skipped > 0 && /with \d+ tests? skipped/.test(summary) && /3 tests skipped/.test(summary)) {
    problems.push('every test skipped');
  }
  if (failed > 0) problems.push(`${failed} failing assertions recorded`);
  if (/Executed 0 tests/.test(executed)) problems.push('zero tests executed');
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
