#!/usr/bin/env python3
"""Build/check/install OpenReader's iPad app on this Apple-silicon Mac.

Local development signing, not Catalyst, notarization or App Store distribution.
See docs/install-on-mac.md. No command deletes or restores an app data container.
"""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import shlex
import subprocess
import sys
import uuid

BUNDLE = "top.xujialiu.openreader"
TARGET = Path("/Applications/OpenReader.app")
ROOT = Path(__file__).resolve().parents[1]


def run(args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, **kwargs)


def capture(args):
    return run(args, stdout=subprocess.PIPE, text=True).stdout.strip()


def mac_id():
    hardware = json.loads(capture(["system_profiler", "SPHardwareDataType", "-json"]))
    return hardware["SPHardwareDataType"][0]["provisioning_UDID"]


def require_mac():
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise ValueError("This workflow requires an Apple-silicon Mac.")


def app_bundle(path):
    """Accept a raw iOS product or our exact wrapper, never a dangling wrapper."""
    path = Path(path).absolute()
    if path.is_symlink():
        raise ValueError("Pass the app directory, not a symlink to it.")
    if (path / "Info.plist").is_file():
        return path
    inner = path / "Wrapper/OpenReader.app"
    link = path / "WrappedBundle"
    if link.is_symlink() and os.readlink(link) == "Wrapper/OpenReader.app" and (inner / "Info.plist").is_file():
        return inner
    raise ValueError(f"Not an iOS OpenReader product or wrapper: {path}")


def validate_metadata(info, profile, device, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    if info.get("CFBundleIdentifier") != BUNDLE:
        raise ValueError("Refusing a different bundle identifier.")
    if set(info.get("UIDeviceFamily", [])) != {1, 2} or info.get("UIRequiresFullScreen") is not False:
        raise ValueError("The product must support iPhone + iPad and not require full screen.")
    if "iPhoneOS" not in info.get("CFBundleSupportedPlatforms", []):
        raise ValueError("Use an iphoneos product, not a simulator or Catalyst build.")
    orientations = {"UIInterfaceOrientation" + name for name in ["Portrait", "PortraitUpsideDown", "LandscapeLeft", "LandscapeRight"]}
    if not orientations.issubset(info.get("UISupportedInterfaceOrientations~ipad", [])):
        raise ValueError("iPad multitasking requires all four orientations.")
    expiry = profile.get("ExpirationDate")
    if not expiry or expiry.replace(tzinfo=dt.timezone.utc) <= now:
        raise ValueError("Development provisioning profile has expired or has no expiry.")
    if device not in profile.get("ProvisionedDevices", []):
        raise ValueError("The provisioning profile does not include this Mac; rebuild for My Mac.")
    teams = profile.get("TeamIdentifier", [])
    identifiers = [team + "." + BUNDLE for team in teams] + [team + ".*" for team in teams]
    if profile.get("Entitlements", {}).get("application-identifier") not in identifiers:
        raise ValueError("Provisioning profile does not authorize this app identifier.")


def inspect_app(path, device):
    inner = app_bundle(path)
    run(["codesign", "--verify", "--deep", "--strict", inner])
    info = plistlib.loads((inner / "Info.plist").read_bytes())
    profile = plistlib.loads(run(["security", "cms", "-D", "-i", inner / "embedded.mobileprovision"], stdout=subprocess.PIPE).stdout)
    validate_metadata(info, profile, device)
    signature = plistlib.loads(run(["codesign", "-d", "--entitlements", ":-", inner],
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout)
    team = signature.get("com.apple.developer.team-identifier")
    if team not in profile.get("TeamIdentifier", []) or signature.get("application-identifier") != team + "." + BUNDLE:
        raise ValueError("Signed identity does not match the profile and app.")
    if not (inner / "main.jsbundle").is_file():
        raise ValueError("No embedded JavaScript bundle; this is not a standalone delivery.")
    print(json.dumps({"app": str(path), "identifier": BUNDLE,
                      "version": info["CFBundleShortVersionString"], "build": info["CFBundleVersion"],
                      "deviceFamilies": info["UIDeviceFamily"], "profileExpires": str(profile["ExpirationDate"]),
                      "macIncluded": True}, indent=2))
    return inner


def expected_version(source):
    match = re.search(r"export const APP_VERSION = '((\d+\.\d+\.\d+) \(([1-9]\d*)\)(?:-beta[1-9]\d*)?)';", source)
    if not match or int(match[3]) > 2**53 - 3:
        raise ValueError("APP_VERSION must name a safe formal base Build Number.")
    return match[1], match[2], str(int(match[3]) + 2)


def mac_destination(text):
    found = re.search(r"platform:macOS, arch:arm64, variant:Designed for \[iPad,iPhone\], id:([^,}]+)", text)
    if not found:
        raise ValueError("Xcode exposes no My Mac (Designed for iPad/iPhone) destination.")
    return found[1].strip()


def build(args):
    output = args.output.expanduser().absolute()
    if output.exists():
        raise ValueError("Use a new --output directory; failed attempts and products are preserved.")
    if capture(["git", "-C", ROOT, "status", "--porcelain"]):
        raise ValueError("Commit the intended source first; this script builds a clean checkout.")
    if not (ROOT / "node_modules/expo").is_dir():
        raise ValueError("Run npm ci in this checkout first.")
    version, short, number = expected_version((ROOT / "app-version.ts").read_text())
    native = ROOT / "ios/OpenReader/Info.plist"
    if (ROOT / "ios").exists():
        info = plistlib.loads(native.read_bytes())
        if (info.get("CFBundleVersion") != number or info.get("CFBundleShortVersionString") != short
                or info.get("OpenReaderBuildVariant") != "debug"):
            raise ValueError("Generated ios/ has another version. Use a fresh session-owned sub-worktree; it is not deleted automatically.")
        prepare = ""
    else:
        prepare = "npx expo prebuild --platform ios\n"
    output.mkdir(parents=True)
    (output / "cache").mkdir()
    destination_log = output / "destinations.log"
    # Destination discovery follows prebuild when the native project is new.
    phase = output / "build-phase.sh"
    q = shlex.quote
    phase.write_text("#!/bin/bash\nset -euo pipefail\n" +
                     f"cd {q(str(ROOT))}\nexport EXPO_PUBLIC_OPENREADER_VARIANT=debug\nexport EXPO_NO_DOTENV=1\n" +
                     f"export TMPDIR={q(str(output / 'cache') + '/')}\n" + prepare +
                     f"xcodebuild -workspace ios/OpenReader.xcworkspace -scheme OpenReader -showdestinations > {q(str(destination_log))} 2>&1\n" +
                     f"DEST=$(python3 {q(str(Path(__file__).resolve()))} destination {q(str(destination_log))})\n" +
                     "xcodebuild -workspace ios/OpenReader.xcworkspace -scheme OpenReader -configuration Release " +
                     '-destination "platform=macOS,arch=arm64,id=$DEST" ' +
                     f"-derivedDataPath {q(str(output / 'build'))} -allowProvisioningUpdates -allowProvisioningDeviceRegistration " +
                     f"ENABLE_USER_SCRIPT_SANDBOXING=NO CLANG_MODULE_CACHE_PATH={q(str(output / 'module-cache'))} -jobs 6 -quiet build " +
                     f"> {q(str(output / 'build.log'))} 2>&1\n")
    env = dict(os.environ)
    # Select the whole Debug role at prebuild and bundling, not a runtime unlock.
    env.pop("EXPO_PUBLIC_OPENREADER_UNLOCKED", None)
    env.pop("EXPO_PUBLIC_OPENREADER_DEBUG_MODE", None)
    run([sys.executable, ROOT / "test/manual-test/kit/ios_guard.py", "run", "--wait", "900", "--timeout", "1500",
         "--record", output / "build-phase.json", "--", "bash", phase], env=env)
    device = mac_destination(destination_log.read_text())
    if device != mac_id():
        raise ValueError("Build destination is not this Mac.")
    product = output / "build/Build/Products/Release-iphoneos/OpenReader.app"
    inspect_app(product, device)
    info = plistlib.loads((product / "Info.plist").read_bytes())
    if (info["CFBundleVersion"], info["CFBundleShortVersionString"]) != (number, short):
        raise ValueError("Native version differs from this checkout.")
    run(["node", "--require", "tsx/cjs", ROOT / "scripts/verify-build.ts",
         "--app", product, "--variant", "debug"], cwd=ROOT)
    wrapper = output / "OpenReader.app"
    (wrapper / "Wrapper").mkdir(parents=True)
    run(["ditto", product, wrapper / "Wrapper/OpenReader.app"])
    (wrapper / "WrappedBundle").symlink_to("Wrapper/OpenReader.app")
    inspect_app(wrapper, device)
    print(f"Built, not installed: {wrapper}")


def running_mac_app():
    js = ('ObjC.import("AppKit"); $.NSWorkspace.sharedWorkspace.runningApplications.js'
          '.filter(a => a.bundleIdentifier.js === "' + BUNDLE + '").length')
    return int(capture(["osascript", "-l", "JavaScript", "-e", js])) > 0


def replacement_plan(source, target, trash):
    """Quote every path; stage+verify before touching the old application package."""
    def q(path):
        return shlex.quote(str(path))

    stage = target.parent / (".OpenReader-install-" + uuid.uuid4().hex + ".app")
    old = target.exists()
    commands = ["set -eu", f"test ! -e {q(stage)}", f"test ! -e {q(trash)}",
                f"ditto {q(source)} {q(stage)}",
                f"codesign --verify --deep --strict {q(stage / 'Wrapper/OpenReader.app')}"]
    if old:
        commands.append(f"mv {q(target)} {q(trash)}")
        commands.append(f"if ! mv {q(stage)} {q(target)}; then mv {q(trash)} {q(target)}; exit 1; fi")
    else:
        commands.append(f"test ! -e {q(target)} && mv {q(stage)} {q(target)}")
    return "\n".join(commands)


def install(args):
    source = args.app.expanduser().absolute()
    if source.resolve() == TARGET.resolve():
        raise ValueError("Source is already the installation target; use check instead.")
    inner = inspect_app(source, mac_id())
    if inner == source:
        raise ValueError("Install the wrapper produced by build, not its raw inner iOS app.")
    if running_mac_app():
        raise ValueError("Quit OpenReader on the Mac first; the installer never kills a Reading.")
    if TARGET.exists():
        if not args.replace or not (args.backup_dir or args.no_backup):
            raise ValueError("Replacement requires --replace and an explicit --backup-dir or --no-backup decision.")
        old = plistlib.loads((app_bundle(TARGET) / "Info.plist").read_bytes())
        if old.get("CFBundleIdentifier") != BUNDLE:
            raise ValueError("The target is another application; refusing replacement.")
    if args.backup_dir:
        backup = args.backup_dir.expanduser().absolute()
        if backup.exists():
            raise ValueError("Backup directory already exists; choose a new private directory.")
        backup.mkdir(parents=True, mode=0o700)
        container = Path.home() / "Library/Containers" / BUNDLE
        if container.exists():
            run(["ditto", container, backup / "container"])
        (backup / "README.txt").write_text("OpenReader app-container copy only. Keychain is NOT included. Quit the app before restoring.\n")
    trash = Path.home() / ".Trash" / ("OpenReader-replaced-" + uuid.uuid4().hex + ".app")
    command = replacement_plan(source, TARGET, trash)
    # Use macOS's normal authorization dialog. Never request passwords in chat,
    # remove quarantine attributes, alter Gatekeeper, or re-sign ad hoc.
    apple_script = "on run argv\n do shell script (item 1 of argv) with administrator privileges\nend run"
    run(["osascript", "-e", apple_script, command])
    inspect_app(TARGET, mac_id())
    print(f"Installed: {TARGET}\nReplaced package (if any): {trash}\nData container unchanged.")
    if args.launch:
        run(["open", "-n", TARGET])
        print("Launch requested. Verify the visible version and interaction; open returning 0 is not that proof.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("build", help="Build the clean checkout, package a wrapper; never install")
    p.add_argument("--output", required=True, type=Path)
    p = commands.add_parser("check", help="Read-only signature, profile and product checks")
    p.add_argument("--app", required=True, type=Path)
    p = commands.add_parser("install", help="Install a checked wrapper; explicit replacement permission required")
    p.add_argument("--app", required=True, type=Path)
    p.add_argument("--replace", action="store_true")
    backup = p.add_mutually_exclusive_group()
    backup.add_argument("--backup-dir", type=Path)
    backup.add_argument("--no-backup", action="store_true")
    p.add_argument("--launch", action="store_true")
    p = commands.add_parser("destination", help="Internal build helper: read the exact Mac destination")
    p.add_argument("file", type=Path)
    args = parser.parse_args()
    require_mac()
    if args.command == "destination":
        print(mac_destination(args.file.read_text()))
    elif args.command == "check":
        inspect_app(args.app, mac_id())
    elif args.command == "build":
        build(args)
    else:
        install(args)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as error:
        print(f"Mac installation stopped: {error}", file=sys.stderr)
        sys.exit(1)
