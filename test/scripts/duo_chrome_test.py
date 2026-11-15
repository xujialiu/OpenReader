#!/usr/bin/env python3
"""Host checks for the duo-chrome lookup oracle, not native drawer behavior.

Qualifies the ancestry-based selection committed after ios-qa-01's raw run:
the heading host must CONTAIN both segments (never a wider unrelated Group at
the same y), the sheet surface is the innermost Group around a full-width
content row, and the row's side gaps must stay symmetric. The old
RadioButton-union proxy failed the real, correctly-centred drawer by the
Picker's 8-point intrinsic width; that false-proxy failure is preserved here
as characterization, and a broad inherited side strip must still go RED.
"""
import argparse
import importlib.util
import math
import unittest
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / 'manual-test/library-and-reader/duo-chrome.py'
SPEC = importlib.util.spec_from_file_location('duo_chrome', PATH)
assert SPEC is not None and SPEC.loader is not None
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)

WINDOW = 466
GRABBER = {'type': 'Button', 'AXLabel': 'Sheet Grabber', 'frame': {'x': 183, 'y': 323.33, 'width': 100, 'height': 24}}


def tree(sheet_width=450, host_width=330, segment_x=68, union_width=314,
         content_x=32, content_width=401, extra_group=None):
    """A lookup drawer shaped like the measured ios-qa-01 native tree."""
    segment_w = union_width / 2
    sheet_x = 8
    host = {
        'type': 'Group', 'frame': {'x': segment_x, 'y': 350, 'width': host_width, 'height': 31},
        'children': [{
            'type': 'TabGroup', 'frame': {'x': segment_x, 'y': 350, 'width': union_width, 'height': 31},
            'children': [
                {'type': 'RadioButton', 'AXLabel': 'Dictionary',
                 'frame': {'x': segment_x, 'y': 350, 'width': segment_w, 'height': 32}},
                {'type': 'RadioButton', 'AXLabel': 'Translation',
                 'frame': {'x': segment_x + segment_w, 'y': 350, 'width': segment_w, 'height': 32}},
            ],
        }],
    }
    header = {'type': 'Group', 'frame': {'x': sheet_x, 'y': 327.33, 'width': sheet_width, 'height': 76},
              'children': [host]}
    if extra_group is not None:
        header['children'].append(extra_group)
    content = {'type': 'Group', 'frame': {'x': sheet_x, 'y': 403.33, 'width': sheet_width, 'height': 216.67},
               'children': [
                   {'type': 'StaticText', 'AXLabel': 'poverty',
                    'frame': {'x': content_x, 'y': 411.33, 'width': content_width, 'height': 26.33}},
               ]}
    sheet = {'type': 'Group', 'frame': {'x': sheet_x, 'y': 327.33, 'width': sheet_width, 'height': 342.67},
             'children': [header, content]}
    return {'type': 'Application', 'AXLabel': 'OpenReader',
            'frame': {'x': 0, 'y': 0, 'width': WINDOW, 'height': 678},
            'children': [{'type': 'Group', 'frame': {'x': 0, 'y': 0, 'width': WINDOW, 'height': 678},
                          'children': [
                              {'type': 'Heading', 'AXLabel': 'Shadow Slave 1-250',
                               'frame': {'x': 110, 'y': 8, 'width': 162, 'height': 20.33}},
                              {'type': 'Button', 'AXLabel': 'More actions',
                               'frame': {'x': 399, 'y': 239, 'width': 38, 'height': 38}},
                              GRABBER, sheet]}]}


ARGS = argparse.Namespace(surface='lookup', rail_start=382, title='Shadow Slave 1-250',
                          max_title_top=20, max_share_gap=32)


def old_union_centre(drawer_tree):
    """The retired RadioButton-union rule's measured centre (characterization)."""
    nodes = [n for n, _, _ in probe.ax.walk(drawer_tree)]
    dx = min(ax_frame(n)[0] for n in nodes if n.get('AXLabel') == 'Dictionary')
    tx = min(ax_frame(n)[0] for n in nodes if n.get('AXLabel') == 'Translation')
    tw = min(ax_frame(n)[2] for n in nodes if n.get('AXLabel') == 'Translation')
    return (dx + tx + tw) / 2


def ax_frame(node):
    frame = node['frame']
    return frame['x'], frame['y'], frame['width'], frame['height']


class DuoChromeLookupOracleTests(unittest.TestCase):
    def test_measured_drawer_is_green_with_ancestry_evidence(self):
        report = probe.inspect(tree(), ARGS)
        self.assertEqual(report['outcome'], 'PASS')
        values = report['values']
        # Host and sheet are centred on the grabber at 233; the union is not,
        # by the Picker's own intrinsic width — recorded, never decisive.
        self.assertEqual(values['lookupHeadingCentre'], 233.0)
        self.assertEqual(values['sheetGrabberCentre'], 233.0)
        self.assertEqual(values['sheetSurface'], {'x': 8, 'width': 450})
        row = values['contentRow']
        self.assertEqual((row['leftGap'], row['rightGap']), (32, 33))
        self.assertEqual(values['segmentedUnionCentre'], 225.0)
        self.assertGreater(abs(values['segmentedUnionCentre'] - values['sheetGrabberCentre']), 4)
        self.assertEqual(old_union_centre(tree()), 225.0)

    def test_wider_unrelated_group_at_same_y_is_not_the_host(self):
        # A same-y Group wider than the true host but holding no segments.
        impostor = {'type': 'Group', 'frame': {'x': 50, 'y': 350, 'width': 380, 'height': 31}, 'children': []}
        report = probe.inspect(tree(extra_group=impostor), ARGS)
        self.assertEqual(report['outcome'], 'PASS')
        self.assertEqual(report['values']['lookupHeadingCentre'], 233.0,
                         'the oracle picked the wider unrelated Group, not the segments host')

    def test_inherited_broad_side_strip_goes_red(self):
        # The pre-#362 failure shape: the SwiftUI sheet and its grabber stay
        # 450 wide and centred, but the content root inside keeps a 76-point
        # rail reservation — the 374-point surface, the compressed 254-point
        # segment host and the 326-point content row all shift off centre.
        report = probe.inspect(
            tree(sheet_width=374, host_width=254, union_width=254, content_width=326), ARGS)
        self.assertEqual(report['outcome'], 'FAIL')
        self.assertFalse(report['checks']['lookup_heading_centred_on_sheet'])
        self.assertFalse(report['checks']['lookup_sheet_surface_centred'])
        self.assertFalse(report['checks']['lookup_content_no_side_strip'])
        row = report['values']['contentRow']
        self.assertEqual((row['leftGap'], row['rightGap']), (32, 108))

    def test_missing_full_width_content_row_is_blocked_not_passed(self):
        # inspect raises; main() turns that into the BLOCKED(69) record.
        with self.assertRaises(RuntimeError):
            probe.inspect(tree(content_width=200), ARGS)

    def test_missing_segment_host_is_blocked_not_passed(self):
        shape = tree()
        header = shape['children'][0]['children'][3]['children'][0]
        header['children'] = [header['children'][0]['children'][0]]  # TabGroup without its Group host
        with self.assertRaises(RuntimeError):
            probe.inspect(shape, ARGS)


if __name__ == '__main__':
    unittest.main()
