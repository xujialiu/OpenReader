# The simulator MCP servers

Set up on 2026-09-28; see MEMORY/device-testing.md for which to use when.

- **XcodeBuildMCP is now `mobilebuildmcp`, and reads only the new names.** The docs site and `claude mcp add` snippets still say `xcodebuildmcp`, `.xcodebuildmcp/config.yaml` and `XCODEBUILDMCP_SENTRY_DISABLED`. The 2.7.1 package reads `.mobilebuildmcp/config.yaml` and `MOBILEBUILDMCP_SENTRY_DISABLED` (checked by grepping its `build/`); a `.xcodebuildmcp/` file is silently ignored. The `xcodebuildmcp` npm name stopped at 2.7.0 in July.
- **Without session defaults it offers the wrong scheme.** `simulator list-schemes` on `ios/OpenReader.xcworkspace` lists every Pod first, and its suggested next step was `build-and-run --scheme EXConstants`. The project config pins `scheme: OpenReader` and the bundle id; check them with `session_show_defaults` before a build.
- **`snapshot_ui` without `--simulator-id` is not safe here.** Two simulators were booted when it was first run, and nothing in its output names the device it read. Always pass `simulatorId`.
- **`npx expo install expo-mcp --dev` added it to `dependencies`, not `devDependencies`,** and reordered `htmlparser2`. `--dev` is not an `expo install` flag; the npm flag goes after `--`, and even `npx expo install expo-mcp -- --save-dev` did the same with npm 11. Install it with `npm install --save-dev expo-mcp@~0.2.1` (the range `expo install` chose for SDK 57), then check `npx expo install --check` does not mention it.
- **Expo's local automation refuses when more than one simulator is booted.** On 2026-09-28, with Metro started as `EXPO_UNSTABLE_MCP_SERVER=1 npx expo start --port 8100` and the server reconnected, `expo_automation_take_screenshot` answered `Multiple simulator are not supported yet`. Two simulators, belonging to other sessions, were booted. It has no device argument (only `projectRoot`, `platform`, `testID`). When several are booted, use `mobilebuildmcp` with `simulatorId` instead; do not shut down another session's simulator to make room. With the Metro running, reconnecting added five local tools: `open_devtools`, `collect_app_logs`, `automation_tap`, `automation_take_screenshot` and `automation_find_view`.
- **The `expo` server connects only after OAuth,** and local tools also need `npx expo login` with the same Expo account; pi reports `requires OAuth authentication` until `/mcp-auth expo` has been completed in a browser.
- **A quick synthesized `tap` can silently no-op while an explicit touch down/up pair works, and the state comes and goes with the simulator.** Seen 2026-09-29 (issue #82 recheck): `tap` on a drawer's Close button answered "simulated successfully" with an unchanged `screenHash` and the drawer still open; the same button closed instantly on `touch` down then `touch` up. The same day, the same quick taps registered 4 runs out of 4 right after a simulator reboot (XCTest `tap`s inside `TranslationProbe` too), and failed again half an hour later on a Release build with the feature's code entirely off — so the split is the simulator's input state, not the app under test, and a prior session's stuck synthetic touch-down is the standing suspect. Never trust the tool's success line: verify a tap by a fresh `snapshot_ui`/screenshot (or the changed `screenHash` in the response). When quick taps no-op, do the step with `touch` down+up, and if that spreads, reboot the simulator (then re-silence it; a boot resets `sim_volume` to 60).
- **`touch` down and up are two tool calls seconds apart, so the pair lands as a multi-second hold.** On the Library, a down/up pair on a document row opened that row's actions drawer — the long-press action — instead of opening the document (both 2026-09-29). Use `tap` for quick activations where taps are reliable (bullet above); reserve `touch` pairs for controls that fire on release and carry no long-press meaning (a Switch, a Test connection button), where the same pair reads as a tap.
- **AXe's `tap --tap-style physical` is a down/up pair in one call, and does what a default `tap` did not.** 2026-09-29 (#88, iPhone 17 download, iOS 27.0): `"$AXE" tap --label "More actions" --udid UDID` and a coordinate `tap` on a sentence of the page both answered `completed successfully` and changed nothing (the drawer stayed shut; the harness `say` showed the same utterance). The same calls with `--tap-style physical` opened the drawer and moved the reading to the tapped sentence. Being one call, it is not the multi-second hold of the bullet above. `--label` taps the point where the element is, whatever is drawn over it: a leftover harness command (`typing-environment.md`) raised a LogBox toast at launch, and a labelled tap on the drawer's Download row, which lay under the toast, opened the LogBox instead.
- **An element ref dies across a `simctl` relaunch or a screen change (`SNAPSHOT_EXPIRED`)** — the tool names it and asks for a fresh `snapshot_ui`; re-snapshot and retry with the new refs instead of reusing coordinates from the old tree.
- **An action that closes a sheet or navigates answers "refreshed runtime
  snapshot did not settle before timeout" (`SNAPSHOT_CAPTURE_FAILED`), and the
  follow-up touch-up can then answer `SNAPSHOT_MISSING` — the action itself
  landed.** Seen throughout the #84/#85 run: every Close Appearance, Back and
  More-actions touch pair reported the warning while the sheet closed normally,
  and once the down had already navigated so the up had no snapshot to resolve
  against. The post-action capture races the close/navigation animation's
  2.5 s settle window. Take a fresh `snapshot_ui` and re-resolve refs from it
  instead of retrying the action.
- **`snapshot_ui`'s summary lists only "likely targets" and one text line — the
  full element tree is reachable through the bundled AXe binary.** Headers,
  values and non-tappable elements never appear in the summary; the
  `TARGET_NOT_ACTIONABLE` error dumps candidates, but only when the ref
  resolves. For the whole tree with roles and labels use the AXe that ships
  inside mobilebuildmcp:
  `AXE=$(find ~/.npm/_npx -path "*mobilebuildmcp/bundled/axe" | head -1)`;
  `"$AXE" describe-ui --udid UDID` prints every element as JSON with
  `role`/`AXLabel`/`AXFrame` (it is how the #85 title's `AXHeading` was
  proven; XCUITest has no header query at all). The bundle path moves with the
  npx cache, so `find` it.
