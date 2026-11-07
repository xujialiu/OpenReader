import UIKit
import XCTest

// Final verification #349/#359 helper: dismiss the Debug LogBox banner
// ("Open debugger to view warnings.") over the Player with a real XCTest tap,
// asserting the observable before/after tree state. Attaches to the RUNNING
// app (XCUIApplication(bundleIdentifier:); never launches or restarts). Never
// taps Play. A missing banner is reported, not failed — the banner's presence
// depends on warnings emitted, and this probe only asserts its own dismissal.
//
//   bash test/manual-test/kit/run-probe.sh DuoBannerDismissProbe \
//     SIMULATOR_UDID OUT_DIR -only-testing:DuoBannerDismissProbe/testDismissDebugBanner \
//     -collect-test-diagnostics never
final class DuoBannerDismissProbe: XCTestCase {
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

  private var banner: XCUIElement {
    app.descendants(matching: .any)
      .matching(NSPredicate(format: "label CONTAINS 'Open debugger'")).firstMatch
  }

  // The #335-recorded popover-clear pattern: a press outside the bubble, then
  // assert Slower/Faster are gone, so no overlay is left as a precondition.
  private func clearSpeedPopoverIfAny() {
    let slower = app.buttons["Slower"]
    let faster = app.buttons["Faster"]
    guard slower.exists || faster.exists else {
      print("PROBE-BANNER popover-absent true")
      return
    }
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4)).press(forDuration: 0.15)
    let absent = NSPredicate(format: "exists == false")
    let waits = [XCTNSPredicateExpectation(predicate: absent, object: slower),
                 XCTNSPredicateExpectation(predicate: absent, object: faster)]
    let result = XCTWaiter.wait(for: waits, timeout: 5)
    print("PROBE-BANNER popover-clear \(result == .completed)")
    shoot("banner-probe-popover-cleared")
  }

  func testDismissDebugBanner() throws {
    let play = app.buttons["Play"]
    guard play.waitForExistence(timeout: 8) else {
      XCTFail("PRECONDITION FAILED: reader not open (no Play button); not launching")
      return
    }
    clearSpeedPopoverIfAny()
    guard banner.waitForExistence(timeout: 5) else {
      print("PROBE-BANNER absent true")
      shoot("banner-probe-no-banner")
      return
    }
    let frame = banner.frame
    print("PROBE-BANNER frame \(frame) appFrame=\(app.frame)")
    XCTAssertTrue(frame.width > 40, "banner frame implausible: \(frame)")
    shoot("banner-probe-before")

    // LogBox's close control is not exposed as a labelled Button in the
    // accessibility tree (measured: only a GenericElement with the text).
    // Tap its right-edge circle, derived from the banner's own frame.
    let closeCandidates = [frame.maxX - 12, frame.maxX - 18, frame.maxX - 24]
    let gone = NSPredicate(format: "exists == false")
    for (index, offsetX) in closeCandidates.enumerated() {
      let point = app.coordinate(withNormalizedOffset: .zero)
        .withOffset(CGVector(dx: offsetX, dy: frame.midY))
      point.press(forDuration: 0.1)
      let wait = XCTNSPredicateExpectation(predicate: gone, object: banner)
      let result = XCTWaiter.wait(for: [wait], timeout: 5)
      print("PROBE-BANNER close-tap \(index) x=\(offsetX) result=\(result.rawValue)")
      if result == .completed { break }
    }
    let stillThere = banner.exists
    XCTAssertFalse(stillThere, "the Debug banner stayed after right-edge taps at \(closeCandidates)")
    print("PROBE-BANNER dismissed \(stillThere == false)")
    shoot("banner-probe-after")

    // A through-tap can only have landed on the banner itself; verify no
    // speed popover opened as a side effect and leave clean controls.
    clearSpeedPopoverIfAny()
    XCTAssertTrue(app.buttons["Play"].exists, "transport Play missing after banner dismissal")
  }
}
