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
  /// Locks the moment the file LOCK_SIGNAL names appears, so the caller chooses
  /// the moment rather than taking whatever second the runner's launch ends on
  /// (about 20 s after `xcodebuild` starts). Prints `LOCKPROBE waiting` once it
  /// polls, and `LOCKPROBE pressing at` (Unix seconds) as it presses; the press
  /// itself returns about 2 s later, once XCTest has waited for the device to
  /// settle. LOCK_WAIT (s, default 300) bounds the wait.
  func testLockOnSignal() throws {
    let env = ProcessInfo.processInfo.environment
    let signal = try XCTUnwrap(env["LOCK_SIGNAL"], "LOCK_SIGNAL is not set")
    let end = Date().addingTimeInterval(Double(env["LOCK_WAIT"] ?? "") ?? 300)
    print("LOCKPROBE waiting for \(signal)")
    while !FileManager.default.fileExists(atPath: signal) {
      guard Date() < end else { XCTFail("No \(signal) in time"); return }
      Thread.sleep(forTimeInterval: 0.05)
    }
    let selector = NSSelectorFromString("pressLockButton")
    XCTAssertTrue(XCUIDevice.shared.responds(to: selector), "XCUIDevice has no pressLockButton")
    print("LOCKPROBE pressing at \(Date().timeIntervalSince1970)")
    XCUIDevice.shared.perform(selector)
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
