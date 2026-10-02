"""Selector and fail-closed checks; real-device evidence is in #123's report."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('alert_input', Path(__file__).with_name('alert-input.py'))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class AlertInputTests(unittest.TestCase):
    def test_exact_value_and_placeholder(self):
        helper.require_value('Fiction', 'Fiction', 'Name')
        helper.require_value('Name', '', 'Name')
        with self.assertRaises(ValueError):
            helper.require_value('FictionFictionx', 'Fictionx', 'Name')
        with self.assertRaises(ValueError):
            helper.require_value('Fictio', 'Fiction', 'Name')

    def test_requires_single_enabled_field_in_named_alert(self):
        field = {'type': 'TextField', 'enabled': True, 'AXValue': 'Fiction'}
        sheet = {'type': 'Sheet', 'AXLabel': 'Rename', 'children': [field]}
        self.assertIs(helper.alert_field([sheet], 'Rename'), field)
        for tree in ([], [field], [sheet, sheet]):
            with self.assertRaises(ValueError):
                helper.alert_field(tree, 'Rename')
        for fields in ([], [field, field], [{'type': 'SecureTextField', 'enabled': True}],
                       [{'type': 'TextField', 'enabled': False}]):
            with self.assertRaises(ValueError):
                helper.alert_field([dict(sheet, children=fields)], 'Rename')

    def test_other_alert_is_not_a_fallback(self):
        with self.assertRaises(ValueError):
            helper.alert_field([{'type': 'Sheet', 'AXLabel': 'Other', 'children': [
                {'type': 'TextField', 'enabled': True}]}], 'Rename')


if __name__ == '__main__':
    unittest.main()
