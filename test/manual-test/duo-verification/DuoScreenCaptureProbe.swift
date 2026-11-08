import XCTest

/// focus-causal-01 capture-only helper: attaches to the already-running
/// OpenReader and captures EVERY XCUIScreen at device scale. No interaction,
/// never launches, never taps. The Duo's active inner display is a separate
/// screen from XCUIScreen.main (DuoDrawerCloseProbe measured main=outer while
/// the app presented 951x669 on the inner one).
///
///   bash test/manual-test/kit/run-probe.sh DuoScreenCaptureProbe SIMULATOR_UDID OUT_DIR \
///     -only-testing:DuoScreenCaptureProbe/testCaptureAllScreens -collect-test-diagnostics never
final class DuoScreenCaptureProbe: XCTestCase {

  func testCaptureAllScreens() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    guard app.state != .notRunning else {
      XCTFail("Attach-only probe refuses to launch a dead target")
      return
    }
    for (index, screen) in XCUIScreen.screens.enumerated() {
      let image = XCTAttachment(screenshot: screen.screenshot())
      image.name = "screen-\(index)"
      image.lifetime = .keepAlways
      add(image)
      print("[capture] screen \(index) captured")
    }
  }
}
