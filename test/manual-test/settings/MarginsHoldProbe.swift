import XCTest

/// #344 verification on the device: the Margins stepper's percentage behavior.
/// Real taps, holds, a drag-off cancel, and a drawer closed from the walkthrough
/// harness in the middle of a held repeat. Attach the already-running app with
/// `XCUIApplication(bundleIdentifier:)` (the #311 pattern): this probe never
/// launches or terminates the app — the phase script stages the start state.
///
/// Timing evidence lives outside: every step persists synchronously to the
/// app's settings.json (shell.tsx's `setSettings`), so the phase script's
/// high-frequency poller measures the hold cadence; the probe itself asserts
/// displayed values and keeps attachments. Mark files under
/// /tmp/openreader-344-ios-01/probe-marks give the script the press moments.
final class MarginsHoldProbe: XCTestCase {
  /// The phase script's poller and watcher share this directory; it arrives as
  /// TEST_RUNNER_OPENREADER_PROBE_MARKS on the xcodebuild command line.
  var marks: String {
    ProcessInfo.processInfo.environment["OPENREADER_PROBE_MARKS"]
      ?? (NSTemporaryDirectory() as NSString).appendingPathComponent("openreader-margins-marks")
  }

  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  /// A host-clock timestamp with milliseconds, so the script's poller can
  /// align its samples with the gesture and derive the 400/200/75 ms cadence.
  func mark(_ name: String, _ detail: String) {
    let format = ISO8601DateFormatter()
    format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let stamp = format.string(from: Date())
    try? FileManager.default.createDirectory(atPath: marks, withIntermediateDirectories: true)
    try? "\(name) \(stamp) \(detail)\n".write(toFile: "\(marks)/\(name)", atomically: true, encoding: .utf8)
  }

  func ensureAppearanceOpen(_ app: XCUIApplication) {
    if app.buttons["Close Appearance"].waitForExistence(timeout: 2) { return }
    XCTAssertTrue(app.buttons["More actions"].waitForExistence(timeout: 10), "Reader's More actions missing")
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Appearance"].waitForExistence(timeout: 5), "Actions menu's Appearance row missing")
    app.buttons["Appearance"].tap()
    XCTAssertTrue(app.buttons["Close Appearance"].waitForExistence(timeout: 5), "Appearance sheet did not open")
    XCTAssertTrue(app.staticTexts["Margins"].waitForExistence(timeout: 5), "Margins row missing")
  }

  /// The margins value is the only percent static text on the sheet.
  func marginsValue(_ app: XCUIApplication) -> Int? {
    let query = app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "^\\d+%$"))
    guard query.firstMatch.exists else { return nil }
    let label = query.firstMatch.label
    return Int(label.dropLast())
  }

  func waitForValue(_ app: XCUIApplication, _ expected: Int, timeout: TimeInterval = 3) -> Bool {
    let wanted = "\(expected)%"
    let query = app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "^\\d+%$"))
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if query.firstMatch.exists && query.firstMatch.label == wanted { return true }
      Thread.sleep(forTimeInterval: 0.1)
    }
    return query.firstMatch.exists && query.firstMatch.label == wanted
  }

  /// Walks the displayed value to `target` with real taps. Ends within one
  /// step of target; returns the reached value.
  @discardableResult
  func walkTo(_ app: XCUIApplication, _ target: Int) -> Int {
    let increase = app.buttons["Increase margins"]
    let decrease = app.buttons["Decrease margins"]
    for _ in 0..<30 {
      guard let current = marginsValue(app) else { break }
      if current == target { return current }
      if current < target, increase.isEnabled {
        increase.tap()
        _ = waitForValue(app, current + 1)
      } else if current > target, decrease.isEnabled {
        decrease.tap()
        _ = waitForValue(app, current - 1)
      } else { break }
    }
    return marginsValue(app) ?? -1
  }

  /// One tap = exactly one percentage point, and the display carries `%`.
  /// Stages 10 by real taps, then 10 -> 9 -> 8 -> 9 -> 10.
  func test01TapStepsExactlyOnePointWithPercentSuffix() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    ensureAppearanceOpen(app)
    let start = try XCTUnwrap(walkTo(app, 10), "could not walk to 10")
    XCTAssertEqual(start, 10, "staged start for the tap steps")
    let decrease = app.buttons["Decrease margins"]
    let increase = app.buttons["Increase margins"]

    decrease.tap()
    XCTAssertTrue(waitForValue(app, 9), "Decrease went to \(marginsValue(app) ?? -1), wanted 9")
    decrease.tap()
    XCTAssertTrue(waitForValue(app, 8), "Second Decrease must step exactly one")
    increase.tap()
    XCTAssertTrue(waitForValue(app, 9), "Increase after two Decreases must return one step")
    increase.tap()
    XCTAssertTrue(waitForValue(app, 10), "Increase must return to the start value")
    capture("tap-one-point-at-10", app)
  }

  /// A held Increase repeats one point at a time; the phase script's poller
  /// measures 400ms first repeat, 200ms cadence, then 75ms. Release inside
  /// the button adds no extra step (the release click is suppressed).
  func test02HoldRepeatsThenReleaseAddsNoStep() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    ensureAppearanceOpen(app)
    let start = try XCTUnwrap(walkTo(app, 8), "could not walk to 8")
    XCTAssertEqual(start, 8, "staged start for the hold")
    let increase = app.buttons["Increase margins"]
    mark("hold-begin", "start=8")
    increase.press(forDuration: 1.8)
    mark("hold-end", "")
    let after = try XCTUnwrap(marginsValue(app), "value unreadable after hold")
    XCTAssertGreaterThan(after, start, "held repeats must have advanced the value")
    Thread.sleep(forTimeInterval: 1.5)
    let settled = try XCTUnwrap(marginsValue(app), "value unreadable after release")
    XCTAssertEqual(settled, after, "release added an extra step or a late repeat: \(after) -> \(settled)")
    capture("hold-released-at-\(settled)", app)
    walkTo(app, 1)
  }

  /// A press that slides off the button before the hold threshold cancels:
  /// no tap step, no repeats, no change. The drag target is an absolute
  /// coordinate over the sheet's header (no button there), not a label query:
  /// the row label matches two AX elements and a second button would risk a
  /// tap on release.
  func test03DragOffBeforeRepetitionChangesNothing() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    ensureAppearanceOpen(app)
    let start = try XCTUnwrap(walkTo(app, 10), "could not walk to 10")
    XCTAssertEqual(start, 10)
    let increase = app.buttons["Increase margins"]
    mark("cancel-begin", "start=10")
    // Exit the button and retention area within the 400ms hold threshold.
    // The old 0.25s + default-velocity drag repeated legitimately before exit.
    let grip = increase.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    let outside = grip.withOffset(CGVector(dx: -140, dy: 0))
    grip.press(forDuration: 0.01, thenDragTo: outside, withVelocity: XCUIGestureVelocity(4000), thenHoldForDuration: 0)
    mark("cancel-end", "")
    Thread.sleep(forTimeInterval: 1.2)
    let after = try XCTUnwrap(marginsValue(app), "value unreadable after cancel")
    XCTAssertEqual(after, start, "cancelled press changed the value to \(after)")
    capture("cancel-kept-\(after)", app)
    // Same input path with a longer dwell is a positive control for a hold.
    grip.press(forDuration: 0.65, thenDragTo: outside, withVelocity: XCUIGestureVelocity(4000), thenHoldForDuration: 0)
    let heldValue = try XCTUnwrap(marginsValue(app))
    XCTAssertGreaterThan(heldValue, start, "long-dwell control did not repeat")
    Thread.sleep(forTimeInterval: 1.2)
    XCTAssertEqual(marginsValue(app), heldValue, "repetition continued outside the button")
  }

  /// A real hold with handler-assisted close of STANDALONE Appearance,
  /// whose visible prop the harness controls. Not a concurrent native Close
  /// touch test. Close after two persisted repeats, require disappearance and
  /// a stable mid-range value rather than confusing cutoff with the endpoint.
  func test04CloseDrawerDuringRepetitionStopsIt() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    let env = ProcessInfo.processInfo.environment
    let data = try XCTUnwrap(env["OPENREADER_PROBE_DATA"] ?? env["TEST_RUNNER_OPENREADER_PROBE_DATA"], "Pass the selected app data container")
    let documents = URL(fileURLWithPath: data).appendingPathComponent("Documents")
    func command(_ on: Bool) throws {
      let json = try JSONSerialization.data(withJSONObject: ["seq": Int(Date().timeIntervalSince1970 * 1000), "do": "appearsheet", "on": on])
      try json.write(to: documents.appendingPathComponent("harness.json"), options: .atomic)
    }
    if app.buttons["Close Appearance"].exists { app.buttons["Close Appearance"].tap(); Thread.sleep(forTimeInterval: 1) }
    try command(true)
    XCTAssertTrue(app.buttons["Close Appearance"].waitForExistence(timeout: 5))
    let start = walkTo(app, 6)
    XCTAssertEqual(start, 6)
    let closed = expectation(description: "close requested after two repeats")
    DispatchQueue.global().async {
      let deadline = Date().addingTimeInterval(8)
      while Date() < deadline {
        if let bytes = try? Data(contentsOf: documents.appendingPathComponent("settings.json")),
           let root = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
           let settings = root["settings"] as? [String: Any],
           let appearance = settings["appearance"] as? [String: Any],
           let value = appearance["margins"] as? Int, value >= 8 {
          do { try command(false); closed.fulfill() } catch { XCTFail("close command failed: \(error)") }
          return
        }
        Thread.sleep(forTimeInterval: 0.02)
      }
      XCTFail("No repeated settings writes to trigger the close")
    }
    let increase = app.buttons["Increase margins"]
    mark("close-begin", "start=6 handler-assisted standalone close")
    increase.press(forDuration: 2.0)
    wait(for: [closed], timeout: 9)
    mark("close-end", "")
    // The drawer must actually have closed under the held finger.
    let gone = !app.buttons["Close Appearance"].waitForExistence(timeout: 2)
    XCTAssertTrue(gone, "the Appearance drawer did not close during the held repeat")
    Thread.sleep(forTimeInterval: 1.2)
    try command(true)
    XCTAssertTrue(app.buttons["Close Appearance"].waitForExistence(timeout: 5))
    let after = try XCTUnwrap(marginsValue(app), "value unreadable after close-hold")
    XCTAssertGreaterThan(after, start, "no repeats were measured before the close")
    XCTAssertLessThan(after, 25, "the hold reached the 25% endpoint before the close: cutoff confounded")
    Thread.sleep(forTimeInterval: 1.5)
    let settled = try XCTUnwrap(marginsValue(app), "value unreadable after close-hold settle")
    XCTAssertEqual(settled, after, "repeats continued after the drawer closed: \(after) -> \(settled)")
    capture("close-mid-hold-stable-\(settled)", app)
    walkTo(app, 1)
    app.buttons["Close Appearance"].tap()
    try? FileManager.default.removeItem(at: documents.appendingPathComponent("harness.json"))
  }

  /// 0% and 25% disable the outward button and leave the inward one working.
  func test05EndpointsDisableOutwardAndEnableInward() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    ensureAppearanceOpen(app)
    let decrease = app.buttons["Decrease margins"]
    let increase = app.buttons["Increase margins"]

    let atBottom = walkTo(app, 0)
    XCTAssertEqual(atBottom, 0, "could not walk down to 0")
    XCTAssertFalse(decrease.isEnabled, "Decrease must disable at 0%")
    XCTAssertTrue(increase.isEnabled, "Increase must stay enabled at 0%")
    capture("endpoint-0", app)
    increase.tap()
    XCTAssertTrue(waitForValue(app, 1), "Increase at 0% must step to 1%")

    let atTop = walkTo(app, 25)
    XCTAssertEqual(atTop, 25, "could not walk up to 25")
    XCTAssertFalse(increase.isEnabled, "Increase must disable at 25%")
    XCTAssertTrue(decrease.isEnabled, "Decrease must stay enabled at 25%")
    capture("endpoint-25", app)
    decrease.tap()
    XCTAssertTrue(waitForValue(app, 24), "Decrease at 25% must step to 24%")
    walkTo(app, 1)
  }

  /// Font Size stays tap-only: a 1.6 s hold releases exactly one ladder step
  /// and must not repeat. The poller shows a single write at the release.
  func test06FontSizeHoldDoesNotRepeat() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    ensureAppearanceOpen(app)
    let sizeQuery = app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "^\\d+$"))
    let before = try XCTUnwrap(Int(sizeQuery.firstMatch.label), "font size not readable")
    let increase = app.buttons["Increase font size"]
    mark("font-hold-begin", "start=\(before)")
    increase.press(forDuration: 1.6)
    mark("font-hold-end", "")
    Thread.sleep(forTimeInterval: 1.0)
    let after = try XCTUnwrap(Int(sizeQuery.firstMatch.label), "font size unreadable after hold")
    // One ladder step up from `before` (the ladder doubles after 24).
    let step = before >= 24 ? 2 : 1
    XCTAssertEqual(after, before + step, "held Font Size must commit exactly one step on release")
    Thread.sleep(forTimeInterval: 1.2)
    let settled = try XCTUnwrap(Int(sizeQuery.firstMatch.label), "font size unreadable after settle")
    XCTAssertEqual(settled, after, "Font Size repeated while held")
    capture("font-hold-one-step-\(settled)", app)
    let decrease = app.buttons["Decrease font size"]
    decrease.tap()
    Thread.sleep(forTimeInterval: 0.8)
    XCTAssertEqual(Int(sizeQuery.firstMatch.label) ?? -1, before, "could not restore the font size")
  }
}
