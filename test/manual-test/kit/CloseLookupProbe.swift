import XCTest

/// Ordinary-lane 3 helper: attach-only tap on the lookup drawer's "Close Lookup"
/// control. Synthetic point taps at the button's visible frame did not dismiss
/// the drawer on the resized ordinary iPad window (2026-11-08, task-3 report);
/// the instrumentation-channel tap is the verified input. Attaches to the
/// already-running OpenReader; never launches, terminates or scrolls.
final class CloseLookupProbe: XCTestCase {

  func testTapCloseLookup() {
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
    let button = app.buttons["Close Lookup"]
    guard button.waitForExistence(timeout: 10) else {
      XCTFail("Close Lookup control is not present")
      return
    }
    button.tap()
    let gone = !button.exists || button.waitForNonExistence(timeout: 10)
    XCTAssertTrue(gone, "Lookup drawer still present after the Close Lookup tap")
  }
}
