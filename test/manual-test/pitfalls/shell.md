# The shell

## The shell

- **A loop over `"a b c"` strings passes each as one argument.** zsh does not split an unquoted `$var`. Run such scripts with `bash`, or use arrays.
- **There is no `timeout` command on this Mac.** `timeout 900 bash two-finger.sh …`
  answered `command not found: timeout` (2026-09-24); coreutils is not
  installed. Run a long probe in the background and wait for it to finish
  instead.
- **`$?` after a pipe is the pipe's last command.** `bash sync.sh … | tail -5;
  echo $?` (the wrapper `SyncProbe` had then) printed `0` for a test run that had failed. Redirect the script's
  output to a file and test its own status, or read `PIPESTATUS`.
- **`lsof -p PID -d 1,2` lists other processes' files too.** `lsof` ORs its
  selectors, so that command prints every process's descriptors 1 and 2 as
  well as PID's, and a `tail` shows some other process. Met 2026-09-22 looking
  for where Metro writes its log, which is the only place the app's console
  lines are. `-a` ANDs them: `lsof -a -p PID -d 1,2`.
- **macOS's `wc -l` pads its count with spaces**, so reading Metro's log on
  from a remembered line with `tail -n +$(cat saved-count)` failed with
  `tail: illegal offset -- +    1097` (2026-09-23). Save the count as
  `wc -l < FILE | tr -d ' '`.
- **zsh runs nothing when an unquoted glob matches no file.** `grep -rn X src
  --include=*.ts` answers `no matches found: --include=*.ts` and the command
  never runs. Quote the pattern: `--include='*.ts'`.
- **macOS's bash 3.2 cannot parse a quoted heredoc inside `$(…)` whose text
  holds an unbalanced quote.** `CODE=$(cat <<'EOF' … EOF)` around a JavaScript
  program containing `/[.,!?"]+$/` failed with `unexpected EOF while looking
  for matching '"'` at the end of the script, although `'EOF'` quotes the body.
  Keep such text in a file of its own and `cat` it, as
  `leading-strip-probe.js` is.
  **When it fails that way, its backticks run as commands.** 2026-09-28 (#79):
  `gh issue comment 79 --body "$(cat <<'EOF' … EOF)"` around a plan with an
  apostrophe in `reader's` and words in backticks posted the comment with
  those words missing and ran them. `` `npm ci` `` installed the worktree's
  dependencies, and `` `tsc` `` and `` `patch-package` `` answered `command not
  found`. Write an issue or comment body to a file and pass `--body-file`, or
  `-F body=@FILE` to `gh api`, which is also how the comment was corrected.
- **`PIPESTATUS` is bash's, and an agent's commands here run in zsh 5.9.**
  `… | tee run.out; echo "exit ${PIPESTATUS[0]}"` printed `exit ` with nothing
  after it (2026-09-22): zsh has no `PIPESTATUS`, and an unset name expands to
  nothing. zsh's array is `pipestatus`, counted from 1: `${pipestatus[1]}`.
- **`xcodebuild` can outlive the test it ran.** A `-only-testing` run whose test
  was already reported as finished in `test.log` kept its `xcodebuild` alive
  past a ten-minute timeout. Watch `test.log` for `Test Suite … at <time>`, then
  kill that exact `xcodebuild -project <your artifact dir>` process; the result
  bundle is already complete. It happens after a **failed** test too (measured
  2026-09-21: the failure was written at 21:06 and the process was still there at
  21:16), so a run that has gone quiet is worth checking against `test.log`
  rather than waited out.
- **After a failed test, the result bundle is not complete, and killing
  `xcodebuild` loses the attachments.** Measured 2026-09-22: `library-actions.sh`
  (now `kit/run-probe.sh LibraryActionsProbe`) ran both of its methods, one failed on a missing fixture at 01:21, and
  `xcodebuild` was still collecting simulator diagnostics
  (`result.xcresult/Staging/1_Test/Diagnostics/simctl_diagnostics`) at 01:30.
  Killed then, it left `result.xcresult` with no `Info.plist`, and `xcresulttool
  export attachments` refused it: "Failed to create a new result bundle reader".
  - The screenshots are still there, as raw files: `file
    result.xcresult/Data/data.*` says `PNG image data` for each, and the element
    trees are the `Zstandard compressed data` ones (`zstd -dc`). Their names are
    lost; tell them apart by the labels in the trees.
  - Better, do not run a method that is going to fail: `kit/run-probe.sh` takes
    `-only-testing:METHOD` for every probe.
- **A runner called with no `-only-testing` died at once with `only_testing[@]:
  unbound variable`.** macOS's `/bin/bash` is 3.2, where `set -u` treats an empty
  array as unset, so "omit the arguments to run the whole class" never worked.
  The runners now expand `${only_testing[@]+"${only_testing[@]}"}`.
- **A Library entry's file is named with a dash, not a colon.**
  `Documents/library/sha256-<hex>.epub`, while the Document Id is
  `sha256:<hex>`. A `cp "$D/Documents/library/$id.epub" …` fails, and in a
  `cp || ls` chain it fails quietly.
- **`app.staticTexts["Folder"]` matches twice.** React Native nests a duplicate
  static text inside every `Text`, so an exact-identifier tap raises `Multiple
  matching elements found`. Use `.matching(identifier:).firstMatch`. Group
  headers are set as written since #48 (`Folder`, not `FOLDER`), so a probe
  that still names the capitals finds nothing.
- **An `xcodebuild`-running script (`kit/run-probe.sh`, and the wrappers before it) can exceed
  the harness's own default command timeout and get moved to the background
  without being asked to.** Measured 2026-09-24 verifying #60: a
  `pause-menu.sh` (`PauseMenuProbe`) invocation covering three test methods ran past 120 s and was
  silently backgrounded, and a retried `azure-provider.sh` (`AzureProviderProbe`) call was piped
  through `tail`, whose own exit code masked the real `xcodebuild` failure
  underneath it (`$? after a pipe` above). Pass an explicit, generous
  `timeout` on the tool call itself for any wrapper expected to run more than
  a couple of methods — measured single-method runs here were 30-70 s each, so
  three or four methods can comfortably clear 120 s — and never pipe a
  wrapper's output through another command without checking that command's own
  exit code separately.

- **A stopped `xcodebuild` leaves a result bundle `xcresulttool` cannot read,
  and under `set -e` that ends the wrapper.** Measured 2026-09-25 (#67): after
  `reading-button.sh` stopped an `xcodebuild` that was still collecting
  diagnostics two minutes after a failed suite, `xcresulttool export
  attachments` failed and the script exited 64 instead of reporting the
  failure. The export is now allowed to fail, and the screenshots are the raw
  PNGs in `result.xcresult/Data/data.*` (above). The verdict comes from
  `test.log`'s `Test Suite 'Selected tests' passed|failed` line, not from the
  stopped process's exit status.
- **The harness's `open` pushes the Reader over whatever the stack holds.** On
  a device where a provider-setup probe had left Settings › Providers › Fish
  Audio open, `{"do":"open"}` put the Reader on top of it, and an edge swipe out
  of the reader then showed Fish Audio's page, not the Library (2026-09-25).
  Before a probe that leaves the reader, go back to the Library, as
  `ReadingButtonProbe.openPaused` does.

- **A tap on the LogBox banner opens React Native DevTools on the Mac.**
  Measured 2026-09-26 00:05 (#68): Metro logged `INFO Launching DevTools...`
  65 times during one `ReadingHeldProbe` run. The banner `Open debugger
  to view warnings.` (raised here by the `Sending onAnimatedValueUpdate with no
  listeners registered` warning a navigation transition logs) lay over the
  player and over the Library's Reading Button, and the probe's taps meant for
  them landed on it. The methods then failed on "Play did not start". Dismiss
  the banner with its own close button at its right end, never its body
  (`ReadingHeldProbe.clearLogBox`), before every tap near the bottom of the
  screen. After a run that hit it, check Metro's log for `Launching DevTools`.
  Met again 2026-10-01 (#109) by two `axe touch`es meant for Play: Metro logged
  `Launching DevTools...` twice and then received no more `HX` lines for the
  rest of the run (the app stayed connected; the Debug Log kept every answer).
  See [mcp.md](mcp.md), "A system alert and a masked field".
- **Metro stopped receiving the app's console lines, and harness commands still
  ran.** On 2026-09-25 at 23:41:54, right after a Reading was ended, the Metro
  log stopped: no `HX` lines through a 118 s probe run and a `shelf` command,
  while a harness `add` in the same window did add the fixture back. `/status`
  answered `running` and `/json/list` listed the device. `simctl terminate` and
  `launch` brought the lines back (`HX shelf …` within 12 s). Cause not
  isolated. A probe that needs to observe the reading should read it from the
  screen (as `ReadingHeldProbe` reads the Library row's quote) rather than
  from the log. Before reading the log, check that it is still growing.
- **An edge swipe started while the bar is still sliding away can miss.** In
  two full `ReadingHeldProbe` runs (2026-09-26 00:05 and 00:12), an edge swipe
  started immediately after Collapse left the reader on screen ("The edge swipe
  did not return to the Library"). The same method alone passed, and with
  0.8 s between Collapse and the swipe it passed in the full run twice. A
  person does not swipe within a twelfth of a second of pressing collapse, so
  the probe waits.
- **A native dependency needs the Debug app rebuilt, and a worktree has no
  `ios/`.** Adding `react-native-teleport` (#68): `CI=1 npx expo prebuild
  --platform ios --no-install`, `pod install` in `ios/` (Codegen reported
  `Found react-native-teleport`), then the `xcodebuild` of
  `docs/install-on-simulator.md` with `RCT_METRO_PORT=PORT` added. That setting
  baked `RCTMetroPort` into the product's `Info.plist` (read back with `plutil`),
  so the build asks this tree's Metro without the re-sign. Prebuild to done
  took 8.5 minutes. Restart Metro with `--clear` after the `npm install`.
- **`tail -n +$(wc -l < FILE)` fails on macOS with `illegal offset -- +`.**
  BSD `wc -l < FILE` pads its number with spaces, so the argument is `+     230`.
  Strip it: `S=$(wc -l < FILE | tr -d ' ')` (2026-09-28, final run of #75–#77).

- **A foreground timeout kills the wrapper, not the xcodebuild under it**
  (2026-09-30). A `run-probe.sh` invocation inside a 600 s shell timeout was
  killed by the timeout while xcodebuild kept running detached; the test went
  on to write its log and the wrapper's tail was lost. The kit's own
  `reading-held.sh` already has the right shape: start xcodebuild in the
  background, watch the log for the suite's verdict, stop it two minutes
  after the verdict. For ad hoc runs: `nohup … &` and poll the log file.
- **Filtering `run-probe.sh`'s output through `grep` swallows the runner's
  refusal, and the next `ls -t` then documents the wrong capture** (2026-10-01,
  #119b). `bash run-probe.sh … --expect-player 2>&1 | grep -E "Executed|TEST"`
  printed nothing when the runner refused the run (sim volume back at 60), and
  grep's exit status was never tested — the script went on, `ls -t` over the
  shared output directory named the **previous** run's screenshot and
  centre-button JSON as the newest, and those got copied and read as the new
  run's result: a JSON that predates the pause by two seconds read as a
  post-pause contradiction. Fix: read the probe output's tail (or grep with a
  fallback that prints everything when nothing matched), test the exit status,
  and copy attachments from the run's own `attachments-STAMP` directory —
  `ls -td OUTPUT/attachments-* | head -1` only after the run's stamp is
  confirmed in the output (`../lock-screen/README.md`, #119b).

## The #148 run (2026-10-09)

- **In zsh, `local a=$1 b=$a` expands `$a` before it is assigned.** A helper that built its evidence file name from a `local` declared on the same line wrote every pass to `settings--.txt`, one file overwritten six times, while the screenshots (named from the arguments) were right. Declare on one line, use on the next. A `grep -c … || echo 0` prints `0` twice when nothing matches (grep prints the count and exits 1): use `|| true`.
