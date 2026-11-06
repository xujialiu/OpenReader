import UIKit
import XCTest

// Issue #346 D1: deterministic native query+tap coverage for the Player's
// collapse/expand (ReadingButton) and the native More actions drawer at the
// closed pose. Attaches to the RUNNING app (XCUIApplication(bundleIdentifier:);
// never launches). A missing reader is a failed precondition — BLOCKED, not
// relaunch-and-continue. Every tap is asserted by the resulting tree state;
// frames are read synchronously only after an existence assertion.
//
//   bash test/manual-test/kit/run-probe.sh DuoPlayerProbe SIMULATOR_UDID OUT_DIR \
//     -only-testing:DuoPlayerProbe/testCollapseExpandRoundTripClosedPose
final class DuoPlayerProbe: XCTestCase {
  private var app: XCUIApplication {
    XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
  }

  private func shoot(_ name: String) {
    let shot = XCUIScreen.main.screenshot()
    let attachment = XCTAttachment(screenshot: shot)
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  func testCollapseExpandRoundTripClosedPose() throws {
    let play = app.buttons["Play"]
    guard play.waitForExistence(timeout: 8) else {
      XCTFail("PRECONDITION FAILED: reader not open (no Play button); not launching")
      return
    }
    let collapse = app.buttons["Collapse the player"]
    guard collapse.waitForExistence(timeout: 4) else {
      XCTFail("PRECONDITION FAILED: no Collapse-the-player button (already collapsed?)")
      return
    }
    collapse.tap()
    let show = app.buttons["Show the player"]
    XCTAssertTrue(show.waitForExistence(timeout: 8),
                  "the collapsed ReadingButton did not appear after tapping Collapse the player")
    shoot("duo-collapsed-readingbutton")
    XCTAssertFalse(app.buttons["Play"].exists, "transport Play still listed while collapsed")

    guard show.exists else { return }
    show.tap()
    XCTAssertTrue(app.buttons["Collapse the player"].waitForExistence(timeout: 8),
                  "the player did not expand again after tapping Show the player")
    XCTAssertTrue(app.buttons["Play"].exists, "transport Play missing after expanding")
    shoot("duo-expanded-again")
  }

  func testMoreActionsOpensAndClosesDrawerClosedPose() throws {
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
    shoot("duo-more-actions-drawer-open")

    // frame read immediately after the existence assertion; no tap on the
    // grabber first (a grabber tap can move the detent, and a moved detent
    // invalidates the drag derived from the stale frame)
    let frame = grabber.frame
    XCTAssertTrue(frame.width > 1 && frame.height > 1, "grabber frame invalid: \(frame)")
    let s = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    let start = s.withOffset(CGVector(dx: frame.midX, dy: frame.midY))
    let endY = min(frame.maxY + 320, app.frame.maxY - 12)
    start.press(forDuration: 0.12, thenDragTo: s.withOffset(CGVector(dx: frame.midX, dy: endY)))
    XCTAssertFalse(grabber.waitForExistence(timeout: 4),
                   "the drawer stayed open after a grabber drag (grabber frame \(frame))")
    shoot("duo-more-actions-drawer-after")
  }
}
