import XCTest

/// Issue #346 caret-fold control: attach-only; types into the already-focused
/// element without tapping/refocusing it. Refuses a not-running target.
final class DuoCaretTypeProbe: XCTestCase {
  func testTypeAtExistingCaret() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    print("[caret] state=\(app.state.rawValue)")
    if app.state == .notRunning {
      XCTFail("target app is not running; attach-only probe refuses to launch")
      return
    }
    app.activate()
    print("[caret] typing x at the existing caret")
    app.typeText("x")
    sleep(1)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = "after-caret-type"
    image.lifetime = .keepAlways
    add(image)
    print("[caret] done")
  }
}

extension DuoCaretTypeProbe {
  /// Submits the Create-folder alert through an XCTest coordinate press on the
  /// Create button's own coordinates (element taps on this SwiftUI alert are
  /// lost; the coordinate press is the proven submission channel).
  func testSubmitCreate() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    print("[submit] state=\(app.state.rawValue)")
    if app.state == .notRunning {
      XCTFail("target app is not running; attach-only probe refuses to launch")
      return
    }
    let create = app.buttons["Create"]
    guard create.waitForExistence(timeout: 5) else {
      XCTFail("Create button not present")
      return
    }
    print("[submit] Create frame=\(create.frame)")
    let press = create.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    press.press(forDuration: 0.1)
    sleep(3)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = "after-submit"
    image.lifetime = .keepAlways
    add(image)
    print("[submit] pressed; alert gone=\(!create.exists)")
  }
}
