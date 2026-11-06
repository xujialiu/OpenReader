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

  func testSpeedPopoverInnerNoSideInset() throws {
    let play = app.buttons["Play"]
    guard play.waitForExistence(timeout: 8) else {
      XCTFail("PRECONDITION FAILED: reader not open (no Play button); not launching")
      return
    }
    let speed = app.buttons["Playback speed, 1.50 times"]
    guard speed.waitForExistence(timeout: 8) else {
      XCTFail("PRECONDITION FAILED: speed trigger not at 1.50 (label mismatch)")
      return
    }
    speed.tap()
    let slower = app.buttons["Slower"]
    XCTAssertTrue(slower.waitForExistence(timeout: 8), "popover did not open at the inner pose")
    let faster = app.buttons["Faster"]
    XCTAssertTrue(faster.exists, "Faster missing while popover open")
    let bubble = app.groups["Playback speed"]
    let frame = bubble.exists ? bubble.frame : slower.frame.union(faster.frame).insetBy(dx: -14, dy: -12)
    print("PROBE-POPOVER-FRAME \(frame) window=\(app.frame)")
    if let dir = ProcessInfo.processInfo.environment["DUO_SHOT_DIR"] {
      let shot = XCUIScreen.main.screenshot()
      try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir + "/speed-popover-inner128-runner.png"))
    }
    slower.tap()
    let afterSlower = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Playback speed, 1.'")).firstMatch
    XCTAssertTrue(afterSlower.waitForExistence(timeout: 6), "speed trigger label missing after Slower")
    print("PROBE-RATE after-slower=\(afterSlower.label)")
    let fasterAgain = app.buttons["Faster"]
    guard fasterAgain.waitForExistence(timeout: 4) else {
      XCTFail("popover closed after Slower; cannot restore")
      return
    }
    fasterAgain.tap()
    let afterFaster = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Playback speed, 1.'")).firstMatch
    XCTAssertTrue(afterFaster.waitForExistence(timeout: 6), "speed trigger label missing after Faster")
    print("PROBE-RATE after-faster=\(afterFaster.label)")
    XCTAssertTrue(afterFaster.label.hasSuffix("1.50 times"), "rate not restored: \(afterFaster.label)")
    // dismiss by tapping outside the bubble (nav bar title area)
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.04)).tap()
    let gone = !app.buttons["Slower"].waitForExistence(timeout: 4)
    print("PROBE-POPOVER-DISMISSED \(gone)")
  }

  func testCollapseExpandInnerNoSideInset() throws {
    let play = app.buttons["Play"]
    guard play.waitForExistence(timeout: 8) else {
      XCTFail("PRECONDITION FAILED: reader not open (no Play button); not launching")
      return
    }
    let collapse = app.buttons["Collapse the player"]
    guard collapse.waitForExistence(timeout: 6) else {
      XCTFail("PRECONDITION FAILED: no Collapse button (already collapsed?)")
      return
    }
    collapse.tap()
    let show = app.buttons["Show the player"]
    XCTAssertTrue(show.waitForExistence(timeout: 8), "collapsed ReadingButton did not appear at the inner pose")
    print("PROBE-COLLAPSE-FRAME \(show.frame) window=\(app.frame)")
    show.tap()
    XCTAssertTrue(app.buttons["Collapse the player"].waitForExistence(timeout: 8), "player did not expand again")
  }

  func testSpeedPopoverLeaveOpenForFold() throws {
    let play = app.buttons["Play"]
    guard play.waitForExistence(timeout: 8) else {
      XCTFail("PRECONDITION FAILED: reader not open (no Play button); not launching")
      return
    }
    let speed = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Playback speed, 1.'")).firstMatch
    guard speed.waitForExistence(timeout: 8) else {
      XCTFail("PRECONDITION FAILED: speed trigger missing")
      return
    }
    speed.tap()
    let slower = app.buttons["Slower"]
    XCTAssertTrue(slower.waitForExistence(timeout: 8), "popover did not open (leave-open run)")
    let bubble = app.groups["Playback speed"]
    print("PROBE-POPOVER-OPEN-LEFT frame=\(bubble.exists ? bubble.frame : .zero)")
  }

  func testDismissPopoverThenCollapseExpandInner() throws {
    let play = app.buttons["Play"]
    guard play.waitForExistence(timeout: 8) else {
      XCTFail("PRECONDITION FAILED: reader not open (no Play button); not launching")
      return
    }
    // a popover left open by a previous run covers the head row; dismiss it first
    if app.buttons["Slower"].exists {
      let speed = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Playback speed, 1.'")).firstMatch
      if speed.exists { speed.tap() }
      if app.buttons["Slower"].waitForExistence(timeout: 3) {
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.04)).tap()
      }
      if app.buttons["Slower"].waitForExistence(timeout: 3) {
        speed.tap() // third path: the anchor toggle
      }
      XCTAssertTrue(!app.buttons["Slower"].exists, "could not dismiss the open popover")
      print("PROBE-POPOVER-DISMISSED-BEFORE-COLLAPSE true")
    }
    let collapse = app.buttons["Collapse the player"]
    guard collapse.waitForExistence(timeout: 6) else {
      XCTFail("PRECONDITION FAILED: no Collapse button (already collapsed?)")
      return
    }
    collapse.tap()
    let show = app.buttons["Show the player"]
    XCTAssertTrue(show.waitForExistence(timeout: 8), "collapsed ReadingButton did not appear")
    print("PROBE-COLLAPSE-FRAME \(show.frame) window=\(app.frame)")
    show.tap()
    XCTAssertTrue(app.buttons["Collapse the player"].waitForExistence(timeout: 8), "player did not expand again")
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
