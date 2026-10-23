# Install OpenReader on an Apple-silicon Mac

This installs the **iPad app running on Mac**, using Xcode's
**My Mac (Designed for iPad/iPhone)** destination. It is neither a simulator
build nor Mac Catalyst. The script is [`scripts/macos-install.py`](../scripts/macos-install.py).
Read [MEMORY/mac-install.md](../MEMORY/mac-install.md) for the approval and data
rules. Store uploads use a [different procedure](release-to-app-store.md).

## Before building

1. Confirm which checkout/commit the owner wants. Commit its intended changes;
   `build` refuses a dirty checkout. This does not require publishing the commit.
2. Confirm replacement versus a separate copy. The script's target is
   `/Applications/OpenReader.app`, identifier `top.xujialiu.openreader`. A
   separate copy needs a separately agreed identifier and configuration before
   prebuild; this script does not invent one.
3. Confirm the backup choice. The install command requires `--replace` plus
   either `--backup-dir DIR` or `--no-backup` when an app already exists.
   `--backup-dir` copies the app container while the app is quit; it does **not**
   include Keychain. If diagnostic history is important, preserve the container
   or its `Data/Library/Application Support/debug-log` before first launch:
   another Version can clear the previous Debug Log.
4. Check `uname -m` is `arm64`, `xcode-select -p` points at the intended Xcode,
   and `security find-identity -v -p codesigning` lists a valid Apple Development
   identity. Xcode must have the owner's Apple Account and team available.
5. Read [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) and the shared
   [build admission rules](../test/manual-test/kit/ios-verification.md). Check
   machine memory and active builds before starting. Leave other sessions'
   devices, Metros and builds alone.

Use a **session-owned sub-worktree** when the current checkout's `ios/` or
node_modules supports another running build. Follow AGENTS.md: create it under
`.worktrees/`, branch `<current-branch>--<name>` from the current HEAD, announce
its path/branch/owner, and run `npm ci` there. It shares no node_modules. A
Release build can replace native dependency artifacts with their Release
variants, so another session's generated tree is not a scratch build folder.

## Build only

From the intended checkout, after `npm ci`:

```sh
python3 scripts/macos-install.py build --output /tmp/openreader-mac-attempt-01
```

Use a new output directory per attempt; the script preserves failures rather
than overwriting their evidence. It:

- takes the machine-wide iOS build lane with the existing guard;
- prebuilds with Debug Mode if `ios/` is absent, otherwise checks its native
  Version/Build before reuse (it never deletes a generated tree automatically);
- discovers the exact **Designed for [iPad,iPhone]** destination and verifies
  that it is the current Mac;
- builds Release with Debug Mode, embedded JS, an isolated module/cache path,
  automatic development signing and device registration;
- checks the signature, provisioning expiry and current-Mac inclusion,
  `[1,2]` device family, `UIRequiresFullScreen=false`, native Version/Build and
  embedded bundle's Version/Debug Mode/purchase policy;
- packages the iOS product in the wrapper below, without changing its signature.

The primary output is `/tmp/openreader-mac-attempt-01/OpenReader.app`.
`build.log`, `build-phase.json` and `destinations.log` are beside it. Hardware
identifiers and provisioning files stay in these local artifacts, not in git.
The build has the even Build Number and `-debug` line used on the owner's
phone, for example `1.0.1 (14)-beta8-debug`.

**Release with Debug Mode** is intentional. Release embeds JavaScript, so it
runs without Metro. Debug Mode retains diagnostic logs and uses the project's
pretend purchase store; `Purchase: Unlocked` in this local copy is not proof
of a real StoreKit purchase. No speech key is bundled.

## The Mac wrapper

The built iOS app has `Info.plist` beside its executable, not a macOS
`Contents/` layout. The local wrapper used by this installation is:

```text
OpenReader.app/
  WrappedBundle -> Wrapper/OpenReader.app
  Wrapper/
    OpenReader.app/       # the unmodified, signed iphoneos product
      Info.plist
      embedded.mobileprovision
      main.jsbundle
      OpenReader
      Frameworks/
```

Do not copy old App Store receipts or store metadata into this local build.
Do not ad-hoc re-sign it or edit its signed Info.plist after building. This is
a locally verified development-install route, not a replacement for Apple's
App Store distribution process.

## Check, replace and launch

Quit the **Mac** copy before replacing it. The script refuses a running app
instead of terminating a Reading. A similarly named simulator app is separate.

Read-only validation, also useful after installation:

```sh
python3 scripts/macos-install.py check --app /tmp/openreader-mac-attempt-01/OpenReader.app
```

With the owner's approval to replace and copy the data container first:

```sh
python3 scripts/macos-install.py install \
  --app /tmp/openreader-mac-attempt-01/OpenReader.app \
  --replace --backup-dir "$HOME/OpenReader-install-backup" --launch
```

Only when the owner has explicitly declined that copy:

```sh
python3 scripts/macos-install.py install \
  --app /tmp/openreader-mac-attempt-01/OpenReader.app \
  --replace --no-backup --launch
```

A Mac App Store package is normally root-owned. The script uses macOS's normal
administrator authorization dialog; the owner enters their password or uses
Touch ID there, never in chat. It stages and verifies the new package first,
moves the old **application package only** to `~/.Trash/`, then installs the
new one. A failed final rename attempts to put the old package back. It does
not delete or overwrite the app data container.

Afterwards:

1. Check `/Applications/OpenReader.app` with `check` again.
2. Confirm the app has a visible window, and **Settings → Version** names the
   intended Beta. A process or successful `open` command alone is not enough.
3. Inspect the Library. The same identifier should retain existing data; do
   not promise migration without observing it.
4. Try a window edge/corner and inspect its resulting dimensions. Re-read the
   window after animations or a zoom. A successful synthetic drag dispatch
   with unchanged dimensions is not evidence of resizing.
5. Leave the app open, with playback stopped. No Metro is needed. Do not start
   audio or configure a Provider unless the owner asked for that too.

## Troubleshooting and cleanup

- **Existing `ios/` refuses introspection/prebuild with an already-written key**:
  the known #221 config-plugin guard, not a reason to remove the guard. Use a
  fresh session-owned sub-worktree instead of prebuilding over another run.
- **Signing lacks this Mac**: build for the discovered Mac destination with
  Xcode's account signed in. The script checks the profile's ProvisionedDevices.
- **Permission denied replacing the App Store package**: normal for a root-owned
  app. Use the administrator dialog; do not change ownership/security policy.
- **No window immediately after `open`**: allow startup, inspect again, then read
  the app's Debug Log/crash report if still absent. Report installation and
  launch separately.
- **GUI action returned an error or no size change**: inspect a fresh window
  snapshot. In the measured installation, a later snapshot showed the larger
  window although earlier immediate action responses still showed the old
  dimensions. Do not infer which input caused it from dispatch alone.

The installed copy is independent of the checkout, so its build output and
build-only sub-worktree can be released after acceptance. Merge any retained
records into the parent branch, remove the sub-worktree and delete its branch
as AGENTS.md requires. Follow MEMORY/cleanup.md for this session's other
resources; the installed app is the delivery, not scratch to delete. Its
provisioning profile expires: rebuild and install over it before expiry.
