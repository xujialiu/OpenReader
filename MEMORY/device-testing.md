# Testing on the device

## The manual-test kit

Before running or writing device/manual tests, read
[`test/manual-test/README.md`](../test/manual-test/README.md) and reuse its scripts.
When `xcrun`, Metro, XCTest or a manual step goes wrong or misleads you, add it
to that README's **Pitfalls**, with its symptom, cause and fix, before you
finish. That includes problems you only worked around.

For simulator work, reach first for the two MCP servers in `.mcp.json`, then
`xcrun simctl`, `xcodebuild` and the existing XCTest/manual-test scripts. Use
Computer Use only when none of these can perform the action.

- **`mobilebuildmcp`** (the renamed XcodeBuildMCP): native builds and installs
  (`build_run_sim`), screenshots, the accessibility tree with element refs
  (`snapshot_ui`, `wait_for_ui`), taps, swipes and typing, and LLDB. Its
  project defaults are in `.mobilebuildmcp/config.yaml`. Several simulators are
  often booted at once, so pass `simulatorId` on every call, or set it once with
  `session_set_defaults`; never let it pick a device. The same tools run as a
  CLI: `npx -y mobilebuildmcp@2.7.1 <workflow> <tool> --help`.
- **`expo`**: the JavaScript side. Its local tools (screenshot, tap by
  `testID`, React Native DevTools) exist only while a Metro started with
  `EXPO_UNSTABLE_MCP_SERVER=1` is running, and only for one Metro at a time;
  reconnect the server after starting or stopping Metro. Its automation refuses
  to run while more than one simulator is booted, which is usual here; then use
  `mobilebuildmcp`. It needs `npx expo
  login` with the account used for the server's OAuth. Its screenshots pass
  through Expo's servers: do not use it on a screen showing credentials.

## Local credentials

For provider configuration or live-provider tests, first check
`~/.secrets/openreader/`. It contains the
owner's local credentials. Load only the credentials needed for the test; keep
their values out of logs, screenshots, documentation and commits. Its WebDAV
folder is a test folder, not where the owner's reading syncs: a sync test may
write positions there freely.

## Real books

When a device or manual test needs a real document — hundreds of sections,
chapters several screens tall, real navigation — take one from the owner's
library in `~/Works/epub_books` before generating a fixture. They are the
owner's personal copies: copy a part into the app and keep the originals
unchanged and outside this repository. Loading one is in
[`test/manual-test/README.md`](../test/manual-test/README.md), **Real books**.

## Silence the simulator before playing anything

Turn the simulator's volume all the way down **before** the first `play`, not
after someone hears it. The simulator plays through the machine's own speakers,
and this work happens at every hour.

The simulator's volume, not the Mac's: `bash test/manual-test/kit/silence.sh set
SIMULATOR_UDID` sets that one device to zero and reads it back. **Never mute the
machine.** The owner is listening to it while the test runs, and a machine that
is muted for a test stays muted afterwards. A boot puts the device back to 60, so
set it after every boot and before launching the app, and the kit's scripts check
it before every `play`.

## Play only while measuring, then stop

Stop playback the moment the thing being tested is established. Never leave a
reading running while writing up, taking screenshots or thinking.

The cost is not the audio, it is the transcript: a reading that keeps going keeps
producing clip fetches, position corrections and log lines, and an agent watching
the device reads all of them. That is the owner's tokens spent on nothing.

## The length of a test comes from what it establishes

**Derive the duration; do not pick a safe one.** Five seconds is enough to show
that the highlight follows a real voice, that a Provider's audio plays at all,
that the word lands on the right word. Running a minute to establish any of
those is fifty-five seconds of transcript bought for nothing.

Some things genuinely need the long run, and those get it without argument:
whether the highlight **drifts** cannot be seen in five seconds, and neither can
memory over a session or what happens when the app is backgrounded. Run those
for as long as they actually need.

So the question before every test is which of the two it is. Say in the report
how long it ran and why that long — a duration nobody can justify afterwards was
guessed.
