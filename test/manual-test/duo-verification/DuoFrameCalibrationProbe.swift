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
