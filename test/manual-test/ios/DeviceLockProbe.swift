import XCTest

/// Locks or unlocks the simulated device, for `lock-device.sh`. `pressLockButton`
/// is XCUIDevice's own side-button press; it is not in the public headers, so it
/// is reached by selector. Nothing about any app is asserted here.
final class DeviceLockProbe: XCTestCase {
  func testLock() throws {
    let selector = NSSelectorFromString("pressLockButton")
    XCTAssertTrue(XCUIDevice.shared.responds(to: selector), "XCUIDevice has no pressLockButton")
    XCUIDevice.shared.perform(selector)
    Thread.sleep(forTimeInterval: 1)
    let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    shot.name = "locked"; shot.lifetime = .keepAlways; add(shot)
  }
  /// A locked simulator with no passcode opens on a Home press: the first wakes
  /// the screen, the second leaves the lock screen.
  func testUnlock() throws {
    XCUIDevice.shared.press(.home)
    Thread.sleep(forTimeInterval: 1)
    XCUIDevice.shared.press(.home)
    Thread.sleep(forTimeInterval: 1)
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    shot.name = "unlocked"; shot.lifetime = .keepAlways; add(shot)
    _ = springboard
  }
}
