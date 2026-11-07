import XCTest

/// Issue #346 clean rotation choreography control: attach-only probe that
/// guards the target state, activates (never launches) the already-running
/// app, asserts a real visible element, then drives genuine XCUIDevice
/// portrait -> landscapeLeft -> portrait, printing the device orientation AND
/// the target application's own frame inside the test for every case.
/// Refuses to run when the app is not already running.
final class DuoRootRotationProbe: XCTestCase {

  func testActivateAndRotate() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    print("[rot] state before=\(app.state.rawValue) (4=runningForeground)")
    if app.state == .notRunning {
      XCTFail("target app is not running; attach-only probe refuses to launch it")
      return
    }
    app.activate()
    var foreground = false
    for _ in 0..<20 where app.state == .runningForeground {
      foreground = true
      break
    }
    print("[rot] state after activate=\(app.state.rawValue) foreground=\(foreground)")
    XCTAssertTrue(foreground, "app did not reach runningForeground after activate")
    let library = app.staticTexts["Library"]
    let readerTitle = app.staticTexts["A Short Test of Reading Aloud"]
    let visible = library.waitForExistence(timeout: 5) || readerTitle.waitForExistence(timeout: 5)
    XCTAssertTrue(visible, "no Library/Reader element visible after activate")
    print("[rot] app.frame BEFORE=\(app.frame)")
    print("[rot] XCUIDevice.orientation BEFORE=\(XCUIDevice.shared.orientation.rawValue)")

    XCUIDevice.shared.orientation = .landscapeLeft
    sleep(3)
    print("[rot] XCUIDevice.orientation AFTER-LL=\(XCUIDevice.shared.orientation.rawValue)")
    print("[rot] app.frame AFTER-LL=\(app.frame)")
    capture("after-landscapeLeft")
    XCTAssertEqual(XCUIDevice.shared.orientation, .landscapeLeft, "device orientation did not take")

    XCUIDevice.shared.orientation = .portrait
    sleep(3)
    print("[rot] XCUIDevice.orientation AFTER-P=\(XCUIDevice.shared.orientation.rawValue)")
    print("[rot] app.frame AFTER-P=\(app.frame)")
    capture("after-portrait")
    XCTAssertEqual(XCUIDevice.shared.orientation, .portrait, "device orientation did not take")
    print("[rot] app.state END=\(app.state.rawValue)")
  }

  private func capture(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name
    image.lifetime = .keepAlways
    add(image)
  }
}
