# The simulator MCP servers

Set up on 2026-09-28; see MEMORY/device-testing.md for which to use when.

- **XcodeBuildMCP is now `mobilebuildmcp`, and reads only the new names.** The docs site and `claude mcp add` snippets still say `xcodebuildmcp`, `.xcodebuildmcp/config.yaml` and `XCODEBUILDMCP_SENTRY_DISABLED`. The 2.7.1 package reads `.mobilebuildmcp/config.yaml` and `MOBILEBUILDMCP_SENTRY_DISABLED` (checked by grepping its `build/`); a `.xcodebuildmcp/` file is silently ignored. The `xcodebuildmcp` npm name stopped at 2.7.0 in July.
- **Without session defaults it offers the wrong scheme.** `simulator list-schemes` on `ios/OpenReader.xcworkspace` lists every Pod first, and its suggested next step was `build-and-run --scheme EXConstants`. The project config pins `scheme: OpenReader` and the bundle id; check them with `session_show_defaults` before a build.
- **`snapshot_ui` without `--simulator-id` is not safe here.** Two simulators were booted when it was first run, and nothing in its output names the device it read. Always pass `simulatorId`.
- **`npx expo install expo-mcp --dev` added it to `dependencies`, not `devDependencies`,** and reordered `htmlparser2`. `--dev` is not an `expo install` flag; the npm flag goes after `--`, and even `npx expo install expo-mcp -- --save-dev` did the same with npm 11. Install it with `npm install --save-dev expo-mcp@~0.2.1` (the range `expo install` chose for SDK 57), then check `npx expo install --check` does not mention it.
- **The `expo` server connects only after OAuth,** and local tools also need `npx expo login` with the same Expo account; pi reports `requires OAuth authentication` until `/mcp-auth expo` has been completed in a browser.
