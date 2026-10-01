import XCTest

/**
 * The #105 main scenario's transport presses, as one timed XCUITest method.
 *
 * The app is already open on the Reading, resumed at the phone's own sentence
 * and paused, with the stub's served Positions File holding the other device's
 * newer place. The method arms the stub's one-delayed-GET (the simulator
 * shares the host's loopback, so the runner can reach the stub's control
 * port), really taps **Play**, waits for Play's two-second bound and the held
 * download to pass, and really taps the same button again — **Pause** — while
 * the first sentence is still being spoken. Every step is timed and printed.
 *
 * The presses must be one tool call apart by milliseconds, not seconds: the
 * host-side automation tools' round trips (30-60 s each with three simulators
 * booted) cannot land a second press inside one spoken sentence, and every
 * attempt that needed them overshot the whole document.
 *
 *     bash test/manual-test/kit/run-probe.sh Scenario105Probe \
 *       SIMULATOR_UDID OUTPUT_DIR
 *
 * `TEST_RUNNER_SCENARIO_DELAY_MS` (default 4000) is the GET hold;
 * `TEST_RUNNER_SCENARIO_PAUSE_AFTER_MS` (default 6500) is the Play-to-Pause
 * gap. What it cannot prove: the sync's or the reading's internals — the
 * Debug Log, the stub's own log and the Library file carry that; this probe
 * is the two real presses and their timings.
 */
final class Scenario105Probe: XCTestCase {

  private func now(_ label: String) {
    let f = DateFormatter()
    f.dateFormat = "HH:mm:ss.SSS"
    print("TIMESTAMP \(label) \(f.string(from: Date()))")
  }

  func testPlayPauseWithHeldDownload() throws {
    let delayMs = Double(ProcessInfo.processInfo.environment["SCENARIO_DELAY_MS"] ?? "4000") ?? 4000
    let pauseAfterMs = Double(ProcessInfo.processInfo.environment["SCENARIO_PAUSE_AFTER_MS"] ?? "6500") ?? 6500

    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10), "OpenReader did not come to the front")

    // Arm the stub's one-delayed GET for the sync run Play is about to start.
    now("ARM begin")
    armStub(ms: Int(delayMs))
    now("ARM done")

    let transport = app.buttons["Play"]
    XCTAssertTrue(transport.waitForExistence(timeout: 10), "The player's Play button is not there; is the Reading open and paused?")
    XCTAssertEqual(transport.label, "Play", "The button must be Play (the reading paused) before the scenario starts")

    now("PLAY tap")
    // The simulator's synthetic-input state eats presses in runs (pitfalls/mcp.md);
    // retry until the reading answers, i.e. the button reads Pause.
    var fired = false
    for attempt in 1...3 {
      transport.tap()
      now("PLAY tapped (attempt \(attempt))")
      let pausing = app.buttons["Pause"]
      if pausing.waitForExistence(timeout: 4) { fired = true; break }
      now("PLAY press eaten, retrying")
    }
    XCTAssertTrue(fired, "The Play press never took after three attempts")

    // Play's own sync waits up to 2 s, the stub holds the download 4 s, the
    // engine then loads and fetches its first clip: the pause must land after
    // the adoption (about +4 s) and while the long first sentence is still
    // being spoken.
    Thread.sleep(forTimeInterval: pauseAfterMs / 1000.0)

    // While playing the button's label is Pause — the first run reused the
    // Play query, resolved to nothing over the churning playing tree, and the
    // tap never landed.
    let pausing = app.buttons["Pause"]
    XCTAssertTrue(pausing.waitForExistence(timeout: 5), "No Pause button; the reading is not playing")
    now("PAUSE tap")
    pausing.tap()
    now("PAUSE tapped")

    // Settled: the button reads Play again within 15 s (the pause's own
    // bookkeeping, then the sync poke's run, are done by then).
    let backToPlay = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "label == 'Play'"),
      object: transport)
    XCTAssertEqual(XCTWaiter.wait(for: [backToPlay], timeout: 20), .completed,
                   "The button must read Play again (the reading paused) after the second tap")
    now("SETTLED paused")
  }

  /// The stub's control endpoint; the simulator shares the host's loopback.
  private func armStub(ms: Int) {
    let url = URL(string: "http://127.0.0.1:8899/__arm?ms=\(ms)")!
    let done = XCTestExpectation(description: "arm answered")
    let task = URLSession.shared.dataTask(with: url) { _, _, _ in done.fulfill() }
    task.resume()
    XCTAssertEqual(XCTWaiter.wait(for: [done], timeout: 5), .completed, "The stub's /__arm did not answer")
  }

  /**
   * The main scenario's second half: Play (no held download — the Library and
   * the file already agree), then Pause after `PAUSE_AFTER_MS` (default
   * 2600), which lands inside the sentence after the adopted one. The pause's
   * upload is then the stub's business; this probe only makes the two presses.
   */
  func testPlayFromAdoptedPlaceThenPause() throws {
    let pauseAfterMs = Double(ProcessInfo.processInfo.environment["SCENARIO_PAUSE_AFTER_MS"] ?? "2600") ?? 2600

    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10), "OpenReader did not come to the front")

    let play = app.buttons["Play"]
    XCTAssertTrue(play.waitForExistence(timeout: 10), "The player's Play button is not there; is the Reading open and paused?")

    now("PLAY tap")
    play.tap()
    now("PLAY tapped")

    Thread.sleep(forTimeInterval: pauseAfterMs / 1000.0)

    let pausing = app.buttons["Pause"]
    XCTAssertTrue(pausing.waitForExistence(timeout: 5), "No Pause button; the reading is not playing")
    now("PAUSE tap")
    pausing.tap()
    now("PAUSE tapped")

    let backToPlay = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "label == 'Play'"),
      object: play)
    XCTAssertEqual(XCTWaiter.wait(for: [backToPlay], timeout: 20), .completed,
                   "The button must read Play again (the reading paused) after the second tap")
    now("SETTLED paused")
  }
}
