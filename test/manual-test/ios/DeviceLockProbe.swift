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
  /// The lock screen's own Now Playing centre button, pressed while the device
  /// stays locked (#75): Play when it reads Play, Pause when it reads Pause.
  func testLockScreenPlay() throws { try pressCentre(reading: "Play", becomes: "Pause") }
  func testLockScreenPause() throws { try pressCentre(reading: "Pause", becomes: "Play") }
  /// A dark screen is woken by one Home press, and only one: on the lock screen
  /// of a device with no passcode a second would open it.
  private func pressCentre(reading label: String, becomes next: String) throws {
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let centre = springboard.buttons["UIA.MediaControls.NowPlaying.CenterButton"]
    if !(centre.exists && centre.isHittable) {
      XCUIDevice.shared.press(.home)
      _ = centre.waitForExistence(timeout: 3)
    }
    let before = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    before.name = "before-\(label)"; before.lifetime = .keepAlways; add(before)
    XCTAssertTrue(centre.exists, "No Now Playing centre button on the lock screen")
    XCTAssertEqual(centre.label, label, "The centre button does not read \(label)")
    guard centre.label == label else { return }
    centre.tap()
    let changed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", next), object: centre)
    XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 3), .completed, "The centre button did not turn to \(next)")
    let after = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    after.name = "after-\(label)"; after.lifetime = .keepAlways; add(after)
  }
}
