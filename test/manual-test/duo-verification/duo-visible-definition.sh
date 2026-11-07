#!/bin/bash
# #351 native assertion adapter. Run INSIDE the tester's admitted phase, with a
# prebuilt probe directory. The final image still needs active-display review.
set -euo pipefail
if [[ $# -ne 3 ]]; then
  echo 'Usage: duo-visible-definition.sh SIMULATOR_UDID PREBUILT_PROBE_DIR ABSOLUTE_CONFIG_JSON' >&2
  exit 2
fi
udid=$1
output=$2
config=$3
root=$(cd "$(dirname "$0")/../../.." && pwd)
bash "$root/test/manual-test/kit/run-probe.sh" DuoAcceptanceLookupProbe "$udid" "$output" \
  --mode "$config" -only-testing:DuoAcceptanceLookupProbe/testVisibleDefinition \
  -collect-test-diagnostics never
# Prints may be absent with diagnostics disabled. Verify the actual exported
# test attachment, method, run ID, device, screenshot files and fresh summary.
python3 - "$output" "$config" "$udid" <<'PY'
import json
from pathlib import Path
import re
import sys

output, config, udid = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
run_id = json.loads(config.read_text())['runID']
logs = list(output.glob('test-*.log'))
if not logs:
    raise SystemExit('BLOCKED: no executed native test log')
log = max(logs, key=lambda file: file.stat().st_mtime_ns)
stamp = log.name[len('test-'):-len('.log')]
summary = json.loads((output / ('summary-' + stamp + '.json')).read_text())
if summary.get('result') != 'Passed' or summary.get('failedTests') != 0 or summary.get('passedTests') != 1:
    raise SystemExit('BLOCKED: require exactly one passing native test')
text = log.read_text()
lines = re.findall(r'Executed [1-9][0-9]* test[^\n]*, with 0 failures[^\n]*', text)
if not lines or re.search(r'Executed .*with [1-9][0-9]* failures', text):
    raise SystemExit('BLOCKED: missing unambiguous execution result')
attachments = output / ('attachments-' + stamp)
manifest = json.loads((attachments / 'manifest.json').read_text())
receipts, images = [], []
for test in manifest:
    if test.get('testIdentifier') != 'DuoAcceptanceLookupProbe/testVisibleDefinition()':
        continue
    for attachment in test.get('attachments', []):
        if attachment.get('deviceId', '').upper() != udid.upper():
            raise SystemExit('BLOCKED: native attachment belongs to another simulator')
        name = attachment.get('suggestedHumanReadableName', '')
        file = attachments / attachment['exportedFileName']
        if not file.is_file():
            raise SystemExit('BLOCKED: exported native attachment missing')
        if name.startswith(run_id + '-native-definition-receipt'):
            receipts.append(file.read_text())
        if name.startswith(run_id + '-visible-definition-screen') and file.suffix.lower() == '.png':
            images.append(str(file))
if len(receipts) != 1 or not images:
    raise SystemExit('BLOCKED: require this run\'s native definition receipt and screenshots')
print(receipts[0])
print(lines[-1])
print(json.dumps({'nativeImagesForVisualReview': images, 'limit': 'Native assertions completed; active-display definition pixels still require review.'}))
PY
