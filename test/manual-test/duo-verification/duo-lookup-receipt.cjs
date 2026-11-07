#!/usr/bin/env node
// Offline check of a real DuoAcceptanceLookupState CDP snapshot. This produces
// a native-test input, NOT a visible-result/native acceptance verdict.
const fs = require('node:fs');
const path = require('node:path');

function lookupReceipt(snapshot, runID) {
  const requireFact = (value, message) => { if (!value) throw new Error(message); };
  requireFact(typeof runID === 'string' && /^[a-zA-Z0-9_-]+$/.test(runID), 'Use a nonempty run ID without spaces');
  const { gate, selection, result, observedAt } = snapshot;
  requireFact(gate?.installed === true && !snapshot.traffic, 'Require the held gate alone, still installed through native capture');
  requireFact(gate.count === 1 && gate.requests?.length === 1 && !gate.aborted && !gate.waiting, 'Require one released, non-aborted request');
  const request = gate.requests[0];
  requireFact(request.state === 'released' && request.abortedAt === null, 'Request was not released normally');
  const times = [request.startedAt, request.heldAt, request.releasedAt, observedAt];
  requireFact(times.every(Number.isFinite), 'Missing real request/parse observation timestamps');
  requireFact(times.every((value, i) => i === 0 || value >= times[i - 1]), 'Request/parse timestamps are out of order');
  requireFact(request.releasedAt - request.startedAt < 12000, 'Release exceeded the pre-timeout control budget');
  requireFact(observedAt - request.startedAt < 15000, 'Parsed result not observed inside the actual 15-second deadline');
  requireFact(selection?.mode === 'dictionary' && !selection.selecting && snapshot.loading === false && snapshot.error === null, 'Selection still dragging/loading, not Dictionary, or errored');
  const url = new URL(request.url);
  const prefix = '/api/v2/entries/en/';
  requireFact(url.origin === 'https://api.dictionaryapi.dev' && url.pathname.startsWith(prefix), 'Not the real English dictionary control');
  requireFact(decodeURIComponent(url.pathname.slice(prefix.length)) === selection.text.trim(), 'Query differs from the held request');
  requireFact(result?.source === 'Free Dictionary API' && typeof result.text === 'string', 'No actual parsed dictionary result');
  // A part-of-speech label or the query itself is not definition evidence.
  const definitionExcerpt = result.text.split('\n').map(s => s.trim()).find(s => s.length >= 20 && s !== selection.text);
  requireFact(definitionExcerpt, 'No substantial definition line for the native assertion');
  return {
    runID, query: selection.text, definitionExcerpt, source: result.source,
    parsedObservedAt: observedAt, requestStartedAt: request.startedAt,
    releaseMs: request.releasedAt - request.startedAt,
    parsedObservedMs: observedAt - request.startedAt,
    limit: 'Parsed state only. Run DuoAcceptanceLookupProbe/testVisibleDefinition, review the active-display image, and recapture the gate count afterwards.',
  };
}

if (require.main === module) {
  const [input, output, runID] = process.argv.slice(2);
  if (!input || !output || !runID) {
    console.error('Usage: duo-lookup-receipt.cjs CDP_SNAPSHOT_JSON NEW_NATIVE_CONFIG_JSON RUN_ID'); process.exitCode = 2;
  } else {
    try {
      const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
      const receipt = lookupReceipt(raw.type === 'object' ? raw.value : raw, runID);
      fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
      fs.writeFileSync(output, JSON.stringify(receipt, null, 2), { flag: 'wx' });
      console.log(JSON.stringify({ status: 'PARSED_ONLY_NATIVE_PENDING', releaseMs: receipt.releaseMs, parsedObservedMs: receipt.parsedObservedMs, output }));
    } catch (error) { console.error(`INCOMPLETE CONTROL: ${error.message}`); process.exitCode = 1; }
  }
}
module.exports = { lookupReceipt };
