import UIKit
import XCTest

// Final verification #349/#359 helper: the ordinary phone's portrait policy.
// Sets XCUIDevice's landscape orientation (the real system action on an
// ordinary single-display simulator) and asserts the app's own frame STAYS
// portrait. The orientation getter itself is recorded, never asserted: on a
// portrait-policy build the getter may or may not move — the app frame is the
// evidence. Attaches to the RUNNING app; never launches; never taps Play.
//
//   bash test/manual-test/kit/run-probe.sh PhonePortraitPolicyProbe \
//     SIMULATOR_UDID OUT_DIR -collect-test-diagnostics never
final class PhonePortraitPolicyProbe: XCTestCase {
  private var app: XCUIApplication {
    XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
  }

  private func shoot(_ name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  func testPortraitPolicyHoldsUnderLandscapeAttempt() throws {
    let before = app.frame
    print("PROBE-POLICY before frame=\(before) getter=\(XCUIDevice.shared.orientation.rawValue)")
    XCTAssertTrue(before.width < before.height, "precondition: app already landscape?")
    shoot("policy-before")

    XCUIDevice.shared.orientation = .landscapeLeft
    sleep(4)
    let during = app.frame
    let getterDuring = XCUIDevice.shared.orientation.rawValue
    print("PROBE-POLICY landscape-attempt frame=\(during) getter=\(getterDuring)")
    shoot("policy-landscape-attempt")
    XCTAssertEqual(during, before,
                   "the app frame changed under a landscape attempt: portrait policy broken")

    XCUIDevice.shared.orientation = .portrait
    sleep(3)
    let restored = app.frame
    print("PROBE-POLICY restored frame=\(restored) getter=\(XCUIDevice.shared.orientation.rawValue)")
    XCTAssertEqual(restored, before, "the app frame did not survive the round trip")
    shoot("policy-restored")
  }
}
