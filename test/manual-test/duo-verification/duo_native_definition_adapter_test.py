#!/usr/bin/env python3
"""Host-only artifact checks for duo-visible-definition.sh, never its native shell."""
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


class DuoNativeDefinitionAdapterHostTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='duo-native-adapter-host-')
        self.addCleanup(self.directory.cleanup)
        self.output = Path(self.directory.name)
        self.config = self.output / 'native-config.json'
        self.config.write_text(json.dumps({'runID': 'host-run'}))
        (self.output / 'test-host.log').write_text('Executed 1 test, with 0 failures\n')
        (self.output / 'summary-host.json').write_text(json.dumps({'result': 'Passed', 'failedTests': 0, 'passedTests': 1}))
        self.attachments = self.output / 'attachments-host'
        self.attachments.mkdir()
        self.manifest = [{'testIdentifier': 'DuoAcceptanceLookupProbe/testVisibleDefinition()', 'attachments': [
            {'deviceId': 'HOST-ONLY', 'exportedFileName': 'receipt.txt', 'suggestedHumanReadableName': 'host-run-native-definition-receipt_0.txt'},
            {'deviceId': 'HOST-ONLY', 'exportedFileName': 'screen.png', 'suggestedHumanReadableName': 'host-run-visible-definition-screen0_0.png'},
        ]}]
        (self.attachments / 'receipt.txt').write_text('HOST ONLY: simulated executed receipt, no native test')
        (self.attachments / 'screen.png').write_bytes(b'HOST ONLY: intentionally not native image data')

    def check_artifacts(self):
        (self.attachments / 'manifest.json').write_text(json.dumps(self.manifest))
        script = Path(__file__).with_name('duo-visible-definition.sh').read_text()
        python = script.split("<<'PY'\n", 1)[1].rsplit('\nPY', 1)[0]
        stdout = io.StringIO()
        with patch.object(sys, 'argv', ['host-artifact-check', str(self.output), str(self.config), 'HOST-ONLY']), contextlib.redirect_stdout(stdout):
            exec(compile(python, 'duo-visible-definition-host-artifact-check', 'exec'), {'__name__': '__host_test__'})
        return stdout.getvalue()

    def test_matching_artifacts_still_demand_actual_pixel_review(self):
        output = self.check_artifacts()
        self.assertIn('HOST ONLY', output)
        self.assertIn('active-display definition pixels still require review', output)

    def test_other_device_and_stale_run_are_rejected(self):
        self.manifest[0]['attachments'][0]['deviceId'] = 'ANOTHER-DEVICE'
        with self.assertRaisesRegex(SystemExit, 'another simulator'):
            self.check_artifacts()
        self.manifest[0]['attachments'][0]['deviceId'] = 'HOST-ONLY'
        self.manifest[0]['attachments'][0]['suggestedHumanReadableName'] = 'old-run-native-definition-receipt_0.txt'
        with self.assertRaisesRegex(SystemExit, 'this run'):
            self.check_artifacts()

    def test_missing_screenshot_and_failed_test_summary_are_rejected(self):
        self.manifest[0]['attachments'].pop()
        with self.assertRaisesRegex(SystemExit, 'screenshots'):
            self.check_artifacts()
        (self.output / 'summary-host.json').write_text(json.dumps({'result': 'Failed', 'failedTests': 1, 'passedTests': 0}))
        with self.assertRaisesRegex(SystemExit, 'exactly one passing'):
            self.check_artifacts()


if __name__ == '__main__':
    unittest.main()
