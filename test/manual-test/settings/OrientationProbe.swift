import XCTest

/// Rotates the simulator with XCUIDevice and measures the app window's actual
/// geometry before/after, so an iPad orientation claim rests on numbers rather
/// than a settings read. Run with run-probe.sh on a booted iPad.
final class OrientationProbe: XCTestCase {

  @MainActor
  func testRotationChangesWindowGeometry() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.launch()
    XCTAssertTrue(app.waitForExistence(timeout: 30), "app did not launch")
    let before = app.frame
    print("PROBE-FRAME-PORTRAIT \(Int(before.width))x\(Int(before.height))")
    XCUIDevice.shared.orientation = .landscapeLeft
    sleep(3)
    let landscape = app.frame
    print("PROBE-FRAME-LANDSCAPE \(Int(landscape.width))x\(Int(landscape.height))")
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.lifetime = .keepAlways
    attachment.name = "landscape"
    add(attachment)
    XCUIDevice.shared.orientation = .portrait
    sleep(3)
    let back = app.frame
    print("PROBE-FRAME-BACK \(Int(back.width))x\(Int(back.height))")
    XCTAssertGreaterThan(landscape.width, landscape.height, "landscape orientation did not take (frame still portrait-shaped)")
    XCTAssertLessThan(back.width, back.height, "return to portrait did not take")
  }
}
