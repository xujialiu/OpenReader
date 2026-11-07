import XCTest

/// Issue #346 N3: an attach-only long-press at a caller-supplied normalized
/// point. Attaches to the already-running OpenReader (never launches or
/// terminates), presses once for 2.0 s so the reader starts a word lookup, and
/// keeps a screenshot. PRESS_POINT_FILE holds `X Y WINDOW_WIDTH WINDOW_HEIGHT`.
/// When environment forwarding is unavailable, the caller must write the same
/// four values to /tmp/openreader-lookup-SIMULATOR_UDID.point (uppercase UUID).
/// Missing input or changed window geometry fails, never guesses a phone point.
///
///   bash test/manual-test/kit/run-probe.sh LookupFoldPressProbe UDID DIR \
///     -only-testing:LookupFoldPressProbe/testLongPressHope
final class LookupFoldPressProbe: XCTestCase {

  func testLongPressHope() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    guard app.state != .notRunning else {
      XCTFail("Attach-only probe refuses to launch a dead target")
      return
    }
    app.activate()
    guard app.state == .runningForeground else {
      XCTFail("Target is not foreground")
      return
    }
    let env = ProcessInfo.processInfo.environment
    let pointFile: String
    if let explicit = env["TEST_RUNNER_PRESS_POINT_FILE"] ?? env["PRESS_POINT_FILE"] {
      pointFile = explicit
    } else {
      guard let rawID = env["SIMULATOR_UDID"], let device = UUID(uuidString: rawID) else {
        XCTFail("Supply PRESS_POINT_FILE or run on an identified simulator")
        return
      }
      pointFile = "/tmp/openreader-lookup-\(device.uuidString).point"
    }
    guard let raw = try? String(contentsOfFile: pointFile, encoding: .utf8) else {
      XCTFail("Missing calibration file: \(pointFile)")
      return
    }
    let numbers = raw.split(whereSeparator: { $0.isWhitespace }).compactMap { Double($0) }
    guard numbers.count == 4, numbers.allSatisfy({ $0.isFinite }) else {
      XCTFail("Calibration requires exactly four finite numbers")
      return
    }
    let dx = numbers[0], dy = numbers[1], w = numbers[2], h = numbers[3]
    guard w > 0, h > 0, dx >= 0, dx < w, dy >= 0, dy < h,
          abs(app.frame.width - w) < 1, abs(app.frame.height - h) < 1 else {
      XCTFail("Calibration outside or different from current window: \(numbers), \(app.frame)")
      return
    }
    print("[press] point file \(pointFile) read \(numbers)")
    print("[press] point dx=\(dx)/\(w) dy=\(dy)/\(h) state=\(app.state.rawValue)")
    let point = app.coordinate(withNormalizedOffset: CGVector(dx: dx / w, dy: dy / h))
    point.press(forDuration: 2.0)
    sleep(1)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = "after-long-press"
    image.lifetime = .keepAlways
    add(image)
    print("[press] done")
  }
}
