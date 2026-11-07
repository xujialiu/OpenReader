"""Host tests of the real rotation driver's oracle, not simulator evidence."""
import copy
import importlib.util
from pathlib import Path
import unittest

PATH = Path(__file__).resolve().parents[1] / 'manual-test/place-and-following/duo-rotation.py'
spec = importlib.util.spec_from_file_location('duo_rotation', PATH)
rotation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rotation)


def native(device=1, width=466, height=678):
    return {'device': device, 'interface': device, 'width': width, 'height': height,
            'rootWidth': width, 'rootHeight': height, 'safeLeft': 0, 'safeRight': 84,
            'active': 0, 'pid': 123, 'root': 'DuoOrientationContainer'}


class RotationOracleTests(unittest.TestCase):
    def test_delivered_event_and_rotated_real_window_pass(self):
        before = native()
        landscape = native(4, 678, 466)
        rotation.check_response(before, landscape, 4)
        rotation.check_response(landscape, native(), 1)

    def test_inner_display_uses_its_measured_natural_axis(self):
        basis = native(1, 951, 669)
        basis['interface'] = 4
        rotated = native(4, 669, 951)
        rotated['interface'] = 1
        rotation.check_response(basis, basis, 1)
        rotation.check_response(basis, rotated, 4, basis=basis)
        other = native(3, 669, 951)
        other['interface'] = 1
        rotation.check_response(rotated, other, 3, basis=basis)
        rotation.check_response(other, basis, 1, basis=basis)
        with self.assertRaisesRegex(AssertionError, 'window'):
            rotation.check_response(basis, native(4, 951, 669), 4, basis=basis)

    def test_the_exact_original_window_symptom_is_red_after_real_delivery(self):
        with self.assertRaisesRegex(AssertionError, 'window'):
            rotation.check_response(native(), native(4, 466, 678), 4)

    def test_undelivered_input_is_blocked_not_an_app_rotation_failure(self):
        with self.assertRaisesRegex(rotation.InputBlocked, 'device event'):
            rotation.check_response(native(), native(), 4)

    def test_root_view_must_rotate_too(self):
        after = native(4, 678, 466)
        after['rootWidth'], after['rootHeight'] = 466, 678
        with self.assertRaisesRegex(AssertionError, 'root'):
            rotation.check_response(native(), after, 4)

    def test_relaunch_and_inactive_scene_do_not_pass(self):
        for key, value in [('pid', 456), ('active', 2), ('root', '')]:
            after = native(4, 678, 466)
            after[key] = value
            with self.subTest(key=key), self.assertRaises(rotation.InputBlocked):
                rotation.check_response(native(), after, 4)

    def test_upside_down_is_recorded_without_inventing_a_platform_requirement(self):
        # UIKit on the Duo may retain landscape at physical upside-down.
        after = native(2, 678, 466)
        after['interface'] = 4
        rotation.check_response(native(4, 678, 466), after, 2)

    def test_reader_requires_real_viewport_stage_and_all_displayed_iframes(self):
        state = native(4, 678, 466)
        width = state['width'] - state['safeLeft'] - state['safeRight']
        page = {'viewport': {'width': width}, 'stage': {'width': width},
                'views': [{'width': width}, {'width': width}]}
        rotation.check_reader(state, page)
        for corrupt in ['viewport', 'stage', 'iframe', 'empty']:
            wrong = copy.deepcopy(page)
            if corrupt in ('viewport', 'stage'):
                wrong[corrupt]['width'] = 382
            elif corrupt == 'iframe':
                wrong['views'][1]['width'] = 382
            else:
                wrong['views'] = []
            with self.subTest(corrupt=corrupt), self.assertRaises(AssertionError):
                rotation.check_reader(state, wrong)

    def test_native_parser_requires_a_real_detachment_and_unique_result(self):
        line = 'ROT349 {"device":1,"pid":123}\n'
        good = 'Validated target UDID=test PID=123 binary=test\n' + line + 'Process 123 detached\n'
        self.assertEqual(rotation.parse_native(good)['device'], 1)
        for bad in [good.replace('Process 123 detached', ''), good + line, 'expression failed']:
            with self.subTest(bad=bad), self.assertRaises(rotation.InputBlocked):
                rotation.parse_native(bad)


if __name__ == '__main__':
    unittest.main()
