import XCTest

/// Tester attempt helper (duo-sim-runtime, 2026-11-08): attach-only geometry
/// calibration for #350's native handle drag. Prints the app frame, the live
/// Reader WebView frame and every connected screen's bounds in XCUITest's own
/// coordinate space, and keeps per-screen screenshots. Never launches,
/// terminates, scrolls or taps.
///
///   bash test/manual-test/kit/run-probe.sh DuoFrameCalibrationProbe UDID DIR \
///     -collect-test-diagnostics never
final class DuoFrameCalibrationProbe: XCTestCase {
  private let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")

  func testCloseDrawerGrabber() {
    XCTAssertEqual(app.state, .runningForeground, "PRECONDITION: attach to the running foreground app")
    let grabbers = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Grabber'"))
    print("DuoDrawerClose-v1 grabber.matches=\(grabbers.count)")
    guard grabbers.count >= 1 else {
      XCTFail("Sheet Grabber not exposed"); return
    }
    let grabber = grabbers.element(boundBy: 0)
    let frame = grabber.frame
    print("DuoDrawerClose-v1 grabber.frame=\(frame)")
    let start = grabber.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    let end = start.withOffset(CGVector(dx: 0, dy: 420))
    start.press(forDuration: 0.15, thenDragTo: end)
    sleep(2)
    capture("drawer-closed")
  }

  func testStepFontDown() {
    XCTAssertEqual(app.state, .runningForeground, "PRECONDITION: attach to the running foreground app")
    let rows = app.staticTexts.matching(identifier: "Font Size")
    print("DuoFontStep-v1 row.matches=\(rows.count)")
    guard rows.count >= 1 else {
      XCTFail("Font Size row not exposed"); return
    }
    let row = rows.element(boundBy: 0)
    let down = app.buttons["Decrease font size"]
    guard down.waitForExistence(timeout: 5) else {
      XCTFail("Decrease font size button not exposed"); return
    }
    print("DuoFontStep-v1 down.frame=\(down.frame) hittable=\(down.isHittable)")
    down.tap()
    sleep(2)
    capture("font-step-down")
  }

  func testStepFontUp() {
    XCTAssertEqual(app.state, .runningForeground, "PRECONDITION: attach to the running foreground app")
    let rows = app.staticTexts.matching(identifier: "Font Size")
    print("DuoFontStep-v1 row.matches=\(rows.count)")
    guard rows.count >= 1 else {
      XCTFail("Font Size row not exposed"); return
    }
    let row = rows.element(boundBy: 0)
    print("DuoFontStep-v1 row.frame=\(row.frame)")
    let near = app.buttons.matching(NSPredicate(format: "label CONTAINS[cd] 'ncrease' OR label CONTAINS[cd] '+'"))
    print("DuoFontStep-v1 increaseCandidates=\(near.count)")
    for index in 0..<min(near.count, 4) {
      let element = near.element(boundBy: index)
      print("DuoFontStep-v1 increase[\(index)].frame=\(element.frame) label='\(element.label)' hittable=\(element.isHittable)")
    }
    if near.count > 0 {
      let element = near.element(boundBy: 0)
      print("DuoFontStep-v1 tapping element at \(element.frame)")
      element.tap()
    } else {
      // Element-anchored coordinate: correct landscape space at this pose.
      let anchor = row.coordinate(withNormalizedOffset: .zero)
      let point = anchor.withOffset(CGVector(dx: row.frame.width + 450, dy: row.frame.height / 2))
      print("DuoFontStep-v1 tapping anchored point from row \(row.frame) dx=\(row.frame.width + 450)")
      point.tap()
    }
    sleep(2)
    capture("font-step-up")
  }

  func testOpenAppearance() {
    XCTAssertEqual(app.state, .runningForeground, "PRECONDITION: attach to the running foreground app")
    let more = app.buttons["More actions"]
    guard more.waitForExistence(timeout: 5) else {
      XCTFail("More actions button not exposed"); return
    }
    print("DuoAppearance-v1 more.frame=\(more.frame) hittable=\(more.isHittable)")
    more.tap()
    sleep(1)
    for query in [app.buttons["Appearance"], app.staticTexts["Appearance"],
                  app.otherElements["Appearance"], app.cells["Appearance"]] {
      if query.exists {
        print("DuoAppearance-v1 appearance.frame=\(query.frame) hittable=\(query.isHittable) type=tapped")
        query.tap()
        sleep(2)
        capture("appearance-opened")
        return
      }
    }
    let candidates = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Appearance'"))
    print("DuoAppearance-v1 candidates=\(candidates.count)")
    for index in 0..<min(candidates.count, 5) {
      let element = candidates.element(boundBy: index)
      print("DuoAppearance-v1 candidate[\(index)]=\(element.elementType.rawValue) frame=\(element.frame) label='\(element.label)'")
    }
    capture("appearance-menu-no-row")
  }

  private func capture(_ name: String) {
    for (index, screen) in XCUIScreen.screens.enumerated() {
      let image = XCTAttachment(screenshot: screen.screenshot())
      image.name = "\(name)-screen\(index)"
      image.lifetime = .keepAlways
      add(image)
    }
  }

  func testPrintFrames() {
    XCTAssertEqual(app.state, .runningForeground, "PRECONDITION: attach to the running foreground app")
    let f = app.frame
    print("DuoFrameCalibration-v1 app.frame=\(f.minX),\(f.minY) \(f.width)x\(f.height)")
    let web = app.webViews.firstMatch
    if web.exists {
      let w = web.frame
      print("DuoFrameCalibration-v1 webView.frame=\(w.minX),\(w.minY) \(w.width)x\(w.height)")
    } else {
      print("DuoFrameCalibration-v1 webView=absent")
    }
    // #351 native-exposure diagnostic: windows, query element diagnostics.
    print("DuoFrameCalibration-v1 windows.count=\(app.windows.count)")
    for (index, window) in app.windows.allElementsBoundByIndex.enumerated() {
      let wf = window.frame
      print("DuoFrameCalibration-v1 window\(index).frame=\(wf.minX),\(wf.minY) \(wf.width)x\(wf.height) id=\(window.identifier)")
    }
    let queryMatches = app.staticTexts.matching(identifier: "hope")
    let queryCount = queryMatches.count
    print("DuoFrameCalibration-v1 query.matches=\(queryCount)")
    for index in 0..<min(queryCount, 6) {
      let element = queryMatches.element(boundBy: index)
      let qf = element.frame
      print("DuoFrameCalibration-v1 query[\(index)].frame=\(qf.minX),\(qf.minY) \(qf.width)x\(qf.height) hittable=\(element.isHittable)")
    }
    let defnMatches = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "To want something to happen"))
    let defnCount = defnMatches.count
    print("DuoFrameCalibration-v1 definition.matches=\(defnCount)")
    for index in 0..<min(defnCount, 3) {
      let element = defnMatches.element(boundBy: index)
      let df = element.frame
      print("DuoFrameCalibration-v1 definition[\(index)].frame=\(df.minX),\(df.minY) \(df.width)x\(df.height) hittable=\(element.isHittable)")
    }
    let copy = app.buttons["Copy result"]
    print("DuoFrameCalibration-v1 copy.exists=\(copy.exists) hittable=\(copy.isHittable)")
    for (index, screen) in XCUIScreen.screens.enumerated() {
      // XCUIScreen exposes no bounds in this SDK (README pitfall); the captured
      // image's own pixel size records each screen's dimensions at 3x.
      let image = XCTAttachment(screenshot: screen.screenshot())
      image.name = "calib-screen\(index)"
      image.lifetime = .keepAlways
      add(image)
    }
  }
}
