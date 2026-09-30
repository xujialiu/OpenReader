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
- **When both AXe forms no-op, try mobilebuildmcp's elementRef `tap` before rebooting.** 2026-09-30 (#107, `iPhone 17 ios107`, iOS 27.0), app live and playing: on the player's own buttons, `axe tap --tap-style physical` no-op'd twice and `axe touch --down --up` once (each answered "completed successfully"; mark, playback state and `rendered` all unchanged), while mobilebuildmcp's `snapshot_ui`+`tap` on the same button's elementRef landed on the first try and changed the state at once. Same simulator minute, no reboot either side — the no-op is the AXe input path's, not the simulator's or the app's.
- **AXe's `tap --tap-style physical` is a down/up pair in one call, and does what a default `tap` did not.** 2026-09-29 (#88, iPhone 17 download, iOS 27.0): `"$AXE" tap --label "More actions" --udid UDID` and a coordinate `tap` on a sentence of the page both answered `completed successfully` and changed nothing (the drawer stayed shut; the harness `say` showed the same utterance). The same calls with `--tap-style physical` opened the drawer and moved the reading to the tapped sentence. Being one call, it is not the multi-second hold of the bullet above. `--label` taps the point where the element is, whatever is drawn over it: a leftover harness command (`typing-environment.md`) raised a LogBox toast at launch, and a labelled tap on the drawer's Download row, which lay under the toast, opened the LogBox instead.
- **An AXe long press on the reading page does not start a Word Lookup.** 2026-09-30 10:50 (#99, `iPhone 17 share95`, iOS 27.0): with `Long-press lookup` on, `"$AXE" touch -x 262 -y 400 --down --up --delay 1.2 --udid UDID` on a word of the page answered without error, and no lookup drawer rose (no `Close lookup` in `snapshot_ui`, twice). `mobilebuildmcp`'s `long_press` needs an elementRef, and the page's words have none. Use `TranslationProbe.swift`'s `XCUICoordinate.press(forDuration: 1.0)`, which is what opened the drawer for #73.
- **A zero-delay single-call `touch --down --up` silently no-ops on the reader's WebView text, and `--tap-style physical` can no-op there too; native buttons accept both.** 2026-09-30 (#88, iPhone 17 download): on the reading page, `touch -x 131 -y 244 --down --up` changed nothing, while the same point re-cued the reading when sent as `tap -x 131 -y 244 --tap-style physical` (band moved, page scrolled); minutes later, two `--tap-style physical` taps on Chapter 173 sentences (y≈665, y≈725) both changed nothing — band unmoved, `hx.cjs '{"do":"say"}'`'s `utterance=` unchanged. Native RN buttons that same night answered a single-call `touch --down --up` 10 of 11 times (`Back`, the row `…`, the sheet's `Download`, the player's `Contents`). So the older bullet's `--tap-style physical` advice is not a guarantee on WebView text: verify a sentence tap by the highlight band in a fresh screenshot or the harness's `utterance=`, never by the tool's success line, and retry with the other form.
- **A tap inside a just-closed sheet's settle is swallowed.** Same night: tapping a Library document row about 1.2 s after tapping the actions sheet away did nothing; the same tap after a further wait opened the reader. Leave about 2 s after any sheet close (action sheet, drawer) before the next tap, and confirm with a screenshot.
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
- **AXe `drag` is the reliable way to scroll a list precisely; a tap on the
  list's own scroll bar does nothing.** 2026-09-29 (#88, iPhone 17 download):
  moving the reader's Contents from Chapter 169 to Chapter 159 took one
  `"$AXE" drag --start-x 201 --start-y 480 --end-x 201 --end-y 830 --duration
  0.8` and landed exactly (the next screenshot showed 159–167, ten 46 pt rows
  for a 350 pt drag). The same list's `Slider 'Vertical scroll bar'` ignored a
  physical tap at 98 % of its track (the drawer re-screenshot unchanged), and
  `"$AXE" slider --label …` refused with "Multiple (2) accessibility elements
  matched" because RN renders the bar twice and neither copy carries an
  `AXUniqueId`. Scroll RN lists with `drag` (or `swipe` for flings), read the
  position back from a screenshot or `describe-ui`, and do not try to drive the
  scroll bar.

## The share sheet's actions cannot be driven from the accessibility tools (#95, 2026-09-30)

- **The system share sheet (`UIActivityViewController`) is invisible to `snapshot_ui` and AXe.** With the sheet up over the drawer, both reported only the app's own 77–85 elements — no Copy, no Save to Files, no header. AXe's `describe-ui` reads the app's accessibility tree, and the sheet's contents live in a remote view that never enters it. Verify the sheet is up with a screenshot, not with these tools.
- **XCUITest does see the sheet's items — as `Cell`s, not `Button`s.** `app.debugDescription` with the sheet up listed `Cell … identifier: 'actionGroupCell', label: 'Copy'` and `Cell … label: 'Save to Files'`, so `app.buttons["Save to Files"]` answered "No matches found" while the elements were plainly in the tree (`ShareProbe.swift`'s first run failed exactly there). Query `app.cells["Copy"]` / `app.cells["Save to Files"]`.
- **Even then, synthetic input does not reach the sheet reliably.** Measured on a fresh iPhone 17 (iOS 27.0): a raw pixel tap (`axe tap`) on Save to Files worked exactly once in five tries across two boots; the Files save dialog's Save button never responded to `axe tap` (default and `--tap-style physical`), `axe touch` down/up, or an `axe batch` HID sequence that logged success; outside-tap and a grabber drag did not dismiss the sheet; a hardware Escape (mobilebuildmcp `key_press` 51) did nothing. XCUITest's tap on the sheet's own `Copy` cell worked first time and closed the sheet (`ShareProbe.testSheetClosesBackToOpenDrawer`). For byte-level end-to-end evidence, prefer the task's fallback: `cmp` the `Caches/share/<name>.epub` copy against the kept `library/sha256-*.epub` (for #95 they were identical, and the share sheet's own header shows the name).
- **`axe tap -x -y` takes pixels of the native screenshot (3× on this iPhone 17), not points.** A tap at the point coordinates (154, 785) silently landed on nothing; the same button at pixels (463, 2355) worked. Everything element-ref-based (`mobilebuildmcp tap/touch`) is points. Convert: pixels = points × 3, measured against `simctl io … screenshot`'s own size (1206×2622 for 402×874).
- **One rendered Text line appears twice in `snapshot_ui`'s text list and AXe `describe-ui`, at one identical frame.** 2026-09-30 (#103, `iPhone 17 share95`, iOS 27.0): the player's note `No provider is enabled. …` was listed as two StaticText entries (e30, e31) whose frames agreed to ten decimal places (x 12.333333015441895, y 723.333333492279, same size), while the screenshot showed one line. RN exposes the text node twice (container and inner text) under one visual line. Before reporting a visual duplicate — the #72 shape — compare the frames: identical frames are one line; #72's real duplicate was two stacked lines. Confirm with a screenshot.
- **A lost touch-up can leave a screen transition frozen mid-animation.** Same day, after a Settings→Library Back: the down answered SNAPSHOT_CAPTURE_FAILED (the navigation had started), the up answered SNAPSHOT_MISSING, and the screen sat for over a minute on the half-morphed header (the Library|Settings pill frozen, Settings content showing) instead of settling. The transition waits for the touch to complete. Fix: `snapshot_ui` again, then a fresh touch down+up on the destination element (here the pill's `Library` button) — the Library appeared at once. Per the bullet above, the first action did land; the gesture, not the app, was incomplete.
- **"`Timed out creating the simulator remote automation session`" for ~30 s after a boot** — both `snapshot_ui` and `axe tap` answered this right after `bootstatus -b` finished (twice, two boots). Sleep ~25 s and retry; nothing is broken.

- **Typing a provider credential raises the system **Save Password?** alert,
  and the alert is only dismissible through the app's own tree.** 2026-09-30
  (#105): after typing a gateway's headers into the Provider screen's masked
  field, the alert covers the reader. `snapshot_ui` and AXe cannot see it
  (remote view, the share sheet's pattern); `com.apple.springboard`'s
  buttons/alerts/otherElements have no `Not Now`; raw pixel taps landed twice
  in six tries. It IS in the app's own tree — `SavePassword105Probe.swift`
  found it as `app.otherElements.buttons['Not Now']` and XCUITest tapped it
  first time. Keep a probe, not pixel taps, for system alerts.
- **A scenario probe that presses the player's transport must re-resolve the
  button by its current label.** The same button reads `Play` paused and
  `Pause` playing; a query kept from the paused state resolves to nothing over
  the playing tree's churn (the highlight re-renders every word), and the tap
  silently lands nowhere — the first control run's Pause never happened and
  the reading ran to the end. Fix: `app.buttons["Pause"]` with
  `waitForExistence` right before the second press
  (`Scenario105Probe.swift`).
- **XCTest taps on the player's buttons are eaten in runs, and the run can
  outlast a spoken sentence.** 2026-09-30 (#105): the same probe's taps
  started the reading at 22:24, 22:27 and 22:56 and did nothing at 22:29,
  22:40, 23:03, 23:15 and 23:31 — across an app relaunch and a simulator
  reboot, and with two other sessions' automations running against their own
  simulators. A missed Play wastes the run; a missed Pause lets the document
  finish (this fixture is ~30 s spoken) and the report reads the wrong
  outcome. Fix: after pressing Play, wait up to 4 s for the `Pause` button and
  retry the press (three attempts), and time the presses inside ONE XCTest
  method — host-side tool round trips (30-60 s each under load) cannot land a
  second press inside a spoken sentence at all (`Scenario105Probe.swift`).
  How to tell an eaten tap from the app ignoring one: every press that did
  nothing has `Computed hit point {-1, -1} after scrolling to visible` under
  its `Synthesize event` in the run's `test.log`, and the Debug Log has no
  `[reading] play` and no `play` sync for it. No press that worked has that
  line. So XCTest aimed the tap at no point, and the app never saw it. Grep the
  log for the hit point before blaming the app, or before calling a failure
  flaky.
