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
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
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

/// #345 follow-up: rotation WITH the seeded Document open on the iPad. The
/// host stages the walkthrough harness's `open` command before this run, so
/// the single launch below mounts the Reader; the test never terminates or
/// relaunches away from it. Real XCUIDevice rotation input; the reader's
/// app frame is measured in both orientations; renderer logs and whole-screen
/// captures establish the content separately. App-only captures can be cropped
/// against the wrong rotated bounds. The Reading Position comparison is host-side.
final class OrientationDocumentProbe: XCTestCase {

  /// The Reader screen's own controls: the Library back button and the `…`
  /// More actions button (the Library screen has neither).
  @MainActor
  private func readerReady(_ app: XCUIApplication) -> Bool {
    let more = app.buttons["More actions"]
    let library = app.buttons.matching(NSPredicate(format: "label == 'Library'")).firstMatch
    return more.exists && library.exists
  }

  /// #345 follow-up: rotation WITH the seeded Document open on the iPad. The
  /// host stages the walkthrough harness's `open` command before this run; a
  /// fresh launch replays it and mounts the Reader, and this test never
  /// terminates or relaunches away from it. Real XCUIDevice rotation input;
  /// the app window frame is measured in both orientations (the reader's
  /// WebView/iframe pixel widths are printed by the app itself in its Debug
  /// Log `[renderer]` lines, which the host reads around these timestamps).
  /// The Reading Position comparison happens host-side from the persisted
  /// store. WKWebView does not surface as an XCUITest `webViews` element here
  /// (measured), so content readability is asserted via the reader controls
  /// plus the retained screenshots and the renderer's own display lines.
  @MainActor
  func testRotationWithOpenDocumentKeepsReaderAndContent() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()
    XCTAssertTrue(app.waitForExistence(timeout: 30), "app did not launch")
    let ready = try XCTWaiter().wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in self.readerReady(app) }, object: nil)], timeout: 30) == .completed
    if !ready { shoot(app, name: "reader-not-mounted") }
    XCTAssertTrue(ready, "the Reader did not mount (was the harness open staged, and did the launch replay it?)")
    Thread.sleep(forTimeInterval: 2)
    let portrait = app.frame
    print("PROBE-DOC-PORTRAIT frame=\(Int(portrait.width))x\(Int(portrait.height))")
    let shotPortrait = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    shotPortrait.lifetime = .keepAlways
    shotPortrait.name = "doc-portrait"
    add(shotPortrait)

    XCUIDevice.shared.orientation = .landscapeLeft
    Thread.sleep(forTimeInterval: 2.5)
    XCTAssertTrue(readerReady(app), "the Reader did not survive landscape rotation")
    let landscape = app.frame
    print("PROBE-DOC-LANDSCAPE frame=\(Int(landscape.width))x\(Int(landscape.height))")
    let shotLandscape = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    shotLandscape.lifetime = .keepAlways
    shotLandscape.name = "doc-landscape"
    add(shotLandscape)
    XCTAssertGreaterThan(landscape.width, portrait.width, "rotation did not widen the reader")

    XCUIDevice.shared.orientation = .portrait
    Thread.sleep(forTimeInterval: 2.5)
    XCTAssertTrue(readerReady(app), "the Reader did not survive the return to portrait")
    let back = app.frame
    print("PROBE-DOC-BACK frame=\(Int(back.width))x\(Int(back.height))")
    XCTAssertLessThan(back.width, landscape.width, "return to portrait did not restore the width")
  }

  @MainActor
  private func shoot(_ app: XCUIApplication, name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.lifetime = .keepAlways
    attachment.name = name
    add(attachment)
  }
}
