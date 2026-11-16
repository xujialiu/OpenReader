#!/usr/bin/env node
// Classify the cached single-test StoreKit diagnostic without treating an
// empty allTransactions result as a purchase success. This is a fast
// diagnostic observer, not the full run-storekit-ui.sh acceptance validator.
//
//   node classify-storekit-fast.js TEST_LOG_PATH
//
// Exit status: 0 GREEN, 1 RED, 69 BLOCKED/ambiguous.
const fs = require('node:fs');

function firstMatch(raw, pattern) {
  return raw.match(pattern)?.[0] ?? '';
}

function classify(raw) {
  const mode = firstMatch(raw, /^PROBE-MODE\s+\S+/m);
  const before = firstMatch(raw, /^PROBE-TRANSACTIONS-BEFORE\s+\d+/m);
  const afterLine = firstMatch(raw, /^PROBE-TRANSACTIONS-AFTER\s+\d+\s+\[[^\]]*\]/m);
  const ledgerLine = firstMatch(raw, /^PROBE-TX-LEDGER\s+\[[^\]]*\]/m);
  const testStarted = /Test Case .*test01BuyTrialAndSeeDaysLeft\]' started\./.test(raw);
  const testPassed = /Test Case .*test01BuyTrialAndSeeDaysLeft\]' passed \(/.test(raw);
  const testFailed = /Test Case .*test01BuyTrialAndSeeDaysLeft\]' failed \(/.test(raw);
  const zeroFailures = /Executed\s+\d+\s+tests?, with (?:\d+ tests? skipped and )?0 failures/.test(raw);
  const oneFailure = /Executed\s+\d+\s+tests?, with (?:\d+ tests? skipped and )?1 failures?/.test(raw);
  const storeKitError = /SK(?:Internal|Service)ErrorDomain/.test(raw);
  const trialLedger = [afterLine, ledgerLine].some((line) =>
    /(?:top\.xujialiu\.openreader\.)?trial#id\d+/.test(line),
  );

  const evidence = {
    mode,
    before,
    afterLine,
    ledgerLine,
    testStarted,
    testPassed,
    testFailed,
    zeroFailures,
    oneFailure,
    storeKitError,
    trialLedger,
  };

  if (mode === 'PROBE-MODE establish' && testPassed && zeroFailures && trialLedger) {
    return { classification: 'GREEN', evidence, reason: 'passed test with a Trial transaction ledger' };
  }
  if (mode === 'PROBE-MODE establish' && testStarted && testFailed && oneFailure && storeKitError) {
    return { classification: 'RED', evidence, reason: 'establish test failed with a StoreKit error domain' };
  }
  return { classification: 'BLOCKED', evidence, reason: 'missing complete green or red evidence' };
}

if (require.main === module) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: classify-storekit-fast.js TEST_LOG_PATH');
    process.exit(2);
  }
  const result = classify(fs.readFileSync(path, 'utf8'));
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.classification === 'GREEN' ? 0 : result.classification === 'RED' ? 1 : 69);
}

module.exports = { classify };
