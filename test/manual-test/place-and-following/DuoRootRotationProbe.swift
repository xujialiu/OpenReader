import XCTest

/// Issue #349: diagnostic of XCTest's orientation-input path, NOT acceptance.
/// On Duo, XCUIDevice's getter can change without the target receiving a device
/// event. Use duo-rotation.py for real Device Hub input and target-side checks.
/// Opt in with --mode xcdevice-diagnostic. Attach only to an already-running
/// app on the outer display; never request forced app geometry.
final class DuoRootRotationProbe: XCTestCase {

  func testXCTestOrientationDeliveryDiagnostic() throws {
    let mode = Bundle(for: Self.self).object(forInfoDictionaryKey: "ManualMode") as? String
    guard mode == "xcdevice-diagnostic" else {
      throw XCTSkip("Diagnostic only: opt in with --mode xcdevice-diagnostic; use duo-rotation.py for acceptance")
    }
    print("[rot] DIAGNOSTIC ONLY: XCUIDevice is not target-side device-event evidence")
    let bundle = Bundle(for: Self.self).object(forInfoDictionaryKey: "ManualTargetBundleIdentifier") as? String ?? "top.xujialiu.openreader"
    let app = XCUIApplication(bundleIdentifier: bundle)
    print("[rot] target=\(bundle)")
    print("[rot] state before=\(app.state.rawValue) (4=runningForeground)")
    if app.state == .notRunning {
      XCTFail("target app is not running; attach-only probe refuses to launch it")
      return
    }
    app.activate()
    let foreground = app.wait(for: .runningForeground, timeout: 5)
    print("[rot] state after activate=\(app.state.rawValue) foreground=\(foreground)")
    guard foreground else {
      XCTFail("app did not reach runningForeground after activate")
      return
    }
    defer { XCUIDevice.shared.orientation = .portrait }
    let library = app.staticTexts["Library"]
    let readerTitle = app.staticTexts["A Short Test of Reading Aloud"]
    let visible = library.waitForExistence(timeout: 5) || readerTitle.waitForExistence(timeout: 5)
    guard visible else {
      XCTFail("no Library/Reader element visible after activate")
      return
    }
    XCUIDevice.shared.orientation = .portrait
    XCTAssertTrue(waitForShape(app, landscape: false), "portrait precondition failed")
    let portrait = app.frame
    print("[rot] app.frame BEFORE=\(portrait)")
    capture("before-portrait")
    print("[rot] XCUIDevice.orientation BEFORE=\(XCUIDevice.shared.orientation.rawValue)")

    XCUIDevice.shared.orientation = .landscapeLeft
    let rotated = waitForShape(app, landscape: true)
    print("[rot] XCUIDevice.orientation AFTER-LL=\(XCUIDevice.shared.orientation.rawValue)")
    print("[rot] app.frame AFTER-LL=\(app.frame)")
    capture("after-landscapeLeft")
    XCTAssertEqual(XCUIDevice.shared.orientation, .landscapeLeft, "device orientation did not take")
    XCTAssertTrue(rotated, "#349 diagnostic: XCTest reports landscape but the target window did not rotate; this does not establish event delivery; frame=\(app.frame)")
    XCTAssertTrue(library.exists || readerTitle.exists, "rendered content disappeared after rotation")

    XCUIDevice.shared.orientation = .portrait
    let restored = waitForShape(app, landscape: false)
    print("[rot] XCUIDevice.orientation AFTER-P=\(XCUIDevice.shared.orientation.rawValue)")
    print("[rot] app.frame AFTER-P=\(app.frame)")
    capture("after-portrait")
    XCTAssertEqual(XCUIDevice.shared.orientation, .portrait, "device orientation did not take")
    XCTAssertTrue(restored, "app window did not return to portrait")
    XCTAssertEqual(app.frame.width, portrait.width, accuracy: 1)
    XCTAssertEqual(app.frame.height, portrait.height, accuracy: 1)
    XCTAssertEqual(app.state, .runningForeground)
    print("[rot] app.state END=\(app.state.rawValue)")
  }

  private func waitForShape(_ app: XCUIApplication, landscape: Bool) -> Bool {
    let predicate = NSPredicate { _, _ in
      let frame = app.frame
      return frame.width > 0 && frame.height > 0 &&
        (landscape ? frame.width > frame.height : frame.height > frame.width)
    }
    return XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: nil)], timeout: 3) == .completed
  }

  private func capture(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name
    image.lifetime = .keepAlways
    add(image)
  }
}
