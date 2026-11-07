import UIKit
import XCTest

// Final verification #349/#359 helper: the More-actions drawer's close
// behaviour at the fully-open inner pose. DuoPlayerProbe's single drag
// (press 0.12 thenDragTo grabber.midY + 320) did not dismiss the drawer in the
// 17:00 run while its OPEN half passed; DuoDrawerProbe documents Expanded
// drawers needing two stages. This probe keeps the gesture separate from the
// app: open with one real tap, then up to three frame-derived downward drags,
// re-reading the grabber frame and detent between stages, each with a
// screen-aware capture (XCUIScreen.main can be the OUTER display while the app
// presents on the inner one). Attaches to the RUNNING app; never launches,
// never taps Play. If three documented drags cannot dismiss an open drawer
// with a valid frame, that is an application finding, not a passed gesture.
//
//   bash test/manual-test/kit/run-probe.sh DuoDrawerCloseProbe \
//     SIMULATOR_UDID OUT_DIR -only-testing:DuoDrawerCloseProbe/testMoreActionsDrawerStagedDismiss \
//     -collect-test-diagnostics never
final class DuoDrawerCloseProbe: XCTestCase {
  private var app: XCUIApplication {
    XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
  }

  /// XCUIScreen.main is the outer display on the Duo (measured 17:00: the
  /// probe's attachments showed 466x678 while the app presented 951x669).
  /// Capture EVERY screen so one attachment always shows the app display.
  private func shoot(_ name: String) {
    for (index, screen) in XCUIScreen.screens.enumerated() {
      let attachment = XCTAttachment(screenshot: screen.screenshot())
      attachment.name = "\(name)-screen\(index)"
      attachment.lifetime = .keepAlways
      add(attachment)
    }
  }

  func testMoreActionsDrawerStagedDismiss() throws {
    let play = app.buttons["Play"]
    guard play.waitForExistence(timeout: 8) else {
      XCTFail("PRECONDITION FAILED: reader not open (no Play button); not launching")
      return
    }
    let more = app.buttons["More actions"]
    guard more.waitForExistence(timeout: 8) else {
      XCTFail("PRECONDITION FAILED: More actions button missing from the toolbar")
      return
    }
    more.tap()
    let grabber = app.buttons["Sheet Grabber"]
    XCTAssertTrue(grabber.waitForExistence(timeout: 8),
                  "the drawer did not open after tapping More actions")
    print("PROBE-DRAWER2 opened detent=\(grabber.value as? String ?? "nil") frame=\(grabber.frame)")
    shoot("drawer2-open")

    let gone = NSPredicate(format: "exists == false")
    print("PROBE-DRAWER2 appFrame=\(app.frame) screens=\(XCUIScreen.screens.count)")
    for stage in 1...3 {
      guard grabber.exists else { break }
      let frame = grabber.frame
      XCTAssertTrue(frame.width > 1 && frame.height > 1,
                    "stage \(stage): grabber frame invalid: \(frame)")
      let detent = grabber.value as? String ?? "nil"
      // The app's frame is portrait-shaped (669x951) while the inner window is
      // landscape (951x669), so app-anchored coordinates misaim on this
      // display (measured 17:12: three app-anchored drags left the drawer
      // frozen). Element frames sit in the correct space — element.tap()
      // delivered — so anchor the drag to the grabber element itself.
      let anchor = grabber.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
      let end = anchor.withOffset(CGVector(dx: 0, dy: 340))
      print("PROBE-DRAWER2 stage \(stage) from=\(frame) detent=\(detent) elementAnchored endOffset=(0,340)")
      anchor.press(forDuration: 0.12, thenDragTo: end)
      let wait = XCTNSPredicateExpectation(predicate: gone, object: grabber)
      let result = XCTWaiter.wait(for: [wait], timeout: 6)
      print("PROBE-DRAWER2 stage \(stage) result=\(result.rawValue) stillExists=\(grabber.exists)")
      shoot("drawer2-after-stage\(stage)")
    }
    XCTAssertFalse(grabber.exists,
                   "the drawer stayed open after three frame-derived grabber drags (last frame \(grabber.frame))")
    print("PROBE-DRAWER2 dismissed true")
    XCTAssertTrue(play.waitForExistence(timeout: 4), "Play missing after the drawer closed")
    shoot("drawer2-closed-clean")
  }
}
