"""Host-only installer guards. Never builds, installs, elevates or opens an app."""
import datetime as dt
import importlib.util
import plistlib
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/macos-install.py"
spec = importlib.util.spec_from_file_location("macos_install", SCRIPT)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class MacInstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.now = dt.datetime(2026, 10, 23, tzinfo=dt.timezone.utc)
        self.info = {"CFBundleIdentifier": installer.BUNDLE,
                     "UIDeviceFamily": [1, 2], "UIRequiresFullScreen": False,
                     "CFBundleSupportedPlatforms": ["iPhoneOS"],
                     "UISupportedInterfaceOrientations~ipad": ["UIInterfaceOrientation" + n for n in
                                                              ["Portrait", "PortraitUpsideDown", "LandscapeLeft", "LandscapeRight"]]}
        self.profile = {"ExpirationDate": dt.datetime(2027, 1, 1),
                        "ProvisionedDevices": ["MAC_UDID"], "TeamIdentifier": ["TEAM"],
                        "Entitlements": {"application-identifier": "TEAM." + installer.BUNDLE}}

    def tearDown(self):
        self.temp.cleanup()

    def validate(self):
        installer.validate_metadata(self.info, self.profile, "MAC_UDID", self.now)

    def wrapper(self, name="OpenReader.app"):
        outer = self.root / name
        inner = outer / "Wrapper/OpenReader.app"
        inner.mkdir(parents=True)
        (inner / "Info.plist").write_bytes(plistlib.dumps(self.info))
        (outer / "WrappedBundle").symlink_to("Wrapper/OpenReader.app")
        return outer, inner

    def test_valid_device_profile_and_wildcard(self):
        self.validate()
        self.profile["Entitlements"]["application-identifier"] = "TEAM.*"
        self.validate()

    def test_rejects_other_app_phone_only_fullscreen_and_simulator(self):
        for key, value in [("CFBundleIdentifier", "unrelated.app"), ("UIDeviceFamily", [1]),
                           ("UIRequiresFullScreen", True), ("CFBundleSupportedPlatforms", ["iPhoneSimulator"])]:
            with self.subTest(key=key):
                original = self.info[key]
                self.info[key] = value
                with self.assertRaises(ValueError):
                    self.validate()
                self.info[key] = original

    def test_rejects_incomplete_tablet_orientations(self):
        self.info["UISupportedInterfaceOrientations~ipad"] = ["UIInterfaceOrientationPortrait"]
        with self.assertRaisesRegex(ValueError, "four orientations"):
            self.validate()

    def test_rejects_missing_fullscreen_declaration(self):
        del self.info["UIRequiresFullScreen"]
        with self.assertRaises(ValueError):
            self.validate()

    def test_rejects_expired_profile_and_wrong_mac(self):
        self.profile["ExpirationDate"] = dt.datetime(2025, 1, 1)
        with self.assertRaisesRegex(ValueError, "expired"):
            self.validate()
        self.profile["ExpirationDate"] = dt.datetime(2027, 1, 1)
        self.profile["ProvisionedDevices"] = ["OTHER_MAC"]
        with self.assertRaisesRegex(ValueError, "this Mac"):
            self.validate()

    def test_rejects_profile_for_other_identifier(self):
        self.profile["Entitlements"]["application-identifier"] = "TEAM.another"
        with self.assertRaisesRegex(ValueError, "authorize"):
            self.validate()

    def test_wrapper_and_raw_product_are_distinguished(self):
        outer, inner = self.wrapper()
        self.assertEqual(installer.app_bundle(outer), inner)
        self.assertEqual(installer.app_bundle(inner), inner)
        (outer / "WrappedBundle").unlink()
        with self.assertRaises(ValueError):
            installer.app_bundle(outer)

    def test_rejects_external_wrapper_link(self):
        outer, _ = self.wrapper()
        (outer / "WrappedBundle").unlink()
        (outer / "WrappedBundle").symlink_to("/Applications/Another.app")
        with self.assertRaises(ValueError):
            installer.app_bundle(outer)

    def test_destination_is_designed_for_ipad_not_catalyst(self):
        text = "{ platform:macOS, arch:arm64, variant:Designed for [iPad,iPhone], id:MAC_UDID, name:My Mac }"
        self.assertEqual(installer.mac_destination(text), "MAC_UDID")
        with self.assertRaises(ValueError):
            installer.mac_destination(text.replace("Designed for [iPad,iPhone]", "Mac Catalyst"))

    def test_version_derives_debug_base_plus_two_without_a_parity_rule(self):
        self.assertEqual(installer.expected_version("export const APP_VERSION = '1.0.2 (13)-beta8';"),
                         ("1.0.2 (13)-beta8", "1.0.2", "15"))
        self.assertEqual(installer.expected_version("export const APP_VERSION = '1.0.2 (16)-beta1';"),
                         ("1.0.2 (16)-beta1", "1.0.2", "18"))
        with self.assertRaises(ValueError):
            installer.expected_version("export const APP_VERSION = '1.0.2 (9007199254740991)';")

    def test_replacement_requires_both_permissions_before_authorization(self):
        source, inner = self.wrapper("New.app")
        target, _ = self.wrapper()
        for replace, backup, skip in [(False, None, True), (True, None, False)]:
            args = types.SimpleNamespace(app=source, replace=replace, backup_dir=backup, no_backup=skip, launch=False)
            with patch.object(installer, "TARGET", target), patch.object(installer, "mac_id", return_value="MAC_UDID"), \
                 patch.object(installer, "inspect_app", return_value=inner), \
                 patch.object(installer, "running_mac_app", return_value=False), patch.object(installer, "run") as run:
                with self.assertRaisesRegex(ValueError, "Replacement requires"):
                    installer.install(args)
                run.assert_not_called()

    def test_running_app_is_never_killed(self):
        source, inner = self.wrapper("New.app")
        args = types.SimpleNamespace(app=source, replace=True, backup_dir=None, no_backup=True, launch=True)
        with patch.object(installer, "mac_id", return_value="MAC_UDID"), \
             patch.object(installer, "inspect_app", return_value=inner), \
             patch.object(installer, "running_mac_app", return_value=True), patch.object(installer, "run") as run:
            with self.assertRaisesRegex(ValueError, "Quit OpenReader"):
                installer.install(args)
            run.assert_not_called()

    def test_install_plan_stages_and_checks_before_move_and_never_deletes_data(self):
        source, _ = self.wrapper("A 'quoted' new.app")
        target, _ = self.wrapper()
        trash = self.root / "Trash/Old.app"
        plan = installer.replacement_plan(source, target, trash)
        self.assertLess(plan.index("ditto "), plan.index("codesign "))
        self.assertLess(plan.index("codesign "), plan.index("\nmv "))
        self.assertIn("if ! mv ", plan)
        self.assertNotIn("rm ", plan)
        self.assertNotIn("Containers", plan)
        self.assertNotIn("xattr", plan)
        subprocess.run(["bash", "-n"], input=plan, text=True, check=True)


if __name__ == "__main__":
    unittest.main()
