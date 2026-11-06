import UIKit
import XCTest

// Issue #346 checkpoint B/C: deterministic native query+tap coverage for the
// reader's drawers on the owned iPhone Duo. Attaches to the RUNNING app
// (XCUIApplication(bundleIdentifier:); no launch()) so app and drawer state
// survive between methods of one invocation. Every tap is followed by an
// assertion of the resulting state in the accessibility tree — a delivered
// touch alone is never evidence. Full-screen captures (XCUIScreen.main) are
// attached at the registered moments (no-drawer, just-open, page states) for
// the off-line undimming and geometry comparisons.
//
//   bash test/manual-test/kit/run-probe.sh DuoDrawerProbe SIMULATOR_UDID OUT_DIR \
//     -only-testing:DuoDrawerProbe/testOpenContentsOuter
//
// Requires: the reader open on the fixture (Play button present), Debug Mode,
// and the simulator's volume already zero (run-probe.sh enforces it).
final class DuoDrawerProbe: XCTestCase {
  private var app: XCUIApplication {
    XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
  }

  private func waitElement(_ element: XCUIElement, timeout: Double = 8) -> Bool {
    element.waitForExistence(timeout: timeout)
  }

  private func ensureReaderOpen() {
    if waitElement(app.buttons["Play"], timeout: 6) { return }
    // one fallback: the runner may have to bring the app up itself
    app.launch()
    XCTAssertTrue(waitElement(app.buttons["Play"], timeout: 20),
                  "Play button not found even after the runner launched the app")
  }

  private func shoot(_ name: String) {
    let shot = XCUIScreen.main.screenshot()
    let attachment = XCTAttachment(screenshot: shot)
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
    if let dir = ProcessInfo.processInfo.environment["DUO_SHOT_DIR"] {
      try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir + "/" + name + ".png"))
    }
  }

  private func drag(fromX: CGFloat, fromY: CGFloat, toX: CGFloat, toY: CGFloat) {
    let s = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    let start = s.withOffset(CGVector(dx: fromX, dy: fromY))
    let end = s.withOffset(CGVector(dx: toX, dy: toY))
    start.press(forDuration: 0.12, thenDragTo: end)
  }

  private func assertDrawerOpen(_ tc: String) -> Bool {
    let ok = waitElement(app.buttons["Sheet Grabber"], timeout: 8)
    XCTAssertTrue(ok, "\(tc): Sheet Grabber not in the tree after the action")
    shoot(tc + "-drawer-open")
    return ok
  }

  private func grabber_xy(_ then: @escaping (CGFloat, CGFloat) -> Void) {
    let g = app.buttons["Sheet Grabber"]
    DispatchQueue.main.async {
      let f = g.frame
      then(f.midX, f.midY)
    }
    sleep(1)
  }

  private func assertDrawerGone(_ tc: String) {
    var gone = false
    for _ in 1...6 {
      if !app.buttons["Sheet Grabber"].exists { gone = true; break }
      sleep(1)
    }
    XCTAssertTrue(gone, "\(tc): Sheet Grabber still present after close")
    shoot(tc + "-drawer-closed")
  }

  // ---- Contents drawer at the current pose -----------------------------------
  func testOpenContentsCurrentPose() {
    ensureReaderOpen()
    shoot("no-drawer-before")
    app.buttons["Contents"].firstMatch.tap()
    XCTAssertTrue(assertDrawerOpen("contents"))
    XCTAssertTrue(waitElement(app.buttons["The First Chapter"]), "Contents row 'The First Chapter' missing")
    XCTAssertTrue(app.buttons["The Second Chapter"].exists, "Contents row 'The Second Chapter' missing")
    // leave the drawer open when asked via the environment (pose-change continuity)
    if ProcessInfo.processInfo.environment["DUO_LEAVE_DRAWER"] == "1" {
      print("PROBE-DRAWER-LEFT-OPEN contents")
      return
    }
    drag(fromX: 190, fromY: 430, toX: 190, toY: 650)
    assertDrawerGone("contents")
  }

  // ---- More actions -> Appearance page, stepper round trip, close ------------
  func testAppearancePageAndStepper() {
    XCTAssertTrue(waitElement(app.buttons["More actions"]), "More actions button not found")
    app.buttons["More actions"].firstMatch.tap()
    XCTAssertTrue(assertDrawerOpen("more-actions"))
    XCTAssertTrue(waitElement(app.buttons["Appearance"]), "Appearance row missing on the menu page")
    app.buttons["Appearance"].firstMatch.tap()
    XCTAssertTrue(waitElement(app.buttons["Back from Appearance"], timeout: 8),
                  "Back from Appearance missing — the Appearance page did not open")
    shoot("appearance-page-open")
    XCTAssertTrue(app.buttons["Increase font size"].exists, "Increase font size stepper missing")
    XCTAssertTrue(app.buttons["Decrease font size"].exists, "Decrease font size stepper missing")
    // stepper value: a StaticText named with the current number
    func valueLabel() -> String? {
      for n in 12...32 where app.staticTexts["\(n)"].exists { return "\(n)" }
      return nil
    }
    let before = valueLabel()
    XCTAssertTrue(before != nil, "Font Size value label not found")
    print("PROBE-STEPPER before=\(before!)")
    app.buttons["Increase font size"].firstMatch.tap()
    sleep(1)
    let up = valueLabel()
    XCTAssertTrue(up != nil && up != before, "Increase font size did not change the visible value (\(before!) -> \(up ?? "nil"))")
    print("PROBE-STEPPER after-increase=\(up!)")
    app.buttons["Decrease font size"].firstMatch.tap()
    sleep(1)
    let down = valueLabel()
    XCTAssertTrue(down == before, "Decrease font size did not restore \(before!) (got \(down ?? "nil"))")
    print("PROBE-STEPPER after-decrease=\(down!)")
    // Back inside the drawer is navigation, not dismissal
    app.buttons["Back from Appearance"].firstMatch.tap()
    XCTAssertTrue(waitElement(app.buttons["Appearance"]), "Back from Appearance did not return to the menu page")
    // dismissal by the grabber drag
    grabberDragDismiss("appearance")
  }

  private func grabberDragDismiss(_ tag: String) {
    let g = app.buttons["Sheet Grabber"]
    XCTAssertTrue(waitElement(g, timeout: 6), "\(tag): grabber missing before dismiss")
    let frame = g.frame
    drag(fromX: frame.midX, fromY: frame.midY, toX: frame.midX, toY: frame.maxY + 320)
    assertDrawerGone(tag + "-dismiss")
  }

  // ---- one native expand then dismiss on the Contents drawer -----------------
  func testContentsExpandDismiss() {
    XCTAssertTrue(waitElement(app.buttons["Contents"]), "Contents button not found")
    app.buttons["Contents"].firstMatch.tap()
    XCTAssertTrue(assertDrawerOpen("contents-expand"))
    let g = app.buttons["Sheet Grabber"]
    let frame = g.frame
    drag(fromX: frame.midX, fromY: frame.midY, toX: frame.midX, toY: max(40, frame.minY - 260))
    sleep(1)
    let expanded = g.value as? String == "Expanded" || app.staticTexts["Expanded"].exists
    shoot("contents-expanded")
    XCTAssertTrue(expanded, "Contents drawer did not reach the Expanded detent after the drag")
    // re-read the grabber frame: after expanding it sits higher than before.
    // An Expanded drawer needs two stages: one drag collapses to Half screen,
    // a second drag from the moved grabber dismisses.
    let grown = g.frame
    drag(fromX: grown.midX, fromY: grown.midY, toX: grown.midX, toY: grown.maxY + 320)
    sleep(1)
    grabber_xy { gx, gy in
        self.drag(fromX: gx, fromY: gy, toX: gx, toY: gy + 380)
    }
    assertDrawerGone("contents-expand-dismiss")
  }

  // ---- drawer state read after an external pose change (no tap here) ---------
  func testDrawerStateAfterPoseChange() {
    let grabber = app.buttons["Sheet Grabber"]
    let present = grabber.exists
    print("PROBE-DRAWER-AFTER-FOLD present=\(present) value=\(grabber.value as? String ?? "nil")")
    shoot("after-pose-change")
    if present {
      XCTAssertTrue(waitElement(app.buttons["The First Chapter"], timeout: 4),
                    "drawer open after fold but Contents rows missing")
      // close it for the hand-over unless asked to keep it
      if ProcessInfo.processInfo.environment["DUO_LEAVE_DRAWER"] != "1" {
        let frame = grabber.frame
        drag(fromX: frame.midX, fromY: frame.midY, toX: frame.midX, toY: frame.maxY + 320)
        assertDrawerGone("after-fold")
      }
    } else {
      XCTFail("drawer did not survive the fold (no Sheet Grabber in the tree)")
    }
  }
}
