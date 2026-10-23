// IpadRotationProbe — #319 verification: the system's own rotation action.
//
// Attaches to the ALREADY RUNNING OpenReader by bundle identifier (a bare
// XCUIApplication() would relaunch it, losing the reading state under test;
// pitfalls #311), turns the device with XCUIDevice's orientation (the real
// system action, not a JS geometry probe), asserts the system orientation
// took, and keeps a screenshot after each turn. Layout assertions themselves
// stay outside: the AX tree and simctl screenshots are read after the probe,
// with the rotation left in place. No terminate() and no XCUIApplication
// frame reads: a snapshot query would fail after any backgrounding and the
// frame adds nothing over the screen bounds.
//
// Run: bash test/manual-test/kit/run-probe.sh IpadRotationProbe UDID DIR \
//        -only-testing:IpadRotationProbe/testRotateToLandscape
import XCTest

final class IpadRotationProbe: XCTestCase {

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testRotateToLandscape() {
        print("[rotation] before \(XCUIDevice.shared.orientation.rawValue), screen \(UIScreen.main.bounds)")
        XCUIDevice.shared.orientation = .landscapeLeft
        sleep(4)
        print("[rotation] after \(XCUIDevice.shared.orientation.rawValue), screen \(UIScreen.main.bounds)")
        shot("after-landscape")
        XCTAssertEqual(XCUIDevice.shared.orientation, .landscapeLeft, "the system rotation did not take")
    }

    func testRotateToPortrait() {
        print("[rotation] before \(XCUIDevice.shared.orientation.rawValue), screen \(UIScreen.main.bounds)")
        XCUIDevice.shared.orientation = .portrait
        sleep(4)
        print("[rotation] after \(XCUIDevice.shared.orientation.rawValue), screen \(UIScreen.main.bounds)")
        shot("after-portrait")
        XCTAssertEqual(XCUIDevice.shared.orientation, .portrait, "the system rotation did not take")
    }
}
