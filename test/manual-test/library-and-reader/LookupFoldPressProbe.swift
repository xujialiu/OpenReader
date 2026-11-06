import XCTest

/// Issue #346 N3: an attach-only long-press at a caller-supplied normalized
/// point. Attaches to the already-running OpenReader (never launches or
/// terminates), presses once for 2.0 s so the reader starts a word lookup, and
/// keeps a screenshot. The point comes from PRESS_POINT_FILE (a file holding
/// `X Y` in window points; env forwarding through TEST_RUNNER_ proved
/// unreliable for this probe, pitfall: run-probe env) with the LookupModeProbe
/// phone point as fallback:
///
///   bash test/manual-test/kit/run-probe.sh LookupFoldPressProbe UDID DIR \
///     -only-testing:LookupFoldPressProbe/testLongPressHope
final class LookupFoldPressProbe: XCTestCase {

  func testLongPressHope() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    var dx = 56.0, dy = 340.0, w = 402.0, h = 874.0
    let pointFile = ProcessInfo.processInfo.environment["TEST_RUNNER_PRESS_POINT_FILE"]
      ?? ProcessInfo.processInfo.environment["PRESS_POINT_FILE"]
      ?? "/tmp/openreader-issue346-native-01/logs/hope-point.txt"
    if let raw = try? String(contentsOfFile: pointFile, encoding: .utf8) {
      let numbers = raw.split(whereSeparator: { $0 == " " || $0 == "\n" }).compactMap { Double($0) }
      if numbers.count >= 4 { w = numbers[2]; h = numbers[3] }
      if numbers.count >= 2 { dx = numbers[0]; dy = numbers[1] }
      print("[press] point file \(pointFile) read \(numbers)")
    } else {
      print("[press] point file \(pointFile) unreadable; defaults")
    }
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
