import UIKit
import XCTest

// Issue #348 native verification of the expanded Player. Attaches to the
// RUNNING app (XCUIApplication(bundleIdentifier:); never launches). A missing
// reader is a failed precondition — BLOCKED, not relaunch-and-continue. Real
// taps are asserted by the resulting tree state; frames are read only after an
// existence assertion. Every measurement prints a PROBE-348 line for the raw
// record. The Duo-folded methods assert the recorded outer pose; the phone
// methods are pose- and size-independent.
//
//   bash test/manual-test/kit/run-probe.sh DuoPlayer348Probe SIMULATOR_UDID OUT_DIR \
//     -only-testing:DuoPlayer348Probe/testFoldedTwoRowGeometry
final class DuoPlayer348Probe: XCTestCase {
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

  private func playerButton(_ label: String) -> XCUIElement {
    app.buttons[label]
  }

  /// The A/M mark is text, not a button; the rest of the head row are buttons.
  private func playerElement(_ label: String) -> XCUIElement {
    let button = app.buttons[label]
    if button.exists { return button }
    let text = app.staticTexts[label]
    if text.exists { return text }
    return app.otherElements[label]
  }

  private func require(_ label: String, timeout: TimeInterval = 8, message: String) -> XCUIElement {
    let element = playerButton(label)
    guard element.waitForExistence(timeout: timeout) else {
      XCTFail("PRECONDITION FAILED: \(message) (no \(label))")
      return element
    }
    return element
  }

  private func speedTrigger() -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Playback speed, '")).firstMatch
  }

  /// The seven transport targets' frames, left-to-right.
  private func transportFrames() -> [(label: String, frame: CGRect)] {
    let labels = ["Contents", "Previous paragraph", "Previous sentence", "Play",
                  "Next sentence", "Next paragraph"]
    var frames = labels.map { (label: $0, frame: playerButton($0).frame) }
    let speed = speedTrigger()
    if speed.exists {
      frames.append((label: "Playback speed", frame: speed.frame))
    } else {
      XCTFail("PRECONDITION FAILED: Playback speed trigger missing")
    }
    return frames
  }

  private func assertNoNote(_ context: String) {
    let note = app.staticTexts.matching(NSPredicate(
      format: "label CONTAINS 'No provider is enabled' OR label CONTAINS 'is disabled.' "
        + "OR label CONTAINS 'needs an API key' OR label CONTAINS 'needs a model'")).firstMatch
    XCTAssertFalse(note.exists, "\(context): a readiness/error note is showing above the controls")
  }

  /// The compact transport is one row: seven targets, six gaps of at least
  /// 3 points, no overlap, Play 52 points and centred on the row.
  private func assertCompactTransport(_ context: String) {
    let frames = transportFrames()
    for (label, frame) in frames {
      print("PROBE-348 \(context) transport \(label) \(frame)")
    }
    let sorted = frames.sorted { $0.frame.minX < $1.frame.minX }
    XCTAssertEqual(sorted.count, 7, "\(context): transport target count \(sorted.count) != 7")
    for pair in zip(sorted, sorted.dropFirst()) {
      let gap = pair.1.frame.minX - pair.0.frame.maxX
      print("PROBE-348 \(context) gap \(pair.0.label)->\(pair.1.label) \(gap)")
      XCTAssertGreaterThanOrEqual(gap, 2.5, "\(context): gap \(pair.0.label)->\(pair.1.label) below 3 points")
      XCTAssertLessThanOrEqual(gap, 120, "\(context): gap \(pair.0.label)->\(pair.1.label) too wide for one row")
    }
    let play = playerButton("Play")
    XCTAssertEqual(play.frame.width, 52, accuracy: 1.0, "\(context): Play width \(play.frame.width)")
    let rowMid = (sorted.first!.frame.minX + sorted.last!.frame.maxX) / 2
    XCTAssertEqual(play.frame.midX, rowMid, accuracy: 1.0,
                   "\(context): Play not centred on the transport row")
    for (label, frame) in sorted where label != "Playback speed" && label != "Play" {
      XCTAssertGreaterThanOrEqual(min(frame.width, frame.height), 44,
                                  "\(context): \(label) touch frame below 44 points: \(frame)")
    }
  }

  /// The head row is one band holding the A/M mark, the Tap Lock, the Voice,
  /// the Sleep Timer and the collapse arrow; the Voice centred on Play.
  private func assertHeadRow(_ context: String) {
    let head = ["Following the reading", "Lock Taps", "Choose a Voice", "Sleep Timer", "Collapse the player"]
      .map { (label: $0, element: playerElement($0)) }
    for (label, element) in head {
      guard element.waitForExistence(timeout: 8) else {
        return XCTFail("PRECONDITION FAILED: head row missing \(label)")
      }
      print("PROBE-348 \(context) head \(label) \(element.frame)")
    }
    let headBand = head[0].element.frame.minY
    for (label, element) in head {
      XCTAssertEqual(element.frame.minY, headBand, accuracy: 1.5,
                     "\(context): \(label) is not on the head row band (head \(headBand), frame \(element.frame))")
    }
    let voice = playerButton("Choose a Voice")
    let play = playerButton("Play")
    XCTAssertEqual(voice.frame.midX, play.frame.midX, accuracy: 1.0,
                   "\(context): Voice not centred on the card")
  }

  // MARK: Duo folded outer pose (window 466x678, right inset 84, usable 382)

  func testFoldedTwoRowGeometry() throws {
    _ = require("Play", message: "reader not open")
    assertHeadRow("folded")
    assertCompactTransport("folded")
    let play = playerButton("Play")
    XCTAssertGreaterThan(play.frame.minY, playerElement("Following the reading").frame.minY + 20,
                         "transport row not below the head row")
    assertNoNote("folded")
    print("PROBE-348 folded window \(app.frame)")
    shoot("duo-folded-two-rows")
  }

  // MARK: Pose-independent checks for ordinary phones and the tablet

  func testPhoneTwoRowGeometry() throws {
    _ = require("Play", message: "reader not open")
    assertHeadRow("phone")
    assertCompactTransport("phone")
    assertNoNote("phone")
    print("PROBE-348 phone window \(app.frame)")
    shoot("phone-two-rows")
  }

  // MARK: Real taps on the drawers and the popover

  func testContentsDrawerRoundTrip() throws {
    _ = require("Play", message: "reader not open")
    let contents = require("Contents", message: "Contents missing")
    contents.tap()
    let grabber = app.buttons["Sheet Grabber"]
    XCTAssertTrue(grabber.waitForExistence(timeout: 8), "the Contents sheet did not open")
    shoot("contents-open")
    let frame = grabber.frame
    XCTAssertTrue(frame.width > 1 && frame.height > 1, "grabber frame invalid: \(frame)")
    let s = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    let start = s.withOffset(CGVector(dx: frame.midX, dy: frame.midY))
    let endY = min(frame.maxY + 320, app.frame.maxY - 12)
    start.press(forDuration: 0.12, thenDragTo: s.withOffset(CGVector(dx: frame.midX, dy: endY)))
    XCTAssertFalse(grabber.waitForExistence(timeout: 4), "the Contents sheet stayed open after the grabber drag")
    shoot("contents-closed")
  }

  func testVoiceSheetRoundTrip() throws {
    _ = require("Play", message: "reader not open")
    let voice = require("Choose a Voice", message: "Voice trigger missing")
    voice.tap()
    let grabber = app.buttons["Sheet Grabber"]
    XCTAssertTrue(grabber.waitForExistence(timeout: 8), "the Voice sheet did not open")
    shoot("voice-open")
    let frame = grabber.frame
    let s = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    let start = s.withOffset(CGVector(dx: frame.midX, dy: frame.midY))
    let endY = min(frame.maxY + 320, app.frame.maxY - 12)
    start.press(forDuration: 0.12, thenDragTo: s.withOffset(CGVector(dx: frame.midX, dy: endY)))
    XCTAssertFalse(grabber.waitForExistence(timeout: 4), "the Voice sheet stayed open after the grabber drag")
    XCTAssertTrue(playerButton("Choose a Voice").waitForExistence(timeout: 8),
                  "the Voice trigger did not come back after closing the sheet")
  }

  /// The popover can cover the Collapse button itself. A successful rate test
  /// must not leave that overlay as an invisible precondition for the next test.
  @discardableResult
  private func dismissSpeed() -> Bool {
    let slower = app.buttons["Slower"]
    let faster = app.buttons["Faster"]
    if slower.exists || faster.exists {
      app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4)).press(forDuration: 0.15)
      let absent = NSPredicate(format: "exists == false")
      let waits = [XCTNSPredicateExpectation(predicate: absent, object: slower),
                   XCTNSPredicateExpectation(predicate: absent, object: faster)]
      guard XCTWaiter.wait(for: waits, timeout: 5) == .completed else {
        shoot("speed-popover-dismiss-precondition-failed")
        XCTFail("PRECONDITION FAILED: speed popover still covers Player controls")
        return false
      }
    }
    print("PROBE-348 popover-gone true")
    return true
  }

  func testSpeedPopoverRoundTrip() throws {
    _ = require("Play", message: "reader not open")
    guard dismissSpeed() else { return }
    let speed = speedTrigger()
    guard speed.waitForExistence(timeout: 8) else {
      return XCTFail("PRECONDITION FAILED: speed trigger missing")
    }
    speed.tap()
    let slower = app.buttons["Slower"]
    XCTAssertTrue(slower.waitForExistence(timeout: 8), "the speed popover did not open")
    slower.tap()
    let afterSlower = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Playback speed, 1.'")).firstMatch
    XCTAssertTrue(afterSlower.waitForExistence(timeout: 6), "speed trigger label missing after Slower")
    print("PROBE-348 rate after-slower=\(afterSlower.label)")
    XCTAssertFalse(afterSlower.label.hasSuffix("1.50 times"), "Slower did not change the rate")
    let faster = app.buttons["Faster"]
    guard faster.waitForExistence(timeout: 4) else {
      return XCTFail("popover closed after Slower; cannot restore")
    }
    faster.tap()
    let afterFaster = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Playback speed, 1.'")).firstMatch
    XCTAssertTrue(afterFaster.waitForExistence(timeout: 6), "speed trigger label missing after Faster")
    print("PROBE-348 rate after-faster=\(afterFaster.label)")
    XCTAssertTrue(afterFaster.label.hasSuffix("1.50 times"), "rate not restored: \(afterFaster.label)")
    XCTAssertTrue(dismissSpeed())
    shoot("speed-restored")
  }

  func testCollapseShowRoundTripFolded() throws {
    guard dismissSpeed() else { return }
    _ = require("Play", message: "reader not open")
    let collapse = require("Collapse the player", message: "already collapsed?")
    collapse.tap()
    let show = app.buttons["Show the player"]
    XCTAssertTrue(show.waitForExistence(timeout: 8), "the collapsed ReadingButton did not appear")
    print("PROBE-348 collapsed \(show.frame) window=\(app.frame)")
    shoot("collapsed")
    XCTAssertFalse(app.buttons["Play"].exists, "transport Play still listed while collapsed")
    show.tap()
    XCTAssertTrue(app.buttons["Collapse the player"].waitForExistence(timeout: 8), "the player did not expand again")
    XCTAssertTrue(app.buttons["Play"].exists, "transport Play missing after expanding")
    shoot("expanded")
  }

  // MARK: Sleep Timer menu

  /// Maps the speed trigger's real tap-response edges around its AX frame:
  /// inside-bottom (maxY-1), below-bottom (+1), further below (+4) and above
  /// top (-1). Each result is printed; only the inside tap is asserted.
  func testSpeedTriggerEdgeMap() throws {
    _ = require("Play", message: "reader not open")
    guard dismissSpeed() else { return }
    let speed = speedTrigger()
    guard speed.waitForExistence(timeout: 8) else {
      return XCTFail("PRECONDITION FAILED: speed trigger missing")
    }
    let frame = speed.frame
    print("PROBE-348 speed-ax-frame \(frame)")
    let coordinate = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    func probeTap(_ dy: CGFloat, _ name: String) -> Bool {
      guard dismissSpeed() else { return false }
      let point = coordinate.withOffset(CGVector(dx: frame.midX, dy: dy))
      point.tap()
      let opened = app.buttons["Slower"].waitForExistence(timeout: 5)
      print("PROBE-348 speed-edge \(name) dy=\(dy) opened=\(opened)")
      return opened
    }
    let inside = probeTap(frame.maxY - 1, "inside-bottom")
    XCTAssertTrue(inside, "a tap 1pt INSIDE the AX frame did not open the popover")
    _ = probeTap(frame.maxY + 1, "below-1")
    _ = probeTap(frame.maxY + 4, "below-4")
    _ = probeTap(frame.minY - 1, "above-1")
    XCTAssertTrue(dismissSpeed())
  }

  /// Parent-audit correction (2026-11-07): the a5 map tested only AXtop-1 and
  /// AXbottom+1, which under a centred-44 hypothesis (AXtop-0.833..AXbottom+0.833)
  /// fall just OUTSIDE the target — it brackets the height only below 44.33.
  /// This map samples the 3x pixel grid at AXtop-2/3, AXtop-4/3, AXbottom+2/3,
  /// AXbottom+4/3 and an inside control, with the discriminators repeated, to
  /// separate the 42.33 AX frame from a 44.0 target. Frames are read live; all
  /// taps are at the frame's midX.
  func testSpeedTriggerFineEdgeMap() throws {
    _ = require("Play", message: "reader not open")
    guard dismissSpeed() else { return }
    let speed = speedTrigger()
    guard speed.waitForExistence(timeout: 8) else {
      return XCTFail("PRECONDITION FAILED: speed trigger missing")
    }
    let frame = speed.frame
    print("PROBE-348 fine speed-ax-frame \(frame)")
    let coordinate = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    func probeTap(_ dy: CGFloat, _ name: String) -> Bool {
      guard dismissSpeed() else { return false }
      let point = coordinate.withOffset(CGVector(dx: frame.midX, dy: dy))
      point.tap()
      let opened = app.buttons["Slower"].waitForExistence(timeout: 5)
      print("PROBE-348 fine \(name) dy=\(dy) opened=\(opened)")
      return opened
    }
    let inside = probeTap(frame.maxY - 2.0, "inside-control")
    XCTAssertTrue(inside, "inside control (maxY-2) did not open; map invalid")
    let belowTwoThirds = probeTap(frame.maxY + 2.0 / 3.0, "below+2/3")
    let aboveTwoThirds = probeTap(frame.minY - 2.0 / 3.0, "above-2/3")
    let belowFourThirds = probeTap(frame.maxY + 4.0 / 3.0, "below+4/3")
    let aboveFourThirds = probeTap(frame.minY - 4.0 / 3.0, "above-4/3")
    let belowRep = probeTap(frame.maxY + 2.0 / 3.0, "below+2/3-rep")
    let aboveRep = probeTap(frame.minY - 2.0 / 3.0, "above-2/3-rep")
    let insideRep = probeTap(frame.maxY - 2.0, "inside-control-rep")
    print("PROBE-348 fine summary inside=\(inside) below+2/3=\(belowTwoThirds) above-2/3=\(aboveTwoThirds) "
          + "below+4/3=\(belowFourThirds) above-4/3=\(aboveFourThirds) reps below=\(belowRep) above=\(aboveRep) inside=\(insideRep)")
    XCTAssertTrue(dismissSpeed())
  }

  /// The reusable minimum-touch contract for the speed trigger (RED on
  /// 1.0.4 (30)-beta16 by design, per the parent's checkpoint): (1) the
  /// accessible/target frame itself must be at least 44 points in both
  /// dimensions — a frame-size check, distinct from any tap; (2) real taps
  /// one 3x physical pixel (1/3 pt) inside BOTH edges of the centred
  /// 44-point span about the frame centre must open the popover, each after
  /// a verified dismissal, with a mid-control positive check. Do not weaken
  /// these to match the measured 42.33 frame.
  func testSpeedTriggerMinimumTouchRegion() throws {
    _ = require("Play", message: "reader not open")
    guard dismissSpeed() else { return }
    let speed = speedTrigger()
    guard speed.waitForExistence(timeout: 8) else {
      return XCTFail("PRECONDITION FAILED: speed trigger missing")
    }
    let frame = speed.frame
    print("PROBE-348 min-region ax-frame \(frame)")
    XCTAssertGreaterThanOrEqual(min(frame.width, frame.height), 44,
        "AX check: speed trigger accessible frame \(frame) is below the 44-point minimum "
      + "touch target (RED expected on beta16: the activator measured <=43.67 high)")
    let centre = frame.midY
    let pixel = 1.0 / 3.0
    let coordinate = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    func tapOpens(_ dy: CGFloat, _ name: String) -> Bool {
      guard dismissSpeed() else { return false }
      coordinate.withOffset(CGVector(dx: frame.midX, dy: dy)).tap()
      let opened = app.buttons["Slower"].waitForExistence(timeout: 5)
      print("PROBE-348 min-region \(name) dy=\(dy) opened=\(opened)")
      return opened
    }
    let mid = tapOpens(centre, "mid-control")
    XCTAssertTrue(mid, "positive control: a tap at the frame centre did not open the popover; the map is invalid")
    let topEdge = tapOpens(centre - 22 + pixel, "top-edge-centred44")
    XCTAssertTrue(topEdge,
        "Tap check: a real tap at \(centre - 22 + pixel) (one 3x pixel inside the top edge of the "
      + "centred 44-point region) did not open the popover — the actual touch target does not reach it")
    let bottomEdge = tapOpens(centre + 22 - pixel, "bottom-edge-centred44")
    XCTAssertTrue(bottomEdge,
        "Tap check: a real tap at \(centre + 22 - pixel) (one 3x pixel inside the bottom edge of the "
      + "centred 44-point region) did not open the popover — the actual touch target does not reach it")
    XCTAssertTrue(dismissSpeed())
  }

  /// Chooses 5 Minutes through the SwiftUI menu and reports the countdown
  /// label. Leaves the timer RUNNING; the fold continuity check needs it.
  func testSleepTimerChooseFiveMinutes() throws {
    _ = require("Play", message: "reader not open")
    let sleep = require("Sleep Timer", message: "Sleep Timer missing")
    sleep.tap()
    let five = app.buttons["5 Minutes"]
    XCTAssertTrue(five.waitForExistence(timeout: 8), "the Sleep Timer menu did not open with 5 Minutes")
    five.tap()
    let counting = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Sleep Timer, '")).firstMatch
    XCTAssertTrue(counting.waitForExistence(timeout: 8), "the Sleep Timer label did not start counting")
    print("PROBE-348 sleep \(counting.label)")
    XCTAssertTrue(counting.label.hasSuffix("left"), "unexpected sleep label \(counting.label)")
  }

  func testSleepTimerTurnOff() throws {
    _ = require("Play", message: "reader not open")
    let counting = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Sleep Timer, '")).firstMatch
    guard counting.waitForExistence(timeout: 6) else {
      print("PROBE-348 sleep already-off true")
      return
    }
    counting.tap()
    let off = app.buttons["Turn Off Timer"]
    XCTAssertTrue(off.waitForExistence(timeout: 8), "the menu did not offer Turn Off Timer")
    off.tap()
    let plain = require("Sleep Timer", message: "Sleep Timer label did not return to Off")
    print("PROBE-348 sleep off \(plain.label)")
  }

  // MARK: Skips and the page while paused (the playing state is asserted
  // outside through the harness, which this probe never touches)

  func testNextSentenceTapWhilePaused() throws {
    _ = require("Play", message: "reader not open")
    guard dismissSpeed() else { return }
    let next = require("Next sentence", message: "Next sentence missing")
    next.tap()
    print("PROBE-348 tapped next-sentence true")
  }

  func testPreviousSentenceTapWhilePaused() throws {
    _ = require("Play", message: "reader not open")
    guard dismissSpeed() else { return }
    let previous = require("Previous sentence", message: "Previous sentence missing")
    previous.tap()
    print("PROBE-348 tapped previous-sentence true")
  }

  func testTapLockRoundTrip() throws {
    _ = require("Play", message: "reader not open")
    guard dismissSpeed() else { return }
    let lock = require("Lock Taps", message: "Lock Taps missing")
    lock.tap()
    let unlock = app.buttons["Unlock Taps"]
    XCTAssertTrue(unlock.waitForExistence(timeout: 8), "the label did not become Unlock Taps")
    print("PROBE-348 lock on \(unlock.frame)")
    unlock.tap()
    let lockAgain = app.buttons["Lock Taps"]
    XCTAssertTrue(lockAgain.waitForExistence(timeout: 8), "the label did not return to Lock Taps")
    print("PROBE-348 lock off \(lockAgain.frame)")
  }

  /// Leaves Tap Lock ON for the fold-continuity choreography.
  func testTapLockOn() throws {
    _ = require("Play", message: "reader not open")
    guard dismissSpeed() else { return }
    if app.buttons["Unlock Taps"].exists {
      print("PROBE-348 lock already-on true")
      return
    }
    let lock = require("Lock Taps", message: "Lock Taps missing")
    lock.tap()
    let unlock = app.buttons["Unlock Taps"]
    XCTAssertTrue(unlock.waitForExistence(timeout: 8), "the label did not become Unlock Taps")
    print("PROBE-348 lock on \(unlock.frame)")
  }

  /// The a8 sequence in one run with internal state assertions: lock on,
  /// sleep 5 Minutes via the menu, Turn Off via the menu, then the lock must
  /// still be on. Distinguishes a menu-cycle disturbance from a
  /// double-delivered unlock tap.
  func testSleepMenuCycleKeepsLockState() throws {
    _ = require("Play", message: "reader not open")
    let lock = require("Lock Taps", message: "Tap Lock is already on")
    lock.tap()
    let unlock = app.buttons["Unlock Taps"]
    XCTAssertTrue(unlock.waitForExistence(timeout: 8), "lock on failed")
    print("PROBE-348 seq lock on")
    let sleep = require("Sleep Timer", message: "Sleep Timer missing")
    sleep.tap()
    let five = app.buttons["5 Minutes"]
    XCTAssertTrue(five.waitForExistence(timeout: 8), "menu did not open")
    five.tap()
    let counting = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Sleep Timer, '")).firstMatch
    XCTAssertTrue(counting.waitForExistence(timeout: 8), "sleep did not start")
    print("PROBE-348 seq sleep on")
    counting.tap()
    let off = app.buttons["Turn Off Timer"]
    XCTAssertTrue(off.waitForExistence(timeout: 8), "no Turn Off Timer")
    off.tap()
    let plain = require("Sleep Timer", message: "sleep did not turn off")
    print("PROBE-348 seq sleep off \(plain.label)")
    XCTAssertTrue(app.buttons["Unlock Taps"].waitForExistence(timeout: 8),
                  "the sleep menu cycle changed the Tap Lock state")
    print("PROBE-348 seq lock still on")
    unlock.tap()
    XCTAssertTrue(app.buttons["Lock Taps"].waitForExistence(timeout: 8), "unlock failed")
    print("PROBE-348 seq lock off")
  }

  /// A real page tap while Tap Lock is ON. The reading position is read
  /// through the harness outside this probe; the tap itself is what this
  /// delivers.
  func testLockedPageTap() throws {
    let unlock = app.buttons["Unlock Taps"]
    guard unlock.waitForExistence(timeout: 8) else {
      return XCTFail("PRECONDITION FAILED: Tap Lock is not on (no Unlock Taps)")
    }
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4)).press(forDuration: 0.15)
    print("PROBE-348 locked-page-tap delivered true")
  }

  func testUnlockTaps() throws {
    let unlock = app.buttons["Unlock Taps"]
    guard unlock.waitForExistence(timeout: 8) else {
      return XCTFail("PRECONDITION FAILED: Tap Lock is not on (no Unlock Taps)")
    }
    unlock.tap()
    let lockAgain = app.buttons["Lock Taps"]
    XCTAssertTrue(lockAgain.waitForExistence(timeout: 8), "the label did not return to Lock Taps")
    print("PROBE-348 unlocked true")
  }

  /// A real page tap while UNLOCKED and paused: the reading position should
  /// move (asserted through the harness outside).
  func testUnlockedPageTap() throws {
    let lock = app.buttons["Lock Taps"]
    guard lock.waitForExistence(timeout: 8) else {
      return XCTFail("PRECONDITION FAILED: Tap Lock is off or labels unexpected (no Lock Taps button)")
    }
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4)).press(forDuration: 0.15)
    print("PROBE-348 unlocked-page-tap delivered true")
  }
}
